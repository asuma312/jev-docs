// Builds a compact, cached index of a project's Markdown documentation:
// one entry per page (path, title, short description, section headings)
// grouped by top-level folder.

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DOC_DIRS = ["doc", "docs", "documentation"];
const SKIP_DIR_NAMES = new Set(["node_modules", "archive", "history", "screenshots"]);
const SKIP_FILE_SUFFIXES = [".prompt.md"];
export const CACHE_DIR = process.env.JEV_DOCS_CACHE_DIR || path.join(os.homedir(), ".claude", "cache", "jev-docs");
const INDEX_VERSION = 4;

export const toPosix = (p) => p.split(path.sep).join("/");
export const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function findDocsRoot(projectDir) {
  for (const name of DOC_DIRS) {
    const p = path.join(projectDir, name);
    try {
      if (fs.statSync(p).isDirectory()) return p;
    } catch {}
  }
  return null;
}

function readIgnore(docsRoot) {
  try {
    return fs
      .readFileSync(path.join(docsRoot, ".jevdocsignore"), "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim().replace(/\\/g, "/").replace(/^\/+/, ""))
      .filter((l) => l && !l.startsWith("#"));
  } catch {
    return [];
  }
}

export function walkMarkdown(docsRoot) {
  const ignore = readIgnore(docsRoot);
  const files = [];
  const stack = [docsRoot];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = toPosix(path.relative(docsRoot, full));
      if (ignore.some((p) => rel === p || rel.startsWith(p.endsWith("/") ? p : `${p}/`))) continue;
      if (e.isDirectory()) {
        if (e.name.startsWith(".") || e.name.startsWith("_") || SKIP_DIR_NAMES.has(e.name)) continue;
        stack.push(full);
      } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
        if (SKIP_FILE_SUFFIXES.some((s) => e.name.toLowerCase().endsWith(s))) continue;
        files.push(full);
      }
    }
  }
  return files.sort();
}

