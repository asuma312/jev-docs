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

test("changed handles paths with spaces and accents, committed and in the working tree", () => {
  const r = repo();
  r.write("src/configuração.js", "export const c = 1;\n");
  r.write("src/with space.js", "export const s = 1;\n");
  r.write("src/old name.js", "export const o = 1;\n");
  r.write("doc/README.md", "# Docs\n\n- [Config](config.md): configuration loading.\n");
  r.write("doc/config.md", "# Config\n\nOwned by [config](../src/configuração.js), [space](../src/with%20space.js) and `src/old name.js`.\n");
  r.commit("docs");
  r.run("stamp");
  r.commit("stamp");

  r.write("src/configuração.js", "export const c = 2;\n");
  r.commit("committed change");
  r.write("src/with space.js", "export const s = 2;\n");
  r.write("src/novo módulo.js", "export const n = 1;\n");
  execFileSync("git", ["mv", "src/old name.js", "src/new name.js"], { cwd: r.root });

  const ch = r.run("changed");
  assert.deepEqual(ch.pagesToUpdate["doc/config.md"].sort(), ["M src/configuração.js", "M src/with space.js", "src/old name.js → src/new name.js"]);
  assert.deepEqual(ch.undocumentedNew.map((c) => c.file), ["src/novo módulo.js"]);
});

test("check ignores links inside code, survives bad escapes and reports layout", () => {
  const r = repo();
  r.write("src/a.js", "export const a = 1;\n");
  r.write("doc/README.md", "# Docs\n\n- [Area](area/README.md): the area.\n");
  r.write("doc/area/README.md", "# Area\n\n## Pages\n\n- [Page](page.md): what the page covers.\n\nFormat: `- [Title](example.md): text`\n");
  r.write(
    "doc/area/page.md",
    "# Page\n\nSee [`a.js`](../../src/a.js) and [bad](50%.md).\n\n```md\n- [Example](nowhere.md): shown as code\n```\n",
  );
  r.commit("docs");
  const check = r.run("check");
  assert.deepEqual(check.broken, ["doc/area/page.md → 50%.md"]);
  assert.equal(check.layout.conforms, true);
  assert.equal(r.run("map").documented, 1);

  r.write("doc/flat.md", "# Flat\n\nA page at the root.\n");
  r.commit("flat page");
  const flat = r.run("check").layout;
  assert.equal(flat.conforms, false);
  assert.deepEqual(flat.pagesOutsideDomains, ["doc/flat.md"]);
  assert.deepEqual(flat.pagesNotInAnyHub, ["doc/flat.md"]);
});

test("check reports docs with no domains or hubs as not conforming", () => {
  const r = repo();
  r.write("src/a.js", "export const a = 1;\n");
  r.write("docs/setup.md", "# Setup\n\nHow to set up.\n");
  r.write("docs/api.md", "# API\n\nEndpoints.\n");
  r.commit("flat docs");
  const layout = r.run("check").layout;
  assert.equal(layout.conforms, false);
  assert.equal(layout.missingRootHub, true);
  assert.deepEqual(layout.domains, []);
  assert.equal(layout.pagesOutsideDomains.length, 2);
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
