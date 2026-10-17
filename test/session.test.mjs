import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "jev-docs-session-"));
process.env.JEV_DOCS_CACHE_DIR = cacheDir;
const s = await import("../src/session.mjs");
const repoDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("newPagesOnly drops pages already suggested or read", () => {
  const docsRoot = path.join(os.tmpdir(), "proj", "doc");
  const selected = [{ rel: "a.md" }, { rel: "b/c.md" }, { rel: "d.md" }];
  const suggested = new Set([s.pathKey(path.join(docsRoot, "a.md"))]);
  const read = new Set([s.pathKey(path.join(docsRoot, "b", "c.md"))]);
  assert.deepEqual(
    s.newPagesOnly(selected, docsRoot, suggested, read).map((d) => d.rel),
    ["d.md"],
  );
});

test("suggested pages persist per session and reset clears them", () => {
  s.saveSuggested("sess-1", new Set(["x", "y"]));
  assert.deepEqual([...s.loadSuggested("sess-1")].sort(), ["x", "y"]);
  assert.equal(s.loadSuggested("sess-2").size, 0);
  s.resetSession("sess-1");
  assert.equal(s.loadSuggested("sess-1").size, 0);
});

test("readFilesFromTranscript finds Read tool calls", () => {
  const file = path.join(cacheDir, "transcript.jsonl");
  const read = (p) => JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: p } }] } });
  const other = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "ls" } }] } });
  const target = path.join(os.tmpdir(), "proj", "doc", "a.md");
  fs.writeFileSync(file, [other, read(target), "not json"].join("\n"));
  const keys = s.readFilesFromTranscript(file);
  assert.ok(keys.has(s.pathKey(target)));
  assert.equal(keys.size, 1);
});

test("hook --reset forgets the session from stdin", () => {
  s.saveSuggested("sess-3", new Set(["x"]));
  execFileSync("node", [path.join(repoDir, "hook.mjs"), "--reset"], {
    input: JSON.stringify({ session_id: "sess-3", source: "compact" }),
    env: { ...process.env, JEV_DOCS_CACHE_DIR: cacheDir },
  });
  assert.equal(s.loadSuggested("sess-3").size, 0);
});

test("install registers both hooks once and uninstall removes them", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "jev-docs-home-"));
  fs.mkdirSync(path.join(home, ".claude"));
  const other = { type: "command", command: "echo other" };
  fs.writeFileSync(path.join(home, ".claude", "settings.json"), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [other] }] } }));
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const run = (...a) => execFileSync("node", [path.join(repoDir, "install.mjs"), "--no-skill", ...a], { env });
  const settings = () => JSON.parse(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"));

  run();
  run();
  const h = settings().hooks;
  assert.equal(h.UserPromptSubmit.length, 2);
  assert.deepEqual(h.UserPromptSubmit[0].hooks, [other]);
  assert.equal(h.SessionStart.length, 1);
  assert.equal(h.SessionStart[0].matcher, "compact|clear");
  assert.match(h.SessionStart[0].hooks[0].command, /hook\.mjs" --reset$/);

  run("--uninstall");
  assert.deepEqual(settings().hooks, { UserPromptSubmit: [{ hooks: [other] }] });
});

test("install recognizes its hooks from a clone in a folder with another name", () => {
  // No "jev-docs" anywhere in these paths, so only the package.json check can recognize the hooks.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "home-"));
  const clone = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "clone-")), "docs-hook");
  fs.mkdirSync(clone);
  for (const f of ["install.mjs", "package.json", "hook.mjs"]) fs.copyFileSync(path.join(repoDir, f), path.join(clone, f));
  // A different tool's hook.mjs, with no jev-docs package.json next to it, must be left alone.
  const foreign = { type: "command", command: `node "${path.join(home, "other-tool").split(path.sep).join("/")}/hook.mjs"` };
  fs.mkdirSync(path.join(home, ".claude"));
  fs.writeFileSync(path.join(home, ".claude", "settings.json"), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [foreign] }] } }));
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const run = (...a) => execFileSync("node", [path.join(clone, "install.mjs"), "--no-skill", ...a], { env });
  const settings = () => JSON.parse(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"));

  run();
  run();
  assert.equal(settings().hooks.UserPromptSubmit.length, 2);
  assert.equal(settings().hooks.SessionStart.length, 1);
  run("--uninstall");
  assert.deepEqual(settings().hooks, { UserPromptSubmit: [{ hooks: [foreign] }] });
});
