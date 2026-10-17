# Docs index

The index is the compact, cached view of a project's Markdown documentation that the hook sends to Jev. It has one summary per page and one per top-level area. This domain covers how pages are found, parsed and summarized. How the summaries are used in questions is on the [selection page](../hook/selection.md).

## Pages

- [Index building](docs-index.md): docs folder discovery order, the Markdown walk and skip rules, `.jevdocsignore`, title, heading and first-paragraph parsing, frontmatter and hub-link description precedence, area summaries, summary length caps, and the signature-based cache.

## Ownership

[`src/docs-index.mjs`](../../src/docs-index.mjs) owns discovery, parsing, summaries and the cache, and exports the shared helpers `toPosix`, `clip` and `CACHE_DIR`, which the other modules import.
