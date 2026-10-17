# Test suites

Run all tests from the repository root:

```bash
npm test
```

The script is `node --test test/*.test.mjs`. The file list is an explicit glob, because the Node 22.14 test runner used during development doesn't accept a bare directory argument. No test needs network access, the TypeSafe SDK's network calls or an API key. The doc-coverage suite needs a `git` binary.

## Isolation

The suites never touch the real user folders:

- `docs-index.test.mjs` and `session.test.mjs` set `JEV_DOCS_CACHE_DIR` to a new temporary folder before they import the modules, because the modules fix `CACHE_DIR` at load time.
- The installer test sets `HOME` and `USERPROFILE` to a temporary home folder, and passes `--no-skill`.
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

[`test/doc-coverage.test.mjs`](../../test/doc-coverage.test.mjs) tests the [coverage helper](../skill/doc-coverage.md) through its JSON output:

| Test | Checks |
|---|---|
| inventory | Create mode without a docs folder; `dist/` and `package-lock.json` don't count; one `src` area |
| map and check | Linked and mentioned files count as documented; a missing link target is broken; an unlisted page is an orphan; a hub line without a description is reported |
| changed after stamp | The baseline comes from the state file; a modified file lists its page; an added file is undocumented; a deleted file is a broken reference |

## Not covered

No automated test covers these behaviors. They rest on reading the code and on manual runs:

- the hook's prompt path: skip rules, calls to `select`, deduplication wiring, output JSON and `last-run.json`
- `select` itself, which needs the live TypeSafe API
- the index cache (signature and reuse) and the topic ordering in area summaries
- `recentUserMessages`
- `pruneSessions`
- the installer's skill copy and its skip of a foreign skill folder
- the helper's porcelain parsing of working-tree renames, and the `--since` and `--doc` options

## Last run

The suite was run while this documentation was written: 13 tests, 13 passing, 0 failing.
