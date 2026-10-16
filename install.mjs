#!/usr/bin/env node
// Registers (or removes) the jev-docs hook in Claude Code's user settings.
//   node install.mjs              add the UserPromptSubmit hook
//   node install.mjs --uninstall  remove it
// A backup of settings.json is written next to it before any change.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
const hookPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "hook.mjs").split(path.sep).join("/");
const command = `node "${hookPath}"`;
const MARKER = "jev-docs";
const uninstall = process.argv.includes("--uninstall");

let settings = {};
if (fs.existsSync(settingsPath)) {
  settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  fs.copyFileSync(settingsPath, `${settingsPath}.bak-${Date.now()}`);
}

settings.hooks ??= {};
const groups = (settings.hooks.UserPromptSubmit ??= []);
const isOurs = (h) => typeof h.command === "string" && h.command.includes(MARKER) && h.command.includes("hook.mjs");

// Drop any previous registration so reinstalling from a new path doesn't duplicate it.
for (const g of groups) g.hooks = (g.hooks || []).filter((h) => !isOurs(h));
settings.hooks.UserPromptSubmit = groups.filter((g) => g.hooks.length);
if (!uninstall) settings.hooks.UserPromptSubmit.push({ hooks: [{ type: "command", command, timeout: 20 }] });
if (!settings.hooks.UserPromptSubmit.length) delete settings.hooks.UserPromptSubmit;
if (!Object.keys(settings.hooks).length) delete settings.hooks;

fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
console.log(uninstall ? `Removed jev-docs hook from ${settingsPath}` : `Registered in ${settingsPath}:\n  ${command}`);
if (!uninstall && !process.env.TYPESAFE_API_KEY) {
  console.log("\nTYPESAFE_API_KEY is not set in this shell. The hook stays silent until Claude Code can see it.");
}
