# Skill files and workflows

The skill lives in [`skills/create-jev-doc/`](../../skills/create-jev-doc/SKILL.md). It has three files:

- [`SKILL.md`](../../skills/create-jev-doc/SKILL.md) is the instructions the agent loads.
- [`references/style.md`](../../skills/create-jev-doc/references/style.md) is the style guide it must read before writing.
- [`scripts/doc-coverage.mjs`](../../skills/create-jev-doc/scripts/doc-coverage.mjs) is the [coverage helper](doc-coverage.md).

The skill contains no project-specific content, so it works on any repository.

## Loading and invocation

`SKILL.md` starts with YAML frontmatter holding `name: create-jev-doc` and a `description`. Agents that support skills use the description to decide when to load the skill on their own. Claude Code also exposes it as `/create-jev-doc`, and Codex as `$create-jev-doc`. Inside the skill, paths are relative to the skill folder, so the helper runs as `node <skill-dir>/scripts/doc-coverage.mjs`. The [installer](../install/installer.md#skill-copies) copies the folder into `~/.claude/skills`, and into `~/.agents/skills` and `~/.codex/skills` when those exist. The installer also uses the `name:` line to recognize its own copies.

## Ground rules

The skill instructs the agent to:

- write only from source opened in the session, and mark unclear behavior as "not determined from source"
- describe current behavior, and keep proposals and history separate, with superseded pages in `_archive/`
- name the tests that cover a behavior, and claim a verification only if the agent ran it
- change no code. Bugs it finds go in the report.
- check `git status`, and in update mode change only the affected passages
- copy no secrets into docs

## Mode detection

The agent starts with `doc-coverage.mjs inventory`. It reports `mode: create` when there is no `doc`, `docs` or `documentation` folder, or when the folder has no `.md` page. It reports `mode: update` otherwise. A request limited to one area limits every later step to that area.

## Create workflow

1. **Survey** the entry points and classify code as product, tests, tooling, generated or vendored.
2. **Plan domains** by responsibility: 5 to 30 domains, with pages of 500 to 2,500 words. The agent shows the plan (domains, sources, exclusions, page count, order) and waits for approval before writing more than the skeleton.
3. **Write the skeleton**: `doc/README.md`, one README hub per domain, and `doc/.jev-doc.json` with `exclude` and `plan`.
4. **Fill one domain at a time**: read its sources and tests, write the pages and the hub (`## Pages` and `## Ownership`), mark the domain `done` in `plan`, and run `check`.
5. **Close the loop** with `map`: document, exclude or report each undocumented file. Then link every domain from the root hub. If an existing agent instruction file has a documentation section, add the hubs there. The skill doesn't create such a file without asking.
6. **Stamp** with `stamp`, and tell the user that the stamp covers committed code only.

## Update workflow

1. Run `changed` to get the pages to update, the new files without a page, the modified files no page references, and the deleted or renamed files still referenced.
2. For each listed page, read the diff since the baseline and the current code, then rewrite only the facts that changed.
3. Place new files on an existing page or a new one, and list any new page in a hub.
4. Fix renamed paths. Remove claims about deleted files, or move fully obsolete pages to `_archive/`.
5. Run `check`, fix what it reports, then run `stamp`.

Docs that don't follow the skill's layout are updated in place, not restructured, unless the user asks.

## The state file

`doc/.jev-doc.json` is shared by the agent and the helper:

| Field | Written by | Meaning |
|---|---|---|
| `exclude` | agent | Repository path prefixes the helper must not count as source |
| `plan` | agent | Domain name → `pending` or `done`, so a later session can resume |
| `commit` | `stamp` | HEAD at the last stamp: the baseline for `changed` |
| `updatedAt` | `stamp` | ISO time of the last stamp |
| `tool` | `stamp` | Always `create-jev-doc` |

`stamp` keeps every existing field and overwrites only the last three. The hook never reads this file: its name starts with `.`, and the index skips anything that isn't `.md`.

## The style guide

`references/style.md` defines four things:

- the folder layout: `README.md` hubs, kebab-case topic pages, `_archive/` and `_generated/`
- templates for the root hub, a domain hub and a page
- writing rules: contract-level statements, exact names, links to owning files, failure paths, units, state boundaries, prose for behavior and tables for catalogues
- a status vocabulary: current, proposal, historical, not determined from source, covered by a test, not exercised

It also sets the hub-line format `- [Title](page.md): what it covers` as the most important sentence on a hub, because that line becomes the page's description in the [docs index](../index/docs-index.md#hub-link-descriptions).

## Limits

- The workflows are instructions to an agent, not code. Whether an agent follows them, for example by waiting for plan approval, depends on the agent.
- Nothing in the skill enforces page length or style. `check` only verifies structure: links, hubs and titles.

## Verification

The skill's text has no automated test. The helper is tested as described on the [coverage helper page](doc-coverage.md#verification). This documentation folder was itself produced by following the create workflow on this repository.
