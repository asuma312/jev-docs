import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "skills", "create-jev-doc", "scripts", "doc-coverage.mjs");

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jev-doc-cov-"));
  const g = (...a) => execFileSync("git", a, { cwd: root, stdio: "ignore" });
  g("init", "-q", "-b", "main");
  g("config", "user.email", "test@example.com");
  g("config", "user.name", "test");
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  const commit = (msg) => {
    g("add", "-A");
    g("commit", "-q", "-m", msg);
  };
  const run = (...a) => JSON.parse(execFileSync("node", [script, ...a, "--root", root, "--json"], { encoding: "utf8" }));
  return { root, write, commit, run };
}

test("inventory reports create mode and source areas without a docs folder", () => {
  const r = repo();
  r.write("src/billing/invoices.ts", "export const a = 1;\n");
  r.write("src/auth/session.ts", "export const b = 2;\n");
  r.write("dist/bundle.js", "x\n");
  r.write("package-lock.json", "{}\n");
  r.commit("init");
  const inv = r.run("inventory");
  assert.equal(inv.mode, "create");
  assert.equal(inv.docs, null);
  assert.equal(inv.sourceFiles, 2);
  assert.deepEqual(inv.areas.map((a) => a.area), ["src"]);
});

test("map and check find references, orphans and hub lines without descriptions", () => {
  const r = repo();
  r.write("src/billing/invoices.ts", "export const a = 1;\n");
  r.write("src/auth/session.ts", "export const b = 2;\n");
  r.write("doc/README.md", "# Docs\n\n- [Billing](billing/README.md): invoices and retries.\n");
  r.write("doc/billing/README.md", "# Billing\n\n## Pages\n\n- [Invoices](invoices.md)\n");
  r.write("doc/billing/invoices.md", "# Invoices\n\n[`invoices.ts`](../../src/billing/invoices.ts) owns invoices. See [gone](../../src/billing/gone.ts).\n");
  r.write("doc/billing/stray.md", "# Stray\n\nMentions `src/auth/session.ts` in passing.\n");
  r.commit("docs");

  const map = r.run("map");
  assert.equal(map.documented, 2);
  assert.deepEqual(map.undocumented, []);

  const check = r.run("check");
  assert.ok(check.broken.some((b) => b.includes("gone.ts")));
  assert.deepEqual(check.orphans, ["doc/billing/stray.md"]);
  assert.equal(check.hubLinesWithoutDesc.length, 1);
});

test("changed maps code changes to pages after a stamp", () => {
  const r = repo();
  r.write("src/billing/invoices.ts", "export const a = 1;\n");
  r.write("src/billing/old.ts", "export const o = 1;\n");
  r.write("doc/README.md", "# Docs\n\n- [Invoices](invoices.md): invoice lifecycle.\n");
  r.write("doc/invoices.md", "# Invoices\n\nOwned by `src/billing/invoices.ts`; legacy path in `src/billing/old.ts`.\n");
  r.commit("docs");
  r.run("stamp");
  r.commit("stamp");

  r.write("src/billing/invoices.ts", "export const a = 2;\n");
  r.write("src/billing/refunds.ts", "export const r = 1;\n");
  fs.rmSync(path.join(r.root, "src/billing/old.ts"));
  r.commit("change code");

  const ch = r.run("changed");
  assert.equal(ch.sinceSource, "state file");
  assert.deepEqual(Object.keys(ch.pagesToUpdate), ["doc/invoices.md"]);
  assert.deepEqual(ch.undocumentedNew.map((c) => c.file), ["src/billing/refunds.ts"]);
  assert.deepEqual(ch.brokenRefs.map((c) => c.file), ["src/billing/old.ts"]);
});
