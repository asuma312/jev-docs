# jev-docs documentation

This folder documents how jev-docs works, at the level needed to change it safely. It covers the Claude Code hook that picks documentation pages with Jev, the per-session memory that keeps it from repeating itself, the installer, and the `create-jev-doc` skill with its coverage helper. Every page describes current behavior of the code in this repository. For installation and usage, start with the repository [README](../README.md).

## Domains

- [Prompt hook](hook/README.md): hook entry point, stdin input, skip rules, dry-run and reset modes, output format, last-run log, fail-open behavior, and the two-stage Jev selection with its thresholds and request chunking.
- [Docs index](index/README.md): docs folder discovery, Markdown walking and skip rules, `.jevdocsignore`, page parsing, description precedence, area summaries and the index cache.
- [Session memory](session/README.md): per-session deduplication of suggested pages, detection of pages the agent already read, reset on compact or clear, session file pruning, and recent user messages sent as state.
- [Installation](install/README.md): `install.mjs` flags, settings.json backup and hook registration, skill copy targets, reinstall and uninstall behavior.
- [create-jev-doc skill](skill/README.md): the skill's files, install locations, create and update workflows, and the `doc-coverage.mjs` helper commands.
- [Testing](testing/README.md): the `node:test` suites, what each one covers, and behaviors no test exercises.

## Documentation status

All six domains were written from the source at the documented commit recorded in `.jev-doc.json`. The test suite was run while writing (13 tests, all passing). No page here was checked against a live Claude Code session or the live TypeSafe API, except where a page says so.