export function stripMd(s) {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>#|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseDoc(text, fallbackTitle) {
  let body = text.replace(/^﻿/, "");
  let fmDescription = null;
  const fm = body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (fm) {
    const d = fm[1].match(/^description:\s*(.+)$/m);
    if (d) fmDescription = d[1].replace(/^["']|["']$/g, "").trim();
    body = body.slice(fm[0].length);
  }
  const lines = body.split(/\r?\n/);
  const h1 = lines.find((l) => /^#\s+/.test(l));
  const title = h1 ? stripMd(h1.replace(/^#\s+/, "")) : fallbackTitle;
  const headings = lines
    .filter((l) => /^##\s+/.test(l))
    .map((l) => stripMd(l.replace(/^##\s+/, "")))
    .filter(Boolean)
    .slice(0, 8);
  // First prose paragraph: skips headings, lists, tables and code fences.
  let inFence = false;
  const para = [];
  for (const l of lines) {
    if (/^```/.test(l)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^\s*$/.test(l)) {
      if (para.length) break;
      continue;
    }
    if (/^#|^\s*[-*|]|^\s*\d+\.\s/.test(l)) {
      if (para.length) break;
      continue;
    }
    para.push(l);
  }
  return { title, headings, fmDescription, firstParagraph: stripMd(para.join(" ")) };
}

// Descriptions written next to links in hub pages, e.g. "- [Combat](combat/README.md): ladders, ..."
export function harvestLinkDescriptions(file, text, docsRoot, out) {
  const re = /\[([^\]]+)\]\(([^)\s]+?\.md)(?:#[^)]*)?\)\s*(?::|—|–|-)\s*([^\n]+)/g;
  let m;
  while ((m = re.exec(text))) {
    const target = m[2];
    if (/^[a-z]+:\/\//i.test(target)) continue;
    const abs = path.resolve(path.dirname(file), target);
    const rel = toPosix(path.relative(docsRoot, abs));
    if (rel.startsWith("..")) continue;
    const desc = stripMd(m[3]);
    if (desc.length < 12) continue;
    const prev = out.get(rel);
    // Prefer descriptions from README/index hubs, then the longest one.
    const fromHub = /(^|[\\/])(readme|index)\.md$/i.test(file);
    const fromRoot = fromHub && path.dirname(file) === docsRoot;
    if (!prev || (fromHub && !prev.fromHub) || (fromHub === prev.fromHub && desc.length > prev.desc.length)) {
      out.set(rel, { desc, fromHub, fromRoot: fromRoot || !!prev?.fromRoot });
    } else if (fromRoot) {
      prev.fromRoot = true;
    }
  }
}

function signature(files) {
  const h = createHash("sha1");
  for (const f of files) {
    try {
      const st = fs.statSync(f);
      h.update(`${f}|${st.size}|${st.mtimeMs}\n`);
    } catch {}
  }
  return h.digest("hex");
}

export function buildIndex(docsRoot, { cache = true } = {}) {
  const files = walkMarkdown(docsRoot);
  const sig = signature(files);
  const cacheFile = path.join(CACHE_DIR, `${createHash("sha1").update(docsRoot.toLowerCase()).digest("hex").slice(0, 16)}.json`);
  if (cache) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      if (cached.version === INDEX_VERSION && cached.signature === sig) return cached;
    } catch {}
  }

  const linkDescs = new Map();
  const parsed = [];
  for (const f of files) {
    let text = "";
    try {
      text = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    harvestLinkDescriptions(f, text, docsRoot, linkDescs);
    parsed.push({ file: f, ...parseDoc(text, path.basename(f, ".md")) });
  }

  const docs = parsed.map((p) => {
    const rel = toPosix(path.relative(docsRoot, p.file));
    const desc = p.fmDescription || linkDescs.get(rel)?.desc || p.firstParagraph || "";
    let summary = p.title;
    if (desc) summary += ` — ${clip(desc, 260)}`;
    if (p.headings.length) summary += ` Sections: ${clip(p.headings.join("; "), 160)}`;
    const parts = rel.split("/");
    return { rel, group: parts.length > 1 ? parts[0] : ".", summary: clip(summary, 480) };
  });

  // One group per top-level folder (plus "." for pages at the root).
  const groups = {};
  for (const d of docs) (groups[d.group] ??= []).push(d.rel);
  const groupList = Object.entries(groups).map(([name, rels]) => {
    const readmeRel = name === "." ? "readme.md" : `${name}/readme.md`;
    const readme = docs.find((d) => d.rel.toLowerCase() === readmeRel);
    const hubDesc = linkDescs.get(name === "." ? "README.md" : `${name}/README.md`)?.desc;
    // Pages featured in the root hub first, then in any hub, then shallower pages,
    // so big areas still name their main topics within the summary budget.
    const rank = (d) => (linkDescs.get(d.rel)?.fromRoot ? 0 : linkDescs.get(d.rel)?.fromHub ? 1 : 2);
    const depth = (d) => d.rel.split("/").length;
    const topics = docs
      .filter((d) => d.group === name && d !== readme)
      .sort((a, b) => rank(a) - rank(b) || depth(a) - depth(b))
      .map((d) => d.summary.split(" — ")[0])
      .slice(0, 40)
      .join("; ");
    let summary = name === "." ? "Top-level documentation pages" : `${name}/`;
    if (hubDesc) summary += ` — ${clip(hubDesc, 240)}`;
    else if (readme) summary += ` — ${clip(readme.summary, 240)}`;
    if (topics) summary += ` Pages include: ${clip(topics, 900)}`;
    return { name, count: rels.length, summary };
  });

  const index = { version: INDEX_VERSION, signature: sig, docsRoot, builtAt: new Date().toISOString(), groups: groupList, docs };
  if (cache) {
    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(index));
    } catch {}
  }
  return index;
}
