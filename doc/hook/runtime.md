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

## Log and error handling

Each run that gets past input parsing (and is not `--reset`) writes `last-run.json` in the cache directory from a `finally` block, so skipped, failed and successful runs all leave a record. The log has these fields:

- always: `at` (ISO time), `projectDir`, `prompt` (clipped to 300 characters), `requests` and `totalMs`
- depending on how far the run got: `skipped`, `indexed`, `gate`, `groups`, `selected`, `alreadyKnown`, `injected` and `error`

Each entry in `requests` holds the question count, the milliseconds, the SDK's `usage` and the model name. The cache directory is `JEV_DOCS_CACHE_DIR`, or `~/.claude/cache/jev-docs`. A failure to write the log is swallowed.

Any exception between the skip checks and the output, such as an SDK timeout, an authentication error or a bad index, is caught. It is recorded as `log.error`, printed to stderr only in a dry run, and the hook exits normally with no stdout. This is the fail-open contract: the user's prompt always continues unchanged.

The hook never sets a non-zero exit code and never prints anything other than the single JSON line, so it cannot block a prompt.

## Limits

- Each run is a fresh Node process. Nothing is shared between runs except files in the cache directory.
- The 8-character minimum and the `/` rule apply to the trimmed prompt. A prompt that starts with whitespace and then `/` is still skipped.
- The tag rule skips any prompt that starts with something like `<div>`. A user who opens a message with an HTML tag gets no suggestions for that message.
- `log.prompt` stores up to 300 characters of the prompt in plain text on disk.

## Verification

[`test/session.test.mjs`](../../test/session.test.mjs) runs `hook.mjs --reset` as a child process with a session ID on stdin, and checks that the session's memory is deleted. No test runs the hook's prompt path end to end, because that path needs the TypeSafe API. The skip rules, the output shape and the log were checked by hand during development (a task-notification prompt produced `skipped: app-generated message`), but not by an automated test. The suite was run while writing this page: 13 tests, all passing.
