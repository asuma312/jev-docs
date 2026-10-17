#!/usr/bin/env node
// Installs (or removes) jev-docs for the current user:
//   - the UserPromptSubmit hook, plus a SessionStart reset on compact/clear,
//     in Claude Code's ~/.claude/settings.json
//   - the create-jev-doc skill in ~/.claude/skills, plus ~/.agents/skills and
//     ~/.codex/skills when those agent folders exist
//
//   node install.mjs              install both
//   node install.mjs --no-skill   hook only
//   node install.mjs --skill-only skill only
//   node install.mjs --uninstall  remove both
// A backup of settings.json is written next to it before any change.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoDir = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const uninstall = args.includes("--uninstall");
const doHook = !args.includes("--skill-only");
const doSkill = !args.includes("--no-skill");

// ---------------------------------------------------------------- hook

function updateHook() {
  const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
  const hookPath = path.join(repoDir, "hook.mjs").split(path.sep).join("/");
  const command = `node "${hookPath}"`;
  // A hook is ours when it runs a hook.mjs whose package.json names jev-docs, so clones in any
  // folder are recognized. Commands of a deleted clone fall back to the old path-name check.
  const isOurs = (h) => {
    if (typeof h.command !== "string") return false;
    const m = h.command.match(/^node "(.+)[\\/]hook\.mjs"( --reset)?$/);
    if (!m) return false;
    try {
      return JSON.parse(fs.readFileSync(path.join(m[1], "package.json"), "utf8")).name === "jev-docs";
    } catch {
      return m[1].includes("jev-docs");
    }
  };
  // Suggest pages on each prompt; forget the session's pages when its context is compacted or cleared.
  const entries = {
    UserPromptSubmit: { hooks: [{ type: "command", command, timeout: 20 }] },
    SessionStart: { matcher: "compact|clear", hooks: [{ type: "command", command: `${command} --reset`, timeout: 10 }] },
  };

  let settings = {};
  if (fs.existsSync(settingsPath)) {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    fs.copyFileSync(settingsPath, `${settingsPath}.bak-${Date.now()}`);
  }
  settings.hooks ??= {};
  for (const [event, entry] of Object.entries(entries)) {
    // Drop any previous registration so reinstalling from a new path doesn't duplicate it.
    const groups = (settings.hooks[event] ?? []).map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isOurs(h)) }));
    settings.hooks[event] = groups.filter((g) => g.hooks.length);
    if (!uninstall) settings.hooks[event].push(entry);
    if (!settings.hooks[event].length) delete settings.hooks[event];
  }
  if (!Object.keys(settings.hooks).length) delete settings.hooks;

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  console.log(
    uninstall
      ? `Removed the hooks from ${settingsPath}`
      : `Hooks registered in ${settingsPath}:\n  UserPromptSubmit: ${command}\n  SessionStart (compact|clear): ${command} --reset`,
  );
  if (!uninstall && !process.env.TYPESAFE_API_KEY) {
    console.log("  TYPESAFE_API_KEY is not set in this shell. The hook stays silent until Claude Code can see it.");
  }
}

// ---------------------------------------------------------------- skill

const SKILL = "create-jev-doc";

function skillTargets() {
  const home = os.homedir();
  const targets = [path.join(home, ".claude", "skills")];
  for (const agentDir of [".agents", ".codex"]) {
    if (fs.existsSync(path.join(home, agentDir))) targets.push(path.join(home, agentDir, "skills"));
  }
  return targets;
}

function updateSkill() {
  const source = path.join(repoDir, "skills", SKILL);
  for (const dir of skillTargets()) {
    const dest = path.join(dir, SKILL);
    const ours = fs.existsSync(path.join(dest, "SKILL.md")) && fs.readFileSync(path.join(dest, "SKILL.md"), "utf8").includes(`name: ${SKILL}`);
    if (fs.existsSync(dest) && !ours) {
      console.log(`Skipped ${dest}: a different skill already uses that folder.`);
      continue;
    }
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
    if (uninstall) {
      console.log(`Removed the skill from ${dest}`);
      continue;
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.cpSync(source, dest, { recursive: true });
    console.log(`Skill installed in ${dest}`);
  }
}

if (doHook) updateHook();
if (doSkill) updateSkill();
