# create-jev-doc skill

`create-jev-doc` is an agent skill that writes and maintains a repository's docs folder in the format the hook reads best: contract-level pages listed in README hubs. It ships as plain files that any agent supporting `SKILL.md` skills can load, plus a dependency-free helper script.

## Pages

- [Skill files and workflows](skill.md): what each file in the skill contains, how agents load and invoke it, the create and update workflows, the `.jev-doc.json` state file and the ground rules the skill imposes.
- [Coverage helper](doc-coverage.md): `doc-coverage.mjs` commands (`inventory`, `map`, `changed`, `check`, `stamp`), options, source-file filters, reference detection, the changed-file algorithm and its baseline, check rules and output formats.

## Ownership

[`skills/create-jev-doc/SKILL.md`](../../skills/create-jev-doc/SKILL.md) holds the workflow the agent follows. [`skills/create-jev-doc/references/style.md`](../../skills/create-jev-doc/references/style.md) holds the layout, templates and writing rules. [`skills/create-jev-doc/scripts/doc-coverage.mjs`](../../skills/create-jev-doc/scripts/doc-coverage.mjs) is the only executable part. Installation is covered on the [installer page](../install/installer.md).
