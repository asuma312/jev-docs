import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const hook = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "hook.mjs");

function runHook(input, env) {
  return new Promise((resolve) => {
    const child = spawn("node", [hook], { env: { ...process.env, ...env } });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.on("close", (code) => resolve({ code, stdout }));
    child.stdin.end(JSON.stringify(input));
  });
}

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hook-project-"));
  fs.mkdirSync(path.join(dir, "doc", "billing"), { recursive: true });
  fs.writeFileSync(path.join(dir, "doc", "README.md"), "# Docs\n\n- [Billing](billing/README.md): invoices and retries.\n");
  fs.writeFileSync(path.join(dir, "doc", "billing", "README.md"), "# Billing\n\n## Pages\n\n- [Invoices](invoices.md): invoice lifecycle.\n");
  fs.writeFileSync(path.join(dir, "doc", "billing", "invoices.md"), "# Invoices\n\nHow invoices work.\n");
  return dir;
}

test("the deadline aborts a hanging API and the hook exits quietly with a logged error", async () => {
  // A local stand-in for the API that accepts requests and never answers.
  const server = http.createServer(() => {});
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "hook-cache-"));
  try {
    const t0 = Date.now();
    const { code, stdout } = await runHook(
      { prompt: "change how invoices are numbered", cwd: project(), session_id: "s1" },
      {
        TYPESAFE_API_KEY: "test-key",
        TYPESAFE_BASE_URL: `http://127.0.0.1:${server.address().port}`,
        JEV_DOCS_DEADLINE_MS: "1500",
        JEV_DOCS_CACHE_DIR: cache,
        CLAUDE_PROJECT_DIR: "",
      },
    );
    const elapsed = Date.now() - t0;
    assert.equal(code, 0);
    assert.equal(stdout, "");
    assert.ok(elapsed < 4000, `hook took ${elapsed} ms`);

    const log = JSON.parse(fs.readFileSync(path.join(cache, "last-run.json"), "utf8"));
    assert.match(log.error, /deadline/);
    assert.equal(typeof log.startupMs, "number");
    assert.equal(typeof log.phases.index, "number");
    const history = fs.readFileSync(path.join(cache, "runs.jsonl"), "utf8").trim().split("\n");
    assert.equal(history.length, 1);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("skipped runs are appended to the history too", async () => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "hook-cache-"));
  const env = { JEV_DOCS_CACHE_DIR: cache, CLAUDE_PROJECT_DIR: "" };
  await runHook({ prompt: "/help", cwd: os.tmpdir() }, env);
  await runHook({ prompt: "<task-notification>done</task-notification>", cwd: os.tmpdir() }, env);
  const runs = fs.readFileSync(path.join(cache, "runs.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(
    runs.map((r) => r.skipped),
    ["short prompt or slash command", "app-generated message"],
  );
});
