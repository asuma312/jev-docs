# Installer

[`install.mjs`](../../install.mjs) registers the jev-docs hooks in `~/.claude/settings.json` and copies the `create-jev-doc` skill to the user's skill folders, or removes both. It runs once, synchronously. Paths come from `os.homedir()`, which on Windows reads `USERPROFILE`.

## Flags

| Flag | Effect |
|---|---|
| none | Install the hooks and the skill |
| `--no-skill` | Hooks only |
| `--skill-only` | Skill only |
| `--uninstall` | Remove, in the parts the other flags select (both by default) |

The flags combine: `--uninstall --no-skill` removes only the hooks. [`package.json`](../../package.json) wraps the installer as `npm run install-hook` and `npm run uninstall-hook`. Despite their names, both also act on the skill, because they pass no other flag. The engine requirement is Node 22 or newer, which the TypeSafe SDK requires too.

## Hooks in settings.json

`updateHook` reads `~/.claude/settings.json` if it exists. Before changing anything it copies the file to `settings.json.bak-<epoch milliseconds>`, a new backup on every run. If the file isn't valid JSON, `JSON.parse` throws and the installer stops without writing.

The hook command is `node "<repo>/hook.mjs"`, with the repository's absolute path in forward slashes. Two entries are managed:

| Event | Entry |
|---|---|
| `UserPromptSubmit` | `{ hooks: [{ type: "command", command, timeout: 20 }] }` |
| `SessionStart` | `{ matcher: "compact\|clear", hooks: [{ type: "command", command: command + " --reset", timeout: 10 }] }` |

For each event, the installer removes every existing hook that `isOurs` recognizes, and drops groups that end up empty. `isOurs` accepts a command only if it has the exact shape `node "<dir>/hook.mjs"`, optionally followed by ` --reset`. It then reads `<dir>/package.json` and accepts the hook when its `name` is `jev-docs`, so a clone in a folder with any name is recognized. When that `package.json` can't be read (for example, the clone was deleted), it falls back to accepting `<dir>` paths that contain `jev-docs`. On install it then appends its entry. Empty event arrays are deleted, and so is an empty `hooks` object. Other hooks and every other setting are kept as they were. The file is rewritten with two-space indentation and a trailing newline. Because previous entries are removed first, running the installer again, even from a moved checkout, leaves exactly one entry per event.

After installing, the installer warns if `TYPESAFE_API_KEY` isn't set in its own shell. That variable doesn't tell it whether Claude Code can see the key, so the message is only a reminder.

## Skill copies

`skillTargets` always includes `~/.claude/skills`. It adds `~/.agents/skills` and `~/.codex/skills` only when `~/.agents` or `~/.codex` exists. For each target, the destination is `<target>/create-jev-doc`:

- If the destination exists but has no `SKILL.md`, or one without `name: create-jev-doc`, the installer prints that it skipped the folder and leaves it alone.
- Otherwise it deletes any existing copy, then either stops there (uninstall) or copies `skills/create-jev-doc` recursively with `fs.cpSync`.

The copy is a snapshot. Changes to the skill in the repository reach the agents only after the installer runs again.

## Limits

- An entry left by a clone that was later deleted, from a folder whose path doesn't contain `jev-docs`, can't be recognized, because neither check applies. Remove it from settings.json by hand.
- A different tool's `hook.mjs` in a folder whose path contains `jev-docs` and has no readable `package.json` would be treated as ours by the fallback.
- Backups accumulate, one per run, and are never cleaned up.
- The installer doesn't write the API key and doesn't remove one from the `env` block on uninstall.
- Claude Code loads hooks at startup, so a restart is needed after installing or uninstalling.

## Verification

[`test/session.test.mjs`](../../test/session.test.mjs) runs the installer with `--no-skill` against a temporary home folder (`HOME` and `USERPROFILE` set to it), with an unrelated existing hook. It checks:

- running it twice leaves one entry per event and keeps the unrelated hook
- the `SessionStart` matcher and the `--reset` command
- `--uninstall` restores the original hooks

A second test copies `install.mjs`, `package.json` and `hook.mjs` into a folder named `docs-hook`, under paths that never contain `jev-docs`, next to a foreign `hook.mjs` hook. It checks that two runs leave one entry per event, and that uninstall removes ours and keeps the foreign one.

The skill copy and the skip of a foreign folder have no automated test. They were exercised by hand during development: the installer reported copies to all three folders on the development machine. The suite was run while writing this page: 24 tests, all passing.
