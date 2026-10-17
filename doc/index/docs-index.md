# Index building

[`src/docs-index.mjs`](../../src/docs-index.mjs) finds a project's docs folder, reads every eligible Markdown page, and builds `{ version, signature, docsRoot, builtAt, groups, docs }`. Each entry in `docs` is `{ rel, group, summary }`. Each entry in `groups` is `{ name, count, summary }`. The [hook runtime](../hook/runtime.md) calls `buildIndex` on every prompt that passes its skip rules, and [selection](../hook/selection.md) turns the summaries into questions.

## Discovery and walking

`findDocsRoot(projectDir)` checks `doc`, `docs` and `documentation`, in that order, directly under the project directory. It returns the first one that is a directory, or `null`. Nested or differently named folders are not found, and when two of them exist, the later ones are ignored.

`walkMarkdown(docsRoot)` walks the tree depth-first with an explicit stack and returns absolute paths, sorted. It skips:

- directories whose name starts with `.` or `_`, or is `node_modules`, `archive`, `history` or `screenshots`
- files not ending in `.md` (case-insensitive), and files ending in `.prompt.md`
- any path matched by `.jevdocsignore`

`.jevdocsignore` is read from the root of the docs folder. Each non-empty line that doesn't start with `#` is trimmed, its backslashes become `/`, and leading slashes are removed. A path relative to the docs root is ignored when it equals a line or starts with that line followed by `/`. So `reports` and `reports/` both exclude the `reports` folder. There are no wildcards. A directory that can't be read is skipped silently.

## Parsing a page

`parseDoc(text, fallbackTitle)` removes a leading byte-order mark, then a frontmatter block delimited by `---` lines at the very start. From the frontmatter it reads only `description:`, with surrounding quotes removed. From the body it reads:

- **title**: the first line starting with `# `, cleaned by `stripMd`. If there is none, the file name without `.md`.
- **headings**: the first 8 lines starting with `## `, cleaned, empty ones dropped.
- **first paragraph**: the first run of consecutive prose lines, outside code fences. Lines starting with `#`, `-`, `*`, `|` or a numbered list marker are skipped before the paragraph and end it after it starts. A blank line ends it too.

`stripMd` removes images, keeps link text without the URL, deletes the characters `` ` * _ > # | `` and collapses whitespace. It is lossy on purpose: the result is used only as plain text for Jev.

## Hub link descriptions

`harvestLinkDescriptions(file, text, docsRoot, out)` scans every page for a Markdown link to a `.md` file, followed by `:`, `—`, `–` or `-` and some text on the same line. That's the hub-line pattern `- [Title](page.md): what it covers`. Links with a URL scheme are ignored, and so are targets that resolve outside the docs root. The text is cleaned with `stripMd`, and descriptions shorter than 12 characters are dropped.

A page linked from several places keeps one description, chosen this way: a description from a hub (a file named `README.md` or `index.md`, case-insensitive) replaces one from an ordinary page. Between two descriptions of the same kind, the longer one wins. The entry also records `fromRoot` when any link came from the README or index directly in the docs root.

## Summaries

A page's description is chosen in this order: frontmatter `description`, then its harvested hub description, then its first paragraph, then nothing. Its summary is built as follows, and the whole summary is then clipped to 480 characters:

```
<title> — <description clipped to 260> Sections: <headings joined by "; ", clipped to 160>
```

`clip` cuts at the limit and appends `…`.

A page's `group` is the first segment of its path relative to the docs root, or `.` for pages at the root. Each group gets a summary:

1. It starts with `<name>/`, or `Top-level documentation pages` for `.`.
2. Then comes the description of the group's README, as harvested from hub links, clipped to 240 characters. If there is none, the README's own summary is used instead.
3. Then `Pages include:` and the titles of up to 40 other pages in the group, clipped to 900 characters. Pages linked from the root hub come first, then pages linked from any hub, then the rest, shallower paths first within each tier. This keeps the main topics of large areas inside the character budget.

## Cache

`buildIndex(docsRoot, { cache })` computes a SHA-1 signature over every walked file's path, size and modification time. The cache file is `<CACHE_DIR>/<first 16 hex chars of SHA-1 of the lower-cased docs root>.json`. When `cache` is true (the default), a cached index with the same `version` (currently `4`) and signature is returned without reading any page.

Otherwise the index is rebuilt and written back. Read and write failures are swallowed: the hook still gets a fresh index. Adding, removing, editing or touching a page changes the signature. Editing `.jevdocsignore` changes the signature only when it changes which files are walked. `CACHE_DIR` is `JEV_DOCS_CACHE_DIR`, or `~/.claude/cache/jev-docs`, and is fixed when the module loads.

## Limits

- Only `description:` is read from frontmatter. Other fields, multi-line values and YAML lists aren't parsed.
- A hub line counts only if the description is on the same line as the link.
- The signature uses modification times, so copying a docs folder while preserving timestamps can reuse a stale cache. On a different absolute path it gets a different cache file anyway.
- The whole index is rebuilt when any page changes. On about 950 pages this took about 400 ms in development runs. A cached load took 3 ms on a 12-page folder.
- Summaries are built from text only. Images, tables and code blocks contribute nothing.

## Verification

[`test/docs-index.test.mjs`](../../test/docs-index.test.mjs) covers:

- `parseDoc`: title, headings, frontmatter description and first paragraph
- `buildIndex`, against a fixture with `cache: false`: skipping `_archive`, `history`, `.prompt.md` files and a `.jevdocsignore` entry
- description precedence: frontmatter first, then hub links, including the area summary taking its README's hub description

The cache path, the signature and the topic ordering in area summaries have no automated test. The suite was run while writing this page: 13 tests, all passing.
