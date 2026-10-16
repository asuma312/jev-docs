#!/usr/bin/env node
// Claude Code UserPromptSubmit hook: asks Jev (TypeSafe) which pages in the
// project's doc/ or docs/ folder matter for the prompt, and injects the list
// as context. Fails open: any error, timeout or missing key injects nothing.
//
// Dry run from a shell:
//   node hook.mjs --dry-run --cwd <project> "<prompt>"
// Without TYPESAFE_API_KEY the dry run only builds the index and shows what
// it would ask.

import fs from "node:fs";
import path from "node:path";
import { buildIndex, CACHE_DIR, clip, findDocsRoot } from "./src/docs-index.mjs";
import { docQuestion, renderContext, select } from "./src/select.mjs";
import { recentUserMessages } from "./src/transcript.mjs";

function writeLog(log) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CACHE_DIR, "last-run.json"), JSON.stringify(log, null, 2));
  } catch {}
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

function parseArgs(argv) {
  const dryRun = argv.includes("--dry-run");
  const cwdIdx = argv.indexOf("--cwd");
  const cwd = cwdIdx >= 0 ? argv[cwdIdx + 1] : process.cwd();
  const prompt = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--cwd").join(" ");
  return { dryRun, cwd, prompt };
}

function printDryRunIndex(docsRoot, index, ms) {
  console.log(`docs root: ${docsRoot}`);
  console.log(`indexed ${index.docs.length} pages in ${index.groups.length} areas (${ms} ms)`);
  for (const g of index.groups) console.log(`  [${g.count}] ${clip(g.summary, 150)}`);
  console.log("\nsample page questions:");
  for (const d of index.docs.slice(0, 3)) console.log(`  ${docQuestion(d)}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let input = {};
  if (args.dryRun) {
    input = { cwd: args.cwd, prompt: args.prompt };
  } else {
    try {
      input = JSON.parse((await readStdin()) || "{}");
    } catch {
      return;
    }
  }

  const prompt = (input.prompt || "").trim();
  const projectDir = (!args.dryRun && process.env.CLAUDE_PROJECT_DIR) || input.cwd || process.cwd();
  const log = { at: new Date().toISOString(), projectDir, prompt: clip(prompt, 300), requests: [] };
  const started = Date.now();

  try {
    if (prompt.length < 8 || prompt.startsWith("/")) return void (log.skipped = "short prompt or slash command");
    const docsRoot = findDocsRoot(projectDir);
    if (!docsRoot) return void (log.skipped = "no doc/ or docs/ folder");

    const index = buildIndex(docsRoot);
    log.indexed = { docs: index.docs.length, groups: index.groups.length, ms: Date.now() - started };
    if (!index.docs.length) return void (log.skipped = "no markdown pages");
    if (args.dryRun) printDryRunIndex(docsRoot, index, log.indexed.ms);

    if (!process.env.TYPESAFE_API_KEY) {
      log.skipped = "TYPESAFE_API_KEY not set";
      if (args.dryRun) console.log("\nTYPESAFE_API_KEY not set: no request sent.");
      return;
    }

    const state = { request: prompt };
    const recent = recentUserMessages(input.transcript_path, prompt);
    if (recent.length) state.recent_requests = recent;

    const selected = await select(index, state, log);
    log.selected = selected.map((d) => `${d.rel} (${d.p.toFixed(2)})`);
    if (args.dryRun) {
      console.log(`\ngate=${log.gate?.toFixed(2)} top areas: ${(log.groups || []).slice(0, 6).join(", ")}\n`);
      console.log(selected.length ? renderContext(selected, docsRoot, projectDir) : "(nothing injected)");
      return;
    }
    if (!selected.length) return;
    const additionalContext = renderContext(selected, docsRoot, projectDir);
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext } }));
  } catch (err) {
    log.error = String(err?.message || err);
    if (args.dryRun) console.error(`error: ${log.error}`);
  } finally {
    log.totalMs = Date.now() - started;
    writeLog(log);
  }
}

main();
