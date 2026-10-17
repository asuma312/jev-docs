# Installation

`install.mjs` connects the repository to the user's agents. It registers the two hooks in Claude Code's user settings and copies the `create-jev-doc` skill into the agent skill folders. It doesn't install dependencies (run `npm install` first), and it doesn't handle the TypeSafe key.

## Pages

- [Installer](installer.md): flags, settings.json backup and rewrite, the two hook entries and how they're recognized on reinstall, skill copy targets and ownership check, uninstall, npm scripts, and the known path-name limitation.

## Ownership

[`install.mjs`](../../install.mjs) is the only code that writes outside the cache directory: it writes `~/.claude/settings.json`, its backups, and the skill copies. [`package.json`](../../package.json) declares the Node version, the SDK dependency and the npm scripts that wrap the installer.
