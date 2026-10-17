# Recent messages as context

[`src/transcript.mjs`](../../src/transcript.mjs) exports `recentUserMessages(transcriptPath, currentPrompt, limit = 3)`. [`hook.mjs`](../../hook.mjs) uses it to add the session's latest user messages to the state Jev sees. Thanks to this, a follow-up like "now do the same for the UI" is judged together with what came before it.

## Extraction

The function reads the last 400,000 bytes of the transcript (a JSONL file). It then considers each line that contains `"user"` and parses as JSON. A line counts only if:

- its `type` is `user`, `message.role` is `user`, and `isMeta` is not set
- its text is non-empty and doesn't start with `<`. This skips harness-injected entries such as command output and notifications.
- its trimmed text isn't the same as the trimmed current prompt

The text is `message.content` when it is a string. When it is an array, the text is the `text` blocks joined with newlines, so tool results and other non-text blocks are dropped. Each message is trimmed and clipped to 600 characters. The function returns the last `limit` messages in transcript order. It returns an empty array when there is no transcript path, or on any read error.

## How it reaches Jev

When the result is non-empty, the hook sets `state.recent_requests` to it next to `state.request`. The same state is sent in every Jev request for that prompt (see [selection](../hook/selection.md#jev-client-and-requests)). The question templates refer only to `` `request` ``, so Jev uses the recent messages as surrounding context, not as the subject of the question.

## Privacy

This is the only conversation content the hook sends beyond the current prompt: at most three messages, at most 600 characters each. Assistant messages, tool calls and tool output are never included. The repository [README](../../README.md#privacy-and-data-flow) states the same for users.

## Limits

- A message that starts with `<`, such as one opening with an HTML tag, is never used as context.
- If the user repeats a message word for word, the earlier copy is dropped as a duplicate of the current prompt.
- Messages older than the 400 KB tail are not seen. In a session with large tool outputs, that can be only a few turns.

## Verification

No automated test covers `recentUserMessages`. The behavior above comes from reading the source. The suite was run while writing this page (13 tests, all passing), but none of them exercises this function.
