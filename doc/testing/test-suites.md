# Test suites

Run all tests from the repository root:

```bash
npm test
```

The script is `node --test test/*.test.mjs`. The file list is an explicit glob, because the Node 22.14 test runner used during development doesn't accept a bare directory argument. No test needs network access, the TypeSafe SDK's network calls or an API key. The doc-coverage suite needs a `git` binary.

## Isolation

The suites never touch the real user folders:

- `docs-index.test.mjs` and `session.test.mjs` set `JEV_DOCS_CACHE_DIR` to a new temporary folder before they import the modules, because the modules fix `CACHE_DIR` at load time.
- The installer tests set `HOME` and `USERPROFILE` to a temporary home folder, and pass `--no-skill`. One of them runs a copy of the installer from a folder named `docs-hook`.
- `select.test.mjs` passes a fake client and `noul` to `select`, so no SDK request is made.
- `hook.test.mjs` sets `JEV_DOCS_CACHE_DIR` to a temporary folder and clears `CLAUDE_PROJECT_DIR` for the child process. Its deadline test points `TYPESAFE_BASE_URL` at a local server on `127.0.0.1` and uses the test key `test-key`, so nothing leaves the machine.
- `doc-coverage.test.mjs` creates a fresh git repository in a temporary folder for each test, and configures a local test identity.

Temporary folders are not deleted after the run.

## Suites

[`test/docs-index.test.mjs`](../../test/docs-index.test.mjs) tests the [docs index](../index/docs-index.md) and the pure parts of [selection](../hook/selection.md):

| Test | Checks |
|---|---|
| parseDoc | Title, `##` headings, frontmatter `description` and first paragraph are read; Markdown is stripped |
| buildIndex skips | `_archive`, `history`, `.prompt.md` files and a `.jevdocsignore` entry are excluded; three pages remain |
| description precedence | Frontmatter beats hub links; a hub line describes the linked page and its area |
| chunkQuestions | A small budget yields several chunks and keeps all 10 questions |
| renderContext | Lines start with the docs path relative to the project |

[`test/session.test.mjs`](../../test/session.test.mjs) tests the [session memory](../session/session-memory.md) and the [installer](../install/installer.md):

| Test | Checks |
|---|---|
| newPagesOnly | A suggested page and a read page are removed; the third remains |
| session files | Keys persist per session ID; another session is empty; reset clears |
| readFilesFromTranscript | A Read `tool_use` is found; a Bash call and an invalid line are ignored |
| hook --reset | `hook.mjs --reset` with a session ID on stdin deletes that session's file |
| install | Two runs leave one entry per event and keep an unrelated hook; the `SessionStart` matcher and `--reset` command are right; uninstall restores the original |
| install from another folder name | A clone in `docs-hook`, with no `jev-docs` in any path, is recognized by its `package.json`; a foreign `hook.mjs` hook is kept |

[`test/select.test.mjs`](../../test/select.test.mjs) tests [selection](../hook/selection.md) with a fake client:

| Test | Checks |
|---|---|
| stage 1 chunking | 40 areas of about 4,000 characters are split across several requests, gate first, all 40 asked |
| gate stop | A gate below the threshold returns nothing after one request and logs the gate |
| stage 2 | Only pages in picked areas are asked; the page threshold keeps one page |
| fallback area | With no area above the threshold, the best area's pages are still asked |
| abort | An aborted signal rejects `select` while a fake request is pending, in under a second |

[`test/hook.test.mjs`](../../test/hook.test.mjs) runs [`hook.mjs`](../hook/runtime.md) as a child process:

| Test | Checks |
|---|---|
| deadline | With an API that never answers and a 1,500 ms deadline, the hook exits with code 0, no stdout, in under 4 s; the log has a deadline error, `startupMs`, `phases.index` and one history line |
| history of skipped runs | A slash command and a task notification each append a `runs.jsonl` line with the right `skipped` reason |

[`test/doc-coverage.test.mjs`](../../test/doc-coverage.test.mjs) tests the [coverage helper](../skill/doc-coverage.md) through its JSON output:

| Test | Checks |
|---|---|
| inventory | Create mode without a docs folder; `dist/` and `package-lock.json` don't count; one `src` area |
| map and check | Linked and mentioned files count as documented; a missing link target is broken; an unlisted page is an orphan; a hub line without a description is reported |
| changed after stamp | The baseline comes from the state file; a modified file lists its page; an added file is undocumented; a deleted file is a broken reference |
| changed with spaces and accents | An accented file changed in a commit, a file with a space changed in the working tree and a staged rename all map to their page; an untracked accented file is undocumented |
| check and code | Links in inline code and fenced blocks are ignored; `50%.md` is reported without a crash; a link with code as its text counts; the layout passes, then fails for a page at the docs root |
| flat docs | A `docs/` folder with only root pages fails the layout: no root hub, no domains, two pages outside domains |

## Not covered

No automated test covers these behaviors. They rest on reading the code and on manual runs:

- the hook's successful prompt path: real Jev answers, deduplication wiring and the output JSON
- `select` against the live TypeSafe API, including real timeouts and errors
- the index cache (signature and reuse) and the topic ordering in area summaries
- `recentUserMessages`
- `pruneSessions`
- the installer's skill copy and its skip of a foreign skill folder
- the helper's `--since` and `--doc` options, and copies (`C`) in git output

## Last run

The suite was run while this documentation was written: 24 tests, 24 passing, 0 failing.
