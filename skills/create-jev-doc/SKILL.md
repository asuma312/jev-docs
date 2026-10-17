---
name: create-jev-doc
description: Create or update a repository's doc/ folder as contract-level documentation organized in README hubs, so people, agents and the jev-docs hook can find the right page for any task. Use when the user asks to document a repository or a part of it, to create a docs folder, to bring existing docs up to date with the code, or invokes create-jev-doc. Works in any language or stack.
---

# Create or update Jev-ready documentation

Produce documentation that states what the code actually does, at the level of detail someone needs to change it safely: owners, entry points, state, ordering, failure behavior, limits and evidence. Organize it as a tree of README hubs where every page is listed with a one-line description. That hub line is what the jev-docs hook shows Jev when it picks pages for a prompt, so its quality decides whether the right page is found.

Paths below are relative to this skill. Read [the style guide](references/style.md) before writing any page. It defines the folder layout, the three page templates and the writing rules.

## Ground rules

- **Read the code before you write about it.** Every statement must come from source you opened in this session: a file, a test, a config, a schema. Never describe behavior from names, comments or memory alone. If something is unclear, say so on the page ("not determined from source") instead of guessing.
- **Document current behavior.** Mark proposals, plans and historical material explicitly, and keep them out of current contracts. Superseded pages go to `_archive/`.
- **Be honest about evidence.** Name the tests that cover a behavior, and say whether you ran them. Never write that something was verified, tested or validated unless you ran it now and saw it pass.
- **Don't change code.** This skill only writes documentation. If you find a bug, note it in your report to the user, not as a silent fix.
- **Preserve existing work.** Check `git status` first. In update mode, change only the passages the code change affects, keep the existing voice and structure, and never delete a page the user wrote without asking.
- **No secrets.** Never copy keys, tokens, passwords or real user data into docs. Describe credentials by variable name only.

## Start: detect the mode

Run the helper from the repository root (Node.js 18 or newer):

```bash
node <skill-dir>/scripts/doc-coverage.mjs inventory
```

It reports the source areas with file and line counts, whether a `doc/`, `docs/` or `documentation/` folder exists, and the last documented commit. `mode: create` means there is no docs folder or it is empty. `mode: update` means pages already exist. If the user asked for one area only ("document the payments module"), limit every step below to that area.

The helper's other commands: `map` (which pages reference which source files, and what is undocumented), `changed` (source changes since the last documented commit, with the pages each one affects), `check` (broken links, orphan pages, folders without a hub, hub lines without descriptions) and `stamp` (records HEAD as documented). Add `--json` for machine-readable output and `--limit <n>` for longer lists.

## Create mode

1. **Survey.** From the inventory, open the entry points (main files, routers, CLI commands, build config, package manifests) and the existing README. Decide what is product code, what is tests, tooling, generated output or vendored code. Generated reports, build output, fixtures and third-party code usually get no pages.
2. **Plan the domains.** Group the code by feature or responsibility, not by folder alone. A domain is something a person would ask about ("authentication", "billing", "build pipeline"). Aim for 5 to 30 domains, and plan pages of 500 to 2,500 words, one topic each. Show the user the plan: the domain list, what each covers, the source folders behind it, the paths you will exclude and a rough page count. For a large repository, also propose an order. Wait for approval before writing more than the skeleton.
3. **Write the skeleton.** Create `doc/README.md` (the root hub), one `README.md` per domain folder, and `doc/.jev-doc.json`:
   ```json
   {
     "exclude": ["dist", "reports", "test/fixtures"],
     "plan": { "auth": "pending", "billing": "pending" }
   }
   ```
   `exclude` lists repository paths the helper should not count as source. `plan` tracks progress so a later session can resume. Use `.jevdocsignore` in the docs folder for pages the hook should not offer (raw notes, generated pages).
4. **Fill one domain at a time.** For each domain: read its sources fully, including the tests, then write the pages following the page template. Then write the domain hub with a `## Pages` list and an `## Ownership` paragraph. Mark the domain `done` in `plan`. Run `check` after each domain and fix what it reports. For large repositories, finish and report a few domains per session rather than skimming all of them.
5. **Close the loop.** Run `map` and look at the undocumented files. Either document them, add their area to `exclude` with a reason, or list them in your report as left out. Link every domain from the root hub. If the repository has an agent instruction file (`CLAUDE.md`, `AGENTS.md` or similar) with a documentation section, add the new hubs there. Don't create one without asking.
6. **Stamp.** Run `stamp` after the pages are written, so the next update knows where to start. Tell the user that the stamp only covers committed code: uncommitted changes are documented but will show up as changed again next time.

## Update mode

1. **Find what moved.** Run `changed`. The baseline is the commit in `.jev-doc.json`, or the last commit that touched the docs folder. Pass `--since <commit>` to override it. You get four lists: pages to update with the sources that changed under them, new source files with no page, modified files no page references, and deleted or renamed files that pages still link to.
2. **Update affected pages.** For each listed page, read the diff of its changed sources (`git diff <baseline> -- <file>`) and the current code around it. Then rewrite only the sentences, tables and sections whose facts changed. Keep the rest byte-for-byte. If a change invalidates a whole section, rewrite that section. Update the page's hub line if the page now covers something different.
3. **Place new code.** Add each new source file to the page that owns its responsibility, or create a new page and list it in the domain hub. A new top-level responsibility gets a new domain folder and a root hub entry.
4. **Fix references.** Point renamed paths to their new location. For deleted files, remove the claims that depended on them, or move the page to `_archive/` when the whole feature is gone.
5. **Check and stamp.** Run `check`, fix broken links and missing hub lines, then run `stamp`.

If the existing docs don't follow this skill's layout, don't restructure them unless the user asks. Update them in place, follow the style guide for new pages, and make sure every page you add or touch is listed in a hub with a description.

## Report

End with a short report to the user:

- the pages created and updated, grouped by domain
- coverage before and after, from `map`
- what was excluded or left undocumented, and why
- anything you couldn't determine from the source
- which tests you ran, if any, and what they showed
