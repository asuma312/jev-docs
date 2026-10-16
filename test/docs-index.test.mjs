import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.JEV_DOCS_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "jev-docs-cache-"));
const { buildIndex, findDocsRoot, parseDoc } = await import("../src/docs-index.mjs");
const { chunkQuestions, renderContext } = await import("../src/select.mjs");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jev-docs-"));
  const write = (rel, text) => {
    const p = path.join(root, "doc", rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  };
  write("README.md", "# Docs\n\n- [Combat](combat/README.md): ladders, tower and arena rewards.\n");
  write("combat/README.md", "# Combat\n\nHow fights work.\n\n## Pages\n");
  write("combat/tower.md", "---\ndescription: Tower floors and rewards\n---\n# Tower\n\nBody.\n");
  write("combat/old.prompt.md", "# Art prompt\n");
  write("_archive/legacy.md", "# Legacy\n");
  write("ui/history/v1.md", "# Old UI\n");
  write("ui/modal.md", "# Modals\n\nShared modal rules.\n");
  fs.writeFileSync(path.join(root, "doc", ".jevdocsignore"), "ui/modal.md\n");
  return root;
}

test("parseDoc reads title, headings, frontmatter and first paragraph", () => {
  const d = parseDoc("---\ndescription: From frontmatter\n---\n# Title\n\nFirst *para*.\n\n## A\n## B\n", "x");
  assert.equal(d.title, "Title");
  assert.equal(d.fmDescription, "From frontmatter");
  assert.equal(d.firstParagraph, "First para.");
  assert.deepEqual(d.headings, ["A", "B"]);
});

test("buildIndex skips archives, history, prompt files and ignored paths", () => {
  const root = fixture();
  const index = buildIndex(findDocsRoot(root), { cache: false });
  assert.deepEqual(index.docs.map((d) => d.rel).sort(), ["README.md", "combat/README.md", "combat/tower.md"]);
});

test("descriptions come from frontmatter first, then hub links", () => {
  const root = fixture();
  const index = buildIndex(findDocsRoot(root), { cache: false });
  const by = Object.fromEntries(index.docs.map((d) => [d.rel, d.summary]));
  assert.match(by["combat/tower.md"], /Tower floors and rewards/);
  assert.match(by["combat/README.md"], /ladders, tower and arena rewards/);
  const combat = index.groups.find((g) => g.name === "combat");
  assert.match(combat.summary, /ladders, tower and arena rewards/);
});

test("chunkQuestions respects the character budget", () => {
  const q = { type: "noul", instructions: "x".repeat(100) };
  const chunks = chunkQuestions(
    Array.from({ length: 10 }, (_, i) => [`d${i}`, q]),
    500,
  );
  assert.ok(chunks.length > 1);
  assert.equal(chunks.reduce((n, c) => n + Object.keys(c).length, 0), 10);
});

test("renderContext lists paths relative to the project", () => {
  const out = renderContext([{ rel: "combat/tower.md", summary: "Tower" }], "/p/doc", "/p");
  assert.match(out, /- doc\/combat\/tower\.md — Tower/);
});
