# Hook runtime

[`hook.mjs`](../../hook.mjs) is the program Claude Code runs on every `UserPromptSubmit` event, and the one `SessionStart` runs with `--reset`. It reads one JSON object from stdin, decides whether to act, builds or loads the docs index through [`src/docs-index.mjs`](../../src/docs-index.mjs), and asks [`src/select.mjs`](../../src/select.mjs) to choose pages. It then filters them through [`src/session.mjs`](../../src/session.mjs) and prints the result as hook output. How pages are scored is on the [selection page](selection.md). Deduplication is on the [session memory page](../session/session-memory.md).

## Input and modes

`parseArgs` recognizes three flags anywhere in the argument list:

- `--dry-run` takes the prompt from the remaining arguments instead of stdin, joining every argument that doesn't start with `--` and doesn't follow `--cwd`.
- `--cwd <dir>` sets the project directory for a dry run.
- `--reset` makes the program delete the session's memory and exit.

Without `--dry-run`, `readStdin` collects all of stdin and `main` parses it as JSON. An empty stdin becomes `{}`. When stdin is a TTY, `readStdin` returns an empty string without waiting, so running the hook by hand without piping input does nothing. Invalid JSON makes `main` return immediately: nothing is logged and nothing is printed.

The fields read from the input object are `prompt`, `cwd`, `session_id` and `transcript_path`. In `--reset` mode only `session_id` matters. `main` calls `resetSession(input.session_id)` and returns before any logging, so a reset never touches `last-run.json`.

The project directory is `CLAUDE_PROJECT_DIR` when it is set and the run is not a dry run. Otherwise it is `input.cwd`, then `process.cwd()`. A dry run always uses `--cwd` or the current directory, so a `CLAUDE_PROJECT_DIR` left in the shell doesn't redirect it.

## Order of steps and skip rules

The prompt is trimmed. Then `main` runs these checks in order, and the first one that applies sets `log.skipped` and ends the run with no output:

| Check | `skipped` value |
|---|---|
| Fewer than 8 characters, or starts with `/` | `short prompt or slash command` |
| Starts with a tag, matching `/^<[a-z][\w-]*[\s>]/i` (task notifications and other app-injected messages) | `app-generated message` |
| `findDocsRoot` finds no `doc`, `docs` or `documentation` directory in the project directory | `no doc/ or docs/ folder` |
| The index has no pages | `no markdown pages` |
| `TYPESAFE_API_KEY` is not set | `TYPESAFE_API_KEY not set` |

The index is built before the key check, so a run without a key still refreshes the index cache and records `log.indexed` with the page count, area count and elapsed milliseconds.

After the checks, the state for Jev is `{ request: prompt }`, plus `recent_requests` when [`recentUserMessages`](../session/transcript-context.md) returns any. `select` returns the chosen pages, and `log.selected` records each as `path (probability)`.

A dry run prints the index summary, the gate and top six area scores, and the context it would inject (or `(nothing injected)`). It then returns before deduplication, so dry runs never read or write session memory.

## Deduplication and output

Deduplication runs when `JEV_DOCS_DEDUP` is anything other than `"0"` and the input has a `session_id`. The run loads the session's suggested set and removes pages already suggested or already opened with the Read tool. It records how many were removed in `log.alreadyKnown`, adds the remaining pages to the set, and saves the set only if at least one page remains. It then calls `pruneSessions`. `log.injected` always lists the pages that were actually injected.

If no page remains, the run prints nothing. Otherwise it writes one line of JSON to stdout:

```json
{ "hookSpecificOutput": { "hookEventName": "UserPromptSubmit", "additionalContext": "<text from renderContext>" } }
```

Claude Code adds `additionalContext` to the prompt's context. The text format is described under [rendered context](selection.md#rendered-context).

## Deadline

Every run has a whole-run budget, `CONFIG.deadlineMs` (`JEV_DOCS_DEADLINE_MS`, default 5000). It is counted from **process start**, not from the start of `main`. Right after building the log, the hook reads `process.uptime()` into `log.startupMs` and arms a timer for the remaining time, or for 0 when startup already used it up. The timer is `unref`'d, so it never keeps the process alive.

