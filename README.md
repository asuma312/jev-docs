# jev-docs

**Point your coding agent at the right docs, automatically.**

`jev-docs` is a [Claude Code](https://code.claude.com) hook. Before the agent sees your prompt, it asks [Jev](https://docs.typesafe.ai), TypeSafe's fast decision model, which pages in your project's `doc/`, `docs/` or `documentation/` folder matter for the request. It then adds a short list to the prompt's context. The agent opens two or three relevant pages instead of searching the whole folder or skipping the docs.

```
Here are the important documentation files for this request (selected automatically from docs/ by Jev;
read the ones that apply before starting, and ignore any that don't fit):
- docs/billing/invoices.md — Invoices — generation, numbering, tax rules and PDF rendering. …
- docs/conventions/money.md — Money handling — decimal types, rounding and currency conversion. …
- docs/billing/README.md — Billing — subscriptions, invoices, refunds and payment providers. …
```

The repository also includes **`create-jev-doc`**, an agent skill that writes and maintains that docs folder in the format the hook reads best.

> **Status:** early and experimental. This is an independent community project. It is not affiliated with or endorsed by TypeSafe or Anthropic.

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [Writing the docs: the create-jev-doc skill](#writing-the-docs-the-create-jev-doc-skill)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Privacy and data flow](#privacy-and-data-flow)
- [Uninstall](#uninstall)
- [Project layout](#project-layout)
- [Contributing](#contributing)
- [License](#license)

## Features

- **Automatic.** It runs on every prompt in every project that has a docs folder, with nothing to invoke. In projects without one it does nothing.
- **Fast.** About one second per prompt, in two batched Jev requests, even on a docs folder with about a thousand pages.
- **Context-friendly.** Each page is suggested at most once per session, and never after the agent has already opened it.
- **Deterministic plumbing.** Indexing, question building, thresholds and deduplication are plain code. Jev only answers yes/no questions with a probability.
- **Fail-open.** If the key is missing, a request times out or anything else goes wrong, nothing is injected and the agent carries on as usual.
- **Docs tooling included.** The `create-jev-doc` skill creates a docs folder from the code, or updates the existing one after code changes.

## Requirements

- Node.js 22 or newer
- [Claude Code](https://code.claude.com) (CLI, desktop app or IDE extension), which runs the hook
- A TypeSafe API key from [console.typesafe.ai](https://console.typesafe.ai). Requests are billed by TypeSafe, so check their pricing.
- Optional: Codex or another agent that reads `SKILL.md` skills, for `create-jev-doc`

## Quick start

```bash
git clone https://github.com/<owner>/jev-docs.git
cd jev-docs
npm install
node install.mjs
```

`install.mjs` writes a backup of `~/.claude/settings.json` first, then does two things:

- It registers two hooks. `UserPromptSubmit` suggests pages on each prompt. `SessionStart`, on `compact` and `clear`, resets the session's memory of what was suggested.
- It copies the `create-jev-doc` skill to `~/.claude/skills/`, and also to `~/.agents/skills/` and `~/.codex/skills/` when those folders exist.

Use `--no-skill` or `--skill-only` to install just one of them. Running it again is safe: it replaces its own entries and leaves your other hooks alone.

Then make the key visible to Claude Code. You can set it as an environment variable before starting Claude Code (for example `setx TYPESAFE_API_KEY "<key>"` on Windows, or an `export` in your shell profile on macOS and Linux). Or you can add it to the `env` block of `~/.claude/settings.json`:

```json
{
  "env": { "TYPESAFE_API_KEY": "<key>" }
}
```

Restart Claude Code so it loads the hooks and the key. Never commit the key, and keep in mind that `settings.json` stores it in plain text.

To check that it works, open a project with a docs folder and ask for something that touches it. Then look at `~/.claude/cache/jev-docs/last-run.json`, which records what the hook chose and why.

### Try it without Claude Code

```bash
node hook.mjs --dry-run --cwd /path/to/project "what you want to do"
```

Without a key, the dry run only prints the index and sample questions. With `TYPESAFE_API_KEY` set, it prints the area scores and the exact context it would inject.

## How it works

Everything happens in `hook.mjs`, in plain Node code. Jev is called only to answer the questions.

1. **Index.** The hook finds the docs folder and builds one compact entry per Markdown page: path, title, a short description and the `##` section headings. The description comes from, in order: a `description:` field in the page's frontmatter, the text next to a link to the page in a README or index hub (`- [Billing](billing/README.md): subscriptions, invoices…`), or the page's first paragraph. Full page contents are never sent. The index is cached and rebuilt only when a page changes.
2. **Stage 1: areas.** One Jev request asks a gate question ("does this request depend on knowledge specific to this project?") and one yes/no question per top-level folder of the docs. If the gate fails, for example on small talk, the hook stops here.
3. **Stage 2: pages.** For the best areas (up to 4), the hook asks one yes/no question per page in those areas. The questions travel in one request and Jev evaluates them in parallel. If they don't fit under Jev's 64K-token request limit, they are split into a few requests sent at the same time.
4. **Select.** Pages with a probability of 0.5 or more are kept, up to 8, highest first.
5. **Only new pages.** Pages already suggested in this session, or already opened by the agent with the Read tool, are dropped. If nothing new is left, nothing is injected.
6. **Inject.** The remaining pages are added to the prompt's context, phrased as optional reading, so a wrong pick costs little.

What Jev sees in each request:

- **state**, sent once per request: your prompt plus your last three messages in the session, so follow-ups like "now do the same for the UI" still find the right area.
- **questions**: one short yes/no question per area or page, each with that area's or page's summary.

The suggestion is appended to your message after the conversation history, so it doesn't invalidate the agent's prompt cache.

The hook does not run on slash commands, on prompts under 8 characters, or on messages the app injects itself (task notifications and similar messages that start with a `<tag>`).

### Measured on a real project

A project with about 950 Markdown pages in 24 areas:

| Prompt type | Jev requests | Input tokens | Time | Result |
|---|---|---|---|---|
| Tune a formula in one subsystem | 2 | ~16K | ~1.0 s | that subsystem's pages plus the project's balance conventions |
| Add a button to an existing UI screen | 2 | ~10K | ~1.0 s | the screen's data and registry pages |
| Investigate a failing backend deploy | 3 | ~31K | ~1.1 s | operations, runtime, packaging and deploy pages |
| "hi, how are you?" | 1 | ~2.7K | ~0.6 s | nothing injected (gate) |

## Writing the docs: the create-jev-doc skill

The hook is only as good as the docs it picks from. `create-jev-doc` writes those docs from the code. Invoke it with `/create-jev-doc` in Claude Code or `$create-jev-doc` in Codex, or just ask the agent to document the repository.

It picks one of two modes automatically:

- **Create:** when the repository has no docs folder. The agent surveys the code, proposes a set of domains and waits for your approval. It then writes `doc/README.md`, one hub per domain and the pages, one domain at a time. It records progress so a later session can resume.
- **Update:** when the docs folder exists. The agent finds the source files that changed since the last documented commit and the pages that reference them, then rewrites only the affected passages. It also adds new files to the right pages, fixes links to renamed or deleted files, and records the new commit.

The pages follow a fixed style, described in [`skills/create-jev-doc/references/style.md`](skills/create-jev-doc/references/style.md):

- They state contracts (names, state, ordering, failure behavior, limits) instead of describing code in general terms.
- They link the files that own each behavior.
- They say which tests cover what, and never claim a verification nobody ran.
- Every page is listed in a hub as `- [Title](page.md): what it covers`. That line is exactly what the hook shows Jev.

The skill ships with a dependency-free helper that you can also run yourself from any repository:

```bash
node skills/create-jev-doc/scripts/doc-coverage.mjs <command> [--root <repo>] [--json]
```

| Command | What it reports |
|---|---|
| `inventory` | Source areas with file and line counts, the docs folder, and the mode (create or update) |
| `map` | Which pages reference which source files, the coverage percentage, and the undocumented files |
| `changed` | Source changes since the last documented commit: pages to update, new files, broken references |
| `check` | Broken links, pages no hub lists, folders without a README hub, hub lines without descriptions |
| `stamp` | Records HEAD as the documented commit in `doc/.jev-doc.json` |

`doc/.jev-doc.json` also accepts an `exclude` list of repository paths (build output, generated reports, fixtures) that should not count as source.

The skill is a copy, so run `node install.mjs` again after pulling updates.

## Configuration

Environment variables for the hook, all optional:

| Variable | Default | Meaning |
|---|---|---|
| `JEV_DOCS_MAX` | 8 | Maximum pages injected per prompt |
| `JEV_DOCS_THRESHOLD` | 0.5 | Minimum probability for a page |
| `JEV_DOCS_GROUP_THRESHOLD` | 0.35 | Minimum probability for an area to be explored |
| `JEV_DOCS_MAX_GROUPS` | 4 | Maximum areas explored in stage 2 |
| `JEV_DOCS_GATE_THRESHOLD` | 0.3 | Below this, the prompt is treated as not needing project docs |
| `JEV_DOCS_TIMEOUT_MS` | 6000 | Timeout per Jev request |
| `JEV_DOCS_MODEL` | SDK default (`jev-latest`) | Jev model to use |
| `JEV_DOCS_DEDUP` | on | Set to `0` to inject the selected pages on every prompt, even if already suggested or read |
| `JEV_DOCS_CACHE_DIR` | `~/.claude/cache/jev-docs` | Index cache, per-session memory and last-run log |
| `TYPESAFE_BASE_URL` | `https://api.typesafe.ai` | API root, read by the TypeSafe SDK |

**Skipped automatically:** folders starting with `.` or `_`, folders named `archive`, `history`, `screenshots` or `node_modules`, and `*.prompt.md` files.

**Skipping more:** add a `.jevdocsignore` file at the root of the docs folder with one path prefix per line, relative to that folder:

```
# generated material
reports/
notes/raw/
```

**Better picks:** short, specific descriptions help the most. Add `description:` frontmatter to important pages, or keep README hubs with one descriptive line per linked page. The `create-jev-doc` skill does this for you.

## Troubleshooting

Start with `~/.claude/cache/jev-docs/last-run.json`. It records the latest run: `skipped` with a reason, or the gate and area scores, the selected pages, `alreadyKnown` (dropped by deduplication), `injected`, timings and token usage, or an `error`.

| Symptom | Likely cause |
|---|---|
| `last-run.json` never changes | The hooks aren't loaded. Restart Claude Code and check the `hooks` block in `~/.claude/settings.json`. |
| `skipped: TYPESAFE_API_KEY not set` | Claude Code can't see the key. Set it in the `env` block or in the environment Claude Code starts from, then restart. |
| `skipped: no doc/ or docs/ folder` | The project root has no `doc/`, `docs/` or `documentation/` folder. |
| `error` mentions authentication | The key is wrong or revoked. |
| `selected` is empty | No page passed the threshold. Improve the hub descriptions, or lower `JEV_DOCS_THRESHOLD`. |
| Pages are selected but `injected` is empty | They were already suggested or read in this session. That's deduplication working. |

## Privacy and data flow

On every prompt that isn't skipped, the hook sends data to TypeSafe's API (`api.typesafe.ai`, or `TYPESAFE_BASE_URL` if set):

- **The prompt you typed**, and up to the **last three user messages** of the session (each cut to 600 characters).
- **Your documentation index**: the path, title, short description and section headings of the pages in the docs folder.

It does not send code, tool output, assistant replies, full page contents or files outside the docs folder. Don't install it on projects whose prompts or doc titles can't leave your machine, and check TypeSafe's own terms for how they handle request data.

Locally, the hook writes three things under `~/.claude/cache/jev-docs/` (or `JEV_DOCS_CACHE_DIR`):

- the index cache
- `sessions/<session id>.json`, with the paths of the pages already suggested in each session. These files are deleted after two weeks without use.
- `last-run.json`, with the start of the latest prompt (up to 300 characters), the scores, and the selected and injected pages

All of this stays on your machine, and you can delete that folder at any time. To spot pages the agent already opened, the hook also reads the session transcript, locally only.

The hook reads the key only from the `TYPESAFE_API_KEY` environment variable. It never writes the key to disk or to its logs.

The `create-jev-doc` skill runs inside your agent, under that agent's own data policy. Its helper script only reads the repository and git history, only writes `doc/.jev-doc.json`, and makes no network calls.

## Uninstall

```bash
node install.mjs --uninstall
```

This removes both hooks from `~/.claude/settings.json` (after writing a backup) and the skill copies it installed. If you added `TYPESAFE_API_KEY` to the `env` block, remove it yourself. To clear the local data, delete `~/.claude/cache/jev-docs/`.

## Project layout

```
doc/                      contract-level docs for this repository, written with create-jev-doc (start at doc/README.md)
hook.mjs                  hook entry point: stdin → index → Jev → context; --dry-run and --reset
install.mjs               registers or removes the hooks and copies the skill
src/
  docs-index.mjs          finds the docs folder, parses pages and hubs, caches the index
  select.mjs              question templates, request chunking, two-stage selection, output text
  session.mjs             per-session memory of suggested pages, Read detection, reset
  transcript.mjs          recent user messages from the session transcript
skills/create-jev-doc/
  SKILL.md                create and update workflows
  references/style.md     docs layout, hub and page templates, writing rules
  scripts/doc-coverage.mjs  inventory, map, changed, check, stamp
test/                     node:test suites
```

## Contributing

Issues and pull requests are welcome. Before opening a pull request:

```bash
npm test
```

- Keep the hook fail-open. A failure must never block or alter the user's prompt.
- Keep the skill and its helper project-agnostic, with no references to any specific codebase. The helper must stay dependency-free.
- Don't add network calls beyond the TypeSafe API, and update [Privacy and data flow](#privacy-and-data-flow) when what the hook sends changes.
- Never include API keys, transcripts or private docs in issues, tests or fixtures.

## License

[MIT](LICENSE)
