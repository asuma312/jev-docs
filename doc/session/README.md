# Session memory

Within one Claude Code session, the hook avoids suggesting the same page twice. It remembers what it suggested, notices pages the agent already opened, and forgets everything when the conversation is compacted or cleared. It also reads the session's recent user messages, so Jev can judge a prompt in context.

## Pages

- [Suggested-page memory](session-memory.md): per-session suggested sets, path keys, Read tool detection in the transcript, `newPagesOnly` filtering, reset on `SessionStart` compact or clear, two-week pruning and the `JEV_DOCS_DEDUP` switch.
- [Recent messages as context](transcript-context.md): how the last three user messages are read from the transcript, which entries are skipped, clipping, and how they enter Jev's state.

## Ownership

[`src/session.mjs`](../../src/session.mjs) owns the session files under the cache directory and the Read-call scan. [`src/transcript.mjs`](../../src/transcript.mjs) owns the extraction of recent user messages. Both read the transcript file Claude Code passes in the hook input as `transcript_path`, and neither writes to it. [`hook.mjs`](../../hook.mjs) decides when to call them.
