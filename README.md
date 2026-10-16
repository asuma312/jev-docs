# jev-docs

A [Claude Code](https://code.claude.com) hook that picks the documentation pages relevant to each prompt, so the agent reads two or three pages instead of digging through the whole `docs/` folder.

Before Claude sees your prompt, the hook asks [Jev](https://docs.typesafe.ai) (TypeSafe's fast decision model) which pages in your project's `doc/` or `docs/` folder matter for it, and adds a short list to the prompt's context:

```
Here are the important documentation files for this request (selected automatically from doc/ by Jev;
read the ones that apply before starting, and ignore any that don't fit):
- docs/billing/invoices.md — Invoices — generation, numbering, tax rules and PDF rendering. …
- docs/conventions/money.md — Money handling — decimal types, rounding and currency conversion. …
- docs/billing/README.md — Billing — subscriptions, invoices, refunds and payment providers. …
```

It is installed once, globally, and works in every project that has a `doc/`, `docs/` or `documentation/` folder. In projects without one it does nothing.

## How it works

1. **Index.** The hook walks the docs folder and builds a compact entry per Markdown page: path, title, a short description and the `##` section headings. The description comes from, in order: a `description:` field in the page's frontmatter, the text next to a link to the page in a README or index hub (`- [Billing](billing/README.md): subscriptions, invoices…`), or the page's first paragraph. The index is cached and rebuilt only when a page changes.
2. **Stage 1: areas.** One Jev request asks a gate question ("does this prompt depend on project-specific knowledge?") and one yes/no question per top-level folder. Small talk stops here and nothing is injected.
3. **Stage 2: pages.** For the best areas (up to 4), Jev answers one yes/no question per page. Questions are evaluated in parallel inside a request, and large areas are split across parallel requests to stay under Jev's 64K-token limit.
4. **Inject.** Pages with a probability of 0.5 or more (up to 8, highest first) are added to the prompt context. The list is phrased as optional, so a wrong pick costs little.

The state Jev sees is the prompt plus the last three user messages of the session, so follow-up prompts ("now do the same for the UI") still get the right pages.

The suggestion is appended to your message, after the conversation history, so it does not break prompt caching.

**Fail-open:** if the key is missing, the request times out or anything else goes wrong, the hook injects nothing and Claude Code carries on as usual.

### Measured on a real project

A project with about 950 Markdown pages in 24 areas:

| Prompt type | Requests | Time | Result |
|---|---|---|---|
| Tune a formula in one game system | 2 | ~1.0 s | that system's pages plus the balance conventions |
| Add a button to an existing UI screen | 2 | ~1.0 s | the screen's data and registry pages |
| Investigate a failing backend deploy | 3 | ~1.1 s | operations, runtime, packaging and deploy pages |
| "hi, how are you?" | 1 | ~0.6 s | nothing injected (gate) |

## Install

Requires Node.js 22 or newer and a TypeSafe API key from [console.typesafe.ai](https://console.typesafe.ai).

```bash
git clone https://github.com/<you>/jev-docs.git
cd jev-docs
npm install
node install.mjs
```

`install.mjs` adds a `UserPromptSubmit` hook to `~/.claude/settings.json` (it writes a backup first). Run `node install.mjs --uninstall` to remove it.

Then make `TYPESAFE_API_KEY` visible to Claude Code. Either set it as an environment variable before starting Claude Code (for example `setx TYPESAFE_API_KEY "<key>"` on Windows, or an `export` in your shell profile on macOS/Linux), or add it to the `env` block of `~/.claude/settings.json`:

```json
{
  "env": { "TYPESAFE_API_KEY": "<key>" }
}
```

Never commit the key.

## Try it without Claude Code

```bash
node hook.mjs --dry-run --cwd /path/to/project "what you want to do"
```

Without a key, the dry run only prints the index and sample questions. With a key, it prints the scores and the exact context it would inject. Every real run also writes `~/.claude/cache/jev-docs/last-run.json` with the area scores, the selected pages, timings and token usage.

## Configuration

Environment variables, all optional:

| Variable | Default | Meaning |
|---|---|---|
| `JEV_DOCS_MAX` | 8 | Maximum pages injected |
| `JEV_DOCS_THRESHOLD` | 0.5 | Minimum probability for a page |
| `JEV_DOCS_GROUP_THRESHOLD` | 0.35 | Minimum probability for an area to be explored |
| `JEV_DOCS_MAX_GROUPS` | 4 | Maximum areas explored in stage 2 |
| `JEV_DOCS_GATE_THRESHOLD` | 0.3 | Below this, the prompt is treated as small talk |
| `JEV_DOCS_TIMEOUT_MS` | 6000 | Timeout per Jev request |
| `JEV_DOCS_MODEL` | SDK default (`jev-latest`) | Jev model to use |
| `JEV_DOCS_CACHE_DIR` | `~/.claude/cache/jev-docs` | Index cache and last-run log |

**Skipped automatically:** folders starting with `.` or `_`, folders named `archive`, `history`, `screenshots` or `node_modules`, and `*.prompt.md` files.

**Skipping more:** add a `.jevdocsignore` file at the root of the docs folder with one path prefix per line, relative to that folder:

```
# generated reports
baseline/saves/
lore/codex/
```

**Better picks:** short, specific descriptions help the most. Add `description:` frontmatter to important pages, or keep README hubs with one line per linked page.

## Cost and limits

- Each prompt costs one Jev request, or two to four when it touches project work. On the 950-page project that was about 3K to 30K input tokens per prompt, and about one second of added latency.
- Slash commands and prompts under 8 characters are skipped.
- Jev only sees summaries, not full pages, so a page with a vague title and no description is easy to miss.
- Jev is weaker on dates, numbers and multi-step references, and the TypeSafe docs note that it does not treat injected content as hostile. Treat the list as a hint, not an access control.

## Privacy

On every prompt that isn't skipped, the hook sends data to TypeSafe's API (`api.typesafe.ai`, or `TYPESAFE_BASE_URL` if set):

- **The prompt you typed**, and up to the **last three user messages** of the session (each cut to 600 characters).
- **Your documentation index**: the path, title, short description and section headings of the pages in the docs folder. Full page contents are never sent.

It does not send code, tool output, assistant replies or files outside the docs folder. Don't install it on projects whose prompts or doc titles can't leave your machine, and check TypeSafe's own terms for how they handle request data.

Locally, the hook writes two things under `~/.claude/cache/jev-docs/` (or `JEV_DOCS_CACHE_DIR`): the index cache, and `last-run.json`, which holds the start of the latest prompt (up to 300 characters), the scores and the selected pages. Both stay on your machine. Delete that folder at any time.

The hook reads the key only from the `TYPESAFE_API_KEY` environment variable. It never writes the key to disk or to its logs.

## Development

```bash
npm test
```

## License

MIT
