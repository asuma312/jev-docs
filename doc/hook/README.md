# Prompt hook

The hook runs on Claude Code's `UserPromptSubmit` event, decides whether a prompt needs project documentation, asks Jev which pages fit, and returns them as additional context. Building the docs index and remembering what a session already saw belong to the [docs index](../index/README.md) and [session memory](../session/README.md) domains.

## Pages

- [Hook runtime](runtime.md): stdin input fields, argument modes (`--dry-run`, `--reset`, `--cwd`), project directory resolution, skip rules, the order of steps, the JSON output shape, the `last-run.json` log and fail-open error handling.
- [Two-stage selection](selection.md): Jev client setup, gate and area questions, page questions, thresholds and caps, request chunking by character budget, environment variables and the rendered context text.

## Ownership

[`hook.mjs`](../../hook.mjs) is the entry point: it reads the hook input, applies the skip rules, calls the index, selection and session modules in order, writes the log and prints the hook output. [`src/select.mjs`](../../src/select.mjs) owns everything that talks to Jev: the question templates, the thresholds in `CONFIG`, request chunking and the context text. The only runtime dependency is the TypeSafe SDK, `@typesafe-ai/sdk`, declared in [`package.json`](../../package.json).
