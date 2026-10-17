# Suggested-page memory

[`src/session.mjs`](../../src/session.mjs) keeps, for each Claude Code session, the set of pages the hook has already injected. It also finds the pages the agent opened with the Read tool. [`hook.mjs`](../../hook.mjs) uses both to inject only pages that are new to the conversation (see [hook runtime](../hook/runtime.md#deduplication-and-output)).

## Session files

Each session has one file at `<CACHE_DIR>/sessions/<session id>.json`. Every character in the ID other than letters, digits, `_`, `.` and `-` becomes `_`. The file holds `{ updatedAt, docs }`, where `docs` is an array of path keys.

- `loadSuggested(sessionId)` returns the stored keys as a `Set`. It returns an empty set when there is no session ID, no file, or unreadable JSON.
- `saveSuggested(sessionId, keys)` creates the folder if needed and overwrites the file.
- `resetSession(sessionId)` deletes the file.

All three do nothing without a session ID, and swallow file-system errors.

`pathKey(p)` is the comparison form of a path: resolved to an absolute path, with forward slashes, and lower-cased on Windows (`process.platform === "win32"`). Suggested pages, read files and candidates are all compared by this key, so `C:\Repo\doc\a.md` and `c:/repo/doc/a.md` match on Windows.

## Already-read detection

`readFilesFromTranscript(transcriptPath)` reads the last 2,000,000 bytes of the transcript (a JSONL file) and looks at each line containing `"tool_use"`. Lines that aren't valid JSON are skipped. These include a first line cut off by the tail boundary. For each `tool_use` block named `Read` with a string `input.file_path`, the path key is added to the result. It returns an empty set when there is no transcript path or the file can't be read.

## Filtering and saving

`newPagesOnly(selected, docsRoot, suggested, read)` keeps the selected pages whose key, computed from `docsRoot` joined with the page's `rel`, is in neither set. Order is preserved.

The hook applies it only when `JEV_DOCS_DEDUP` is not `"0"` and the input has a `session_id`. After filtering, the hook adds the remaining pages' keys to the suggested set. It saves the set only if at least one page remains, so a prompt that injects nothing doesn't touch the file or its `updatedAt`. Pages the agent read but that were never suggested aren't added to the stored set, because the transcript scan finds them again on each prompt.

## Reset and pruning

[`install.mjs`](../../install.mjs) registers `hook.mjs --reset` on `SessionStart` with the matcher `compact|clear`. The reset reads `session_id` from stdin and deletes that session's file, so pages can be suggested again once the earlier context has been summarized away or cleared. The reset doesn't write `last-run.json`.

`pruneSessions(now)` deletes session files whose modification time is more than 14 days before `now`. The hook calls it after deduplication on every prompt that has a session ID. Errors, including a missing folder, are swallowed.

## Limits

- Detection covers only the Read tool. A page the agent viewed through a shell command, a search tool or an editor isn't seen as read.
- A Read call older than the 2 MB tail of the transcript is no longer detected. That page can be suggested again if it was never suggested before.
- The memory is keyed by session ID only. Two projects in the same session share one set, which is harmless because keys are absolute paths.
- If a session is compacted without the `SessionStart` hook installed, for example after a manual hook setup, the memory survives the compaction. Pages dropped from the summary won't be suggested again.
- Concurrent prompts in one session aren't expected, but if two hook runs overlapped, the last write to the session file would win.

## Verification

[`test/session.test.mjs`](../../test/session.test.mjs) covers four things:

- `newPagesOnly` removing a suggested page and a read page
- session files persisting per session ID and `resetSession` clearing them
- `readFilesFromTranscript` finding a Read call and ignoring a Bash call and an invalid line
- `hook.mjs --reset` deleting the session file when given a session ID on stdin

`pruneSessions` has no automated test. One live session during development recorded a suggested page in a session file. The suite was run while writing this page: 13 tests, all passing.
