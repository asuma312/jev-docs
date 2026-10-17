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

The repository also ships the **`create-jev-doc` skill**. It writes and maintains that docs folder: contract-level pages organized in README hubs, which is the structure the hook reads best. See [Writing the docs](#writing-the-docs-the-create-jev-doc-skill).

## How it works

1. **Index.** The hook walks the docs folder and builds a compact entry per Markdown page: path, title, a short description and the `##` section headings. The description comes from, in order: a `description:` field in the page's frontmatter, the text next to a link to the page in a README or index hub (`- [Billing](billing/README.md): subscriptions, invoices…`), or the page's first paragraph. The index is cached and rebuilt only when a page changes.
2. **Stage 1: areas.** One Jev request asks a gate question ("does this prompt depend on project-specific knowledge?") and one yes/no question per top-level folder. Small talk stops here and nothing is injected.
3. **Stage 2: pages.** For the best areas (up to 4), Jev answers one yes/no question per page. Questions are evaluated in parallel inside a request, and large areas are split across parallel requests to stay under Jev's 64K-token limit.
4. **Inject.** Pages with a probability of 0.5 or more (up to 8, highest first) are added to the prompt context. The list is phrased as optional, so a wrong pick costs little.
5. **Only new pages.** Within a session, a page is suggested at most once, and not at all if the agent already opened it with the Read tool. If every selected page is already known, nothing is injected, so a long conversation on one topic doesn't fill up with the same list. When the session is compacted or cleared, the earlier context is gone, so a `SessionStart` hook resets the memory and pages can be suggested again.

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

`install.mjs` does two things:

- It adds two hooks to `~/.claude/settings.json`, after writing a backup: `UserPromptSubmit`, which suggests the pages, and `SessionStart` (on `compact` and `clear`), which resets the session's memory of what was suggested.
- It copies the `create-jev-doc` skill to `~/.claude/skills/`, and also to `~/.agents/skills/` and `~/.codex/skills/` when those agent folders exist.

Use `--no-skill` or `--skill-only` to install just one of them, and `--uninstall` to remove both. The skill is a copy, so run `node install.mjs` again after pulling updates.

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

## Writing the docs: the create-jev-doc skill

The hook is only as good as the docs it picks from. `create-jev-doc` is an agent skill (Claude Code, Codex and other agents that read `SKILL.md` skills) that writes those docs from the code. Invoke it with `/create-jev-doc` in Claude Code or `$create-jev-doc` in Codex, or just ask the agent to document the repository.

It works in two modes, picked automatically:

- **Create:** when the repository has no docs folder. The agent surveys the code and proposes a set of domains for your approval. It then writes `doc/README.md`, one hub per domain and the pages, one domain at a time, and records progress so a later session can resume.
- **Update:** when the docs folder exists. The agent finds the source files that changed since the last documented commit and the pages that reference them, then rewrites only the affected passages. It also places new files, fixes links to renamed or deleted ones, and stamps the new commit.

The pages follow a fixed style, described in [`skills/create-jev-doc/references/style.md`](skills/create-jev-doc/references/style.md):

- They state contracts (names, state, ordering, failure behavior, limits) instead of describing code in general terms.
- They link the files that own each behavior.
- They say which tests cover what, and never claim a verification nobody ran.
- Every page is listed in a hub as `- [Title](page.md): what it covers`. That line is exactly what the hook shows Jev.

The skill comes with a dependency-free helper, `skills/create-jev-doc/scripts/doc-coverage.mjs`, which you can also run yourself from any repository:

| Command | What it reports |
|---|---|
| `inventory` | Source areas with file and line counts, the docs folder, and the mode (create or update) |
| `map` | Which pages reference which source files, coverage percentage, and the undocumented files |
| `changed` | Source changes since the last documented commit: pages to update, new files, broken references |
| `check` | Broken links, pages no hub lists, folders without a README hub, hub lines without descriptions |
| `stamp` | Records HEAD as the documented commit in `doc/.jev-doc.json` |

`doc/.jev-doc.json` also accepts an `exclude` list of repository paths (build output, generated reports, fixtures) that should not count as source.

## Configuration

Environment variables for the hook, all optional:

| Variable | Default | Meaning |
|---|---|---|
| `JEV_DOCS_MAX` | 8 | Maximum pages injected |
| `JEV_DOCS_THRESHOLD` | 0.5 | Minimum probability for a page |
| `JEV_DOCS_GROUP_THRESHOLD` | 0.35 | Minimum probability for an area to be explored |
| `JEV_DOCS_MAX_GROUPS` | 4 | Maximum areas explored in stage 2 |
| `JEV_DOCS_GATE_THRESHOLD` | 0.3 | Below this, the prompt is treated as small talk |
| `JEV_DOCS_TIMEOUT_MS` | 6000 | Timeout per Jev request |
| `JEV_DOCS_MODEL` | SDK default (`jev-latest`) | Jev model to use |
| `JEV_DOCS_DEDUP` | on | Set to `0` to inject the selected pages on every prompt, even if already suggested or read |
| `JEV_DOCS_CACHE_DIR` | `~/.claude/cache/jev-docs` | Index cache, per-session memory and last-run log |

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

Locally, the hook writes three things under `~/.claude/cache/jev-docs/` (or `JEV_DOCS_CACHE_DIR`):

- the index cache
- `sessions/<session id>.json`, the paths of the pages already suggested in each session. These are deleted after two weeks without use.
- `last-run.json`, which holds the start of the latest prompt (up to 300 characters), the scores, and the selected and injected pages

All of this stays on your machine, and you can delete that folder at any time. To spot pages the agent already opened, the hook also reads the session transcript locally. That transcript is never sent anywhere.

The hook reads the key only from the `TYPESAFE_API_KEY` environment variable. It never writes the key to disk or to its logs.

The `create-jev-doc` skill runs in your agent, under your agent's own data policy. Its helper script only reads the repository and git history, and only writes `doc/.jev-doc.json`. It makes no network calls.

## Development

```bash
npm test
```

## License

MIT