When the timer fires, it aborts an `AbortController` with an `Error` whose message says the deadline was reached. The signal goes to `select`, which checks it before each request and passes it to every SDK call, so pending requests stop at once. The resulting exception is recorded as `log.error`, with the deadline message, and nothing is injected. The timer is cleared in the `finally` block.

The deadline bounds what the user waits for. Claude Code's own hook timeout (20 seconds, set by the installer) is the outer limit if the process itself hangs before the timer can run, for example while Node is starting on a saturated machine.

## Log and error handling

Each run that gets past input parsing (and is not `--reset`) writes its log from a `finally` block, so skipped, failed and successful runs all leave a record, in two places:

- `last-run.json`: the latest run, pretty-printed, overwritten on every run
- `runs.jsonl`: one line per run, appended. Once the file passes 512 KB, it is rewritten with only the newest 200 lines. This lets you diagnose a slow or failed run even after later prompts, in this or other sessions, have overwritten `last-run.json`.

The log has these fields:

- always: `at` (ISO time), `projectDir`, `prompt` (clipped to 300 characters), `requests`, `startupMs`, `phases` and `totalMs`
- depending on how far the run got: `skipped`, `indexed`, `gate`, `groups`, `selected`, `alreadyKnown`, `injected` and `error`

`phases` holds milliseconds per step, for the steps the run reached: `index` (finding and building or loading the index), `transcript` (reading recent messages), `select` (all Jev requests, SDK import included) and `dedup` (session memory and pruning). `startupMs` is the time Node took to start and read stdin before `main` began its work. Together they show where a slow run spent its time.

Each entry in `requests` holds the question count, the milliseconds, the SDK's `usage` and the model name. The cache directory is `JEV_DOCS_CACHE_DIR`, or `~/.claude/cache/jev-docs`. A failure to write either file is swallowed.

Any exception between the skip checks and the output, such as a deadline abort, an SDK timeout, an authentication error or a bad index, is caught. It is recorded as `log.error`, printed to stderr only in a dry run, and the hook exits normally with no stdout. This is the fail-open contract: the user's prompt always continues unchanged.

The hook never sets a non-zero exit code and never prints anything other than the single JSON line, so it cannot block a prompt.

## Limits

- Each run is a fresh Node process. Nothing is shared between runs except files in the cache directory.
- The 8-character minimum and the `/` rule apply to the trimmed prompt. A prompt that starts with whitespace and then `/` is still skipped.
- The tag rule skips any prompt that starts with something like `<div>`. A user who opens a message with an HTML tag gets no suggestions for that message.
- `log.prompt` stores up to 300 characters of the prompt in plain text on disk, in `last-run.json` and in each of up to roughly 200 lines of `runs.jsonl`.
- The deadline covers the whole process, so the index build counts against it too. A first, uncached build of a very large docs folder on a slow machine leaves less time for Jev.
- Building the index is synchronous, so the deadline can't interrupt it. The abort takes effect at the next request.

## Verification

[`test/hook.test.mjs`](../../test/hook.test.mjs) runs `hook.mjs` as a child process in two tests:

- Against a local HTTP server that accepts requests and never answers, set as `TYPESAFE_BASE_URL` with a test key and `JEV_DOCS_DEADLINE_MS=1500`. The hook exits with code 0 and no stdout in under 4 seconds. `last-run.json` has a deadline `error`, a numeric `startupMs` and `phases.index`, and `runs.jsonl` has one line.
- Two skipped prompts (a slash command and a task notification) each append a line to `runs.jsonl`, with the right `skipped` reason.

[`test/session.test.mjs`](../../test/session.test.mjs) runs `hook.mjs --reset` and checks that the session's memory is deleted. The successful prompt path, with real Jev answers, deduplication and the output JSON, has no automated test, because it needs the live API.

During development, a real session on a machine at full CPU load recorded about 9.5 seconds between the prompt and the injected context, before this deadline existed. That run is what prompted the deadline and the history file. The suite was run while writing this page: 27 tests, all passing.
