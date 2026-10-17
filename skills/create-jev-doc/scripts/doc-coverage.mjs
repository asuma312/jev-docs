#!/usr/bin/env node
// Coverage helper for the create-jev-doc skill. No dependencies.
//
//   node doc-coverage.mjs inventory   source areas, file and line counts, docs folder status
//   node doc-coverage.mjs map         which pages reference which source files; undocumented files
//   node doc-coverage.mjs changed     source changes since the last documented commit, with affected pages
//   node doc-coverage.mjs check       broken links, orphan pages, folders without README, hub lines without descriptions
//   node doc-coverage.mjs stamp       record HEAD as the documented commit in <docs>/.jev-doc.json
//
// Options: --root <repo> (default: git top level or cwd), --doc <dir> (default: doc, docs or
// documentation), --since <commit> (changed only), --limit <n> (list length, default 60), --json.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DOC_DIRS = ["doc", "docs", "documentation"];
const STATE_FILE = ".jev-doc.json";
const CODE_EXT = new Set(
  "js mjs cjs jsx ts tsx mts cts vue svelte astro py pyi go rs java kt kts scala rb php cs fs swift m mm c cc cpp cxx h hh hpp ex exs erl clj dart lua gd gdshader r jl zig nim sql graphql proto sh bash zsh ps1 bat html htm css scss sass less yml yaml toml ini tf hcl dockerfile".split(
    " ",
  ),
);
const SKIP_DIRS = new Set([
  "node_modules", "vendor", "vendors", "third_party", "third-party", "dist", "build", "out", "target",
  "coverage", ".git", ".next", ".nuxt", ".cache", ".venv", "venv", "__pycache__", ".idea", ".vscode",
  "Pods", "DerivedData", ".gradle", "bin", "obj",
]);
const SKIP_FILES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock)$|\.min\.(js|css)$|\.map$/i;
const MAX_BYTES = 1_000_000;

// ---------------------------------------------------------------- args

const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith("--") ? argv[0] : "inventory";
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const asJson = argv.includes("--json");
const limit = Number(opt("limit", 60)) || 60;

const git = (args, cwd) => {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 });
  } catch {
    return null;
  }
};

const root = path.resolve(opt("root", (git(["rev-parse", "--show-toplevel"], process.cwd()) || process.cwd()).trim()));
const isGit = git(["rev-parse", "--is-inside-work-tree"], root)?.trim() === "true";
const docName =
  opt("doc", null) ||
  DOC_DIRS.find((d) => {
    try {
      return fs.statSync(path.join(root, d)).isDirectory();
    } catch {
      return false;
    }
  }) ||
  null;
const docRoot = docName ? path.join(root, docName) : null;
const docRel = docName ? docName.replace(/\\/g, "/").replace(/\/+$/, "") : null;
const toPosix = (p) => p.split(path.sep).join("/");

function readState() {
  if (!docRoot) return {};
  try {
    return JSON.parse(fs.readFileSync(path.join(docRoot, STATE_FILE), "utf8"));
  } catch {
    return {};
  }
}
const state = readState();
const extraExcludes = (state.exclude || []).map((p) => p.replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""));

// ---------------------------------------------------------------- files

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") && e.name !== ".github") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(full, out);
    } else if (e.isFile()) out.push(toPosix(path.relative(root, full)));
  }
  return out;
}

function allRepoFiles() {
  if (isGit) {
    const listed = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"], root);
    if (listed != null) return [...new Set(listed.split("\0").filter(Boolean))];
  }
  return walk(root, []);
}

function isSource(rel) {
  const parts = rel.split("/");
  if (parts.slice(0, -1).some((p) => SKIP_DIRS.has(p) || (p.startsWith(".") && p !== ".github"))) return false;
  if (docRel && (rel === docRel || rel.startsWith(`${docRel}/`))) return false;
  if (extraExcludes.some((p) => rel === p || rel.startsWith(`${p}/`))) return false;
  if (SKIP_FILES.test(rel)) return false;
  const base = parts.at(-1).toLowerCase();
  const ext = base === "dockerfile" ? "dockerfile" : base.includes(".") ? base.split(".").pop() : "";
  if (!CODE_EXT.has(ext)) return false;
  try {
    const st = fs.statSync(path.join(root, rel));
    return st.isFile() && st.size <= MAX_BYTES;
  } catch {
    return false;
  }
}

const countLines = (rel) => {
  try {
    const s = fs.readFileSync(path.join(root, rel), "utf8");
    return s ? s.split("\n").length : 0;
  } catch {
    return 0;
  }
};

function docPages() {
  if (!docRoot) return [];
  const out = [];
  const rec = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!e.name.startsWith(".") && e.name !== "node_modules") rec(full);
      } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) out.push(full);
    }
  };
  rec(docRoot);
  return out.sort();
}
const pageRel = (abs) => toPosix(path.relative(root, abs));
// Raw prompt/asset notes kept in the docs tree; the Jev hook skips them too.
const isPromptFile = (rel) => rel.toLowerCase().endsWith(".prompt.md");
const isHistorical = (rel) => /(^|\/)(_archive|_generated|archive|history)(\/|$)/.test(rel.slice(docRel.length + 1));

// ---------------------------------------------------------------- references

const LINK_RE = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const PATH_TOKEN_RE = /[`'"(\s]((?:\.{1,2}\/)*[\p{L}\p{N}_@.\-]+(?:\/[\p{L}\p{N}_@.\-]+)+\.[\p{L}\p{N}]+)(?=[`'")\s:,;.]|$)/gu;
// A whole inline code span can name a file with spaces, e.g. `src/old name.js`.
const INLINE_CODE_RE = /`([^`\n]+)`/g;

// Text with fenced code blocks emptied and inline code spans replaced by a word, so that
// example links shown as code aren't read as links. "[`file.js`](path)" keeps its link.
function withoutCode(text) {
  const out = [];
  let fence = null;
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      out.push("");
    } else if (m) {
      fence = m[1];
      out.push("");
    } else out.push(line.replace(/(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g, "code"));
  }
  return out.join("\n");
}

const safeDecode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

function referencesOf(abs, fileSet) {
  const text = fs.readFileSync(abs, "utf8");
  const dir = path.dirname(abs);
  const refs = new Set();
  const links = [];
  const consider = (raw, fromLink) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("#")) return;
    const clean = safeDecode(raw.split("#")[0].split("?")[0]);
    if (!clean) return;
    const viaPage = toPosix(path.relative(root, path.resolve(dir, clean)));
    const viaRoot = clean.replace(/^\.?\//, "");
    if (fromLink) links.push({ raw, target: viaPage });
    if (fileSet.has(viaPage)) refs.add(viaPage);
    else if (!fromLink && fileSet.has(viaRoot)) refs.add(viaRoot);
  };
  let m;
  // Links only outside code; path tokens anywhere, since files are usually named in backticks.
  const prose = withoutCode(text);
  while ((m = LINK_RE.exec(prose))) consider(m[1], true);
  while ((m = PATH_TOKEN_RE.exec(` ${text}`))) consider(m[1], false);
  while ((m = INLINE_CODE_RE.exec(text))) if (m[1].includes("/")) consider(m[1].trim(), false);
  return { refs, links, text };
}

function buildMap(sources) {
  const fileSet = new Set(sources);
  const pages = docPages();
  const byPage = new Map();
  const bySource = new Map(sources.map((s) => [s, []]));
  for (const abs of pages) {
    const rel = pageRel(abs);
    const { refs } = referencesOf(abs, fileSet);
    byPage.set(rel, [...refs]);
    if (isHistorical(rel)) continue;
    for (const r of refs) bySource.get(r)?.push(rel);
  }
  return { pages, byPage, bySource };
}

// ---------------------------------------------------------------- areas

function areas(sources) {
  const groups = new Map();
  for (const s of sources) {
    const parts = s.split("/");
    const top = parts.length > 1 ? parts[0] : "(root)";
    const g = groups.get(top) || { area: top, files: 0, lines: 0, sub: new Map() };
    const lines = countLines(s);
    g.files++;
    g.lines += lines;
    if (parts.length > 2) {
      const sub = `${parts[0]}/${parts[1]}`;
      const sg = g.sub.get(sub) || { area: sub, files: 0, lines: 0 };
      sg.files++;
      sg.lines += lines;
      g.sub.set(sub, sg);
    }
    groups.set(top, g);
  }
  return [...groups.values()]
    .sort((a, b) => b.lines - a.lines)
    .map((g) => ({ ...g, sub: [...g.sub.values()].sort((a, b) => b.lines - a.lines) }));
}

// ---------------------------------------------------------------- commands

function print(obj, text) {
  if (asJson) console.log(JSON.stringify(obj, null, 2));
  else console.log(text);
}

const list = (arr, fmt = (x) => x) =>
  arr.length ? arr.slice(0, limit).map((x) => `  - ${fmt(x)}`).join("\n") + (arr.length > limit ? `\n  … ${arr.length - limit} more (use --limit)` : "") : "  (none)";

function cmdInventory() {
  const sources = allRepoFiles().filter(isSource);
  const a = areas(sources);
  const totalLines = a.reduce((n, g) => n + g.lines, 0);
  const mode = docRoot && docPages().length ? "update" : "create";
  const obj = { root, git: isGit, docs: docRel, mode, documentedCommit: state.commit || null, sourceFiles: sources.length, sourceLines: totalLines, areas: a };
  const lines = [
    `repo: ${root}${isGit ? "" : " (not a git repository)"}`,
    `docs folder: ${docRel ? `${docRel}/ (${docPages().length} pages)` : "none"} → mode: ${mode}`,
    `documented commit: ${state.commit || "none recorded"}`,
    `source: ${sources.length} files, ${totalLines} lines`,
    "",
    "areas (largest first):",
    ...a.slice(0, limit).flatMap((g) => [
      `  ${g.area}: ${g.files} files, ${g.lines} lines`,
      ...(g.files > 25 ? g.sub.slice(0, 12).map((s) => `      ${s.area}: ${s.files} files, ${s.lines} lines`) : []),
    ]),
  ];
  print(obj, lines.join("\n"));
}

function cmdMap() {
  if (!docRoot) return print({ error: "no docs folder" }, "No docs folder yet (doc/, docs/ or documentation/). Nothing to map.");
  const sources = allRepoFiles().filter(isSource);
  const { byPage, bySource } = buildMap(sources);
  const undocumented = [...bySource].filter(([, p]) => !p.length).map(([s]) => s);
  const documented = sources.length - undocumented.length;
  const obj = {
    sourceFiles: sources.length,
    documented,
    coverage: sources.length ? documented / sources.length : 1,
    undocumented,
    pages: Object.fromEntries(byPage),
  };
  const undocAreas = areas(undocumented).map((g) => `${g.area}: ${g.files} files, ${g.lines} lines`);
  print(
    obj,
    [
      `coverage: ${documented}/${sources.length} source files referenced by a current page (${(obj.coverage * 100).toFixed(1)}%)`,
      "",
      "undocumented by area:",
      list(undocAreas),
      "",
      "undocumented files:",
      list(undocumented),
    ].join("\n"),
  );
}

function cmdChanged() {
  if (!isGit) return print({ error: "not a git repository" }, "Not a git repository: changes cannot be computed. Use `map` to find undocumented files.");
  if (!docRoot) return print({ error: "no docs folder" }, "No docs folder yet: run the create workflow instead.");
  let since = opt("since", state.commit || null);
  let sinceSource = since === state.commit ? "state file" : "--since";
  // `git cat-file -e` prints nothing on success, so only a null (failed) result means unknown.
  if (since && git(["cat-file", "-e", `${since}^{commit}`], root) === null) since = null;
  if (!since) {
    since = git(["log", "-1", "--format=%H", "--", docRel], root)?.trim() || null;
    sinceSource = "last commit touching the docs folder";
  }
  if (!since) return print({ error: "no baseline commit" }, "No baseline commit found. Pass --since <commit>.");

  const changes = new Map();
  const add = (status, file, oldFile) => changes.set(file, { status, file, oldFile });
  // -z keeps paths unquoted (spaces, accents), so they match the ls-files names.
  // diff: "<status>\0<path>\0", or "R<score>\0<old>\0<new>\0" for renames and copies.
  const diffFields = (git(["diff", "--name-status", "-z", "-M", since, "HEAD"], root) || "").split("\0");
  for (let i = 0; i < diffFields.length - 1; ) {
    const st = diffFields[i++];
    if (!st) continue;
    if (st[0] === "R" || st[0] === "C") {
      const from = diffFields[i++];
      const to = diffFields[i++];
      if (st[0] === "R") add("R", to, from);
      else add("A", to);
    } else add(st[0], diffFields[i++]);
  }
  // status: "XY <path>\0", or "XY <new>\0<old>\0" for renames and copies.
  const statusFields = (git(["status", "--porcelain", "-z", "-uall"], root) || "").split("\0");
  for (let i = 0; i < statusFields.length; i++) {
    const entry = statusFields[i];
    if (entry.length < 4) continue;
    const st = entry.slice(0, 2);
    const file = entry.slice(3);
    if (st.includes("R") || st.includes("C")) {
      const from = statusFields[++i];
      if (st.includes("R")) add("R", file, from);
      else add("A", file);
    } else if (st.includes("D")) add("D", file);
    else if (st === "??" || st.includes("A")) add(changes.get(file)?.status === "M" ? "M" : "A", file);
    else if (!changes.has(file)) add("M", file);
  }

  const sources = allRepoFiles().filter(isSource);
  const removed = [...changes.values()].filter((c) => c.status === "D" || c.status === "R").map((c) => c.oldFile || c.file);
  const { bySource } = buildMap([...new Set([...sources, ...removed])]);
  const relevant = [...changes.values()].filter((c) => isSource(c.file) || ((c.status === "D" || c.status === "R") && bySource.has(c.oldFile || c.file)));

  const update = [];
  const undocumentedNew = [];
  const undocumentedModified = [];
  const brokenRefs = [];
  for (const c of relevant) {
    const pagesNow = bySource.get(c.file) || [];
    const pagesOld = c.oldFile ? bySource.get(c.oldFile) || [] : [];
    if (c.status === "D") {
      if (pagesNow.length) brokenRefs.push({ ...c, pages: pagesNow });
    } else if (c.status === "R") {
      if (pagesOld.length) brokenRefs.push({ ...c, pages: pagesOld });
      if (!pagesOld.length && !pagesNow.length) undocumentedNew.push(c);
    } else if (pagesNow.length) update.push({ ...c, pages: pagesNow });
    else if (c.status === "A") undocumentedNew.push(c);
    else undocumentedModified.push(c);
  }
  const pagesToUpdate = new Map();
  for (const u of [...update, ...brokenRefs]) for (const p of u.pages) (pagesToUpdate.get(p) || pagesToUpdate.set(p, []).get(p)).push(u.status === "R" ? `${u.oldFile} → ${u.file}` : `${u.status} ${u.file}`);

  const obj = { since, sinceSource, pagesToUpdate: Object.fromEntries(pagesToUpdate), undocumentedNew, undocumentedModified, brokenRefs };
  print(
    obj,
    [
      `baseline: ${since.slice(0, 12)} (${sinceSource}); ${relevant.length} source changes since then (committed and working tree)`,
      "",
      "pages to update (page ← changed sources):",
      list([...pagesToUpdate], ([p, files]) => `${p} ← ${files.join(", ")}`),
      "",
      "new source files with no page yet:",
      list(undocumentedNew, (c) => (c.oldFile ? `${c.oldFile} → ${c.file}` : c.file)),
      "",
      "modified source files that no page references:",
      list(undocumentedModified, (c) => c.file),
      "",
      "deleted or renamed files still referenced:",
      list(brokenRefs, (c) => `${c.oldFile || c.file}${c.status === "R" ? ` → ${c.file}` : " (deleted)"} in ${c.pages.join(", ")}`),
    ].join("\n"),
  );
}

function cmdCheck() {
  if (!docRoot) return print({ error: "no docs folder" }, "No docs folder yet.");
  const pages = docPages();
  const allFiles = new Set(allRepoFiles());
  for (const p of pages) allFiles.add(pageRel(p));
  const linkedPages = new Set();
  const hubLinked = new Set();
  const broken = [];
  const missingH1 = [];
  const hubLinesWithoutDesc = [];
  const isHub = (rel) => /(^|\/)readme\.md$/i.test(rel);
  for (const abs of pages) {
    const rel = pageRel(abs);
    const { links, text } = referencesOf(abs, allFiles);
    if (!isHistorical(rel) && !isPromptFile(rel) && !/^#\s+\S/m.test(text.replace(/^---[\s\S]*?\n---\n/, ""))) missingH1.push(rel);
    for (const l of links) {
      const exists = allFiles.has(l.target) || fs.existsSync(path.join(root, l.target));
      if (!exists && !isHistorical(rel)) broken.push(`${rel} → ${l.raw}`);
      if (l.target.toLowerCase().endsWith(".md") && l.target !== rel) {
        linkedPages.add(l.target);
        if (isHub(rel)) hubLinked.add(l.target);
      }
    }
    if (isHub(rel)) {
      for (const line of withoutCode(text).split("\n")) {
        if (/^\s*[-*]\s+\[[^\]]+\]\([^)]+\.md(#[^)]*)?\)\s*$/.test(line)) hubLinesWithoutDesc.push(`${rel}: ${line.trim()}`);
      }
    }
  }

  // Layout expected by the skill and the hook: a root README hub, every current page inside a
  // top-level domain folder, each domain with a README hub linked from the root, and every
  // page listed in some hub.
  const current = pages.map(pageRel).filter((r) => !isHistorical(r) && !isPromptFile(r));
  const rootEntries = fs.readdirSync(docRoot, { withFileTypes: true });
  const rootHubName = rootEntries.find((e) => e.isFile() && /^readme\.md$/i.test(e.name))?.name;
  const rootHub = rootHubName ? `${docRel}/${rootHubName}` : null;
  const domains = rootEntries
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !isHistorical(`${docRel}/${e.name}`))
    .map((e) => e.name)
    .filter((d) => current.some((r) => r.startsWith(`${docRel}/${d}/`)));
  const domainHub = (d) => current.find((r) => r.toLowerCase() === `${docRel}/${d}/readme.md`.toLowerCase());
  const rootLinks = rootHub ? referencesOf(path.join(root, rootHub), allFiles).links.map((l) => l.target) : [];
  const layout = {
    missingRootHub: !rootHub,
    pagesOutsideDomains: current.filter((r) => r !== rootHub && r.split("/").length === docRel.split("/").length + 1),
    domainsWithoutHub: domains.filter((d) => !domainHub(d)),
    domainsNotInRootHub: domains.filter((d) => domainHub(d) && !rootLinks.includes(domainHub(d))),
    pagesNotInAnyHub: current.filter((r) => !isHub(r) && !hubLinked.has(r)),
  };
  layout.conforms =
    !layout.missingRootHub &&
    domains.length > 0 &&
    !layout.pagesOutsideDomains.length &&
    !layout.domainsWithoutHub.length &&
    !layout.domainsNotInRootHub.length &&
    !layout.pagesNotInAnyHub.length &&
    !hubLinesWithoutDesc.length;
  layout.domains = domains;
  const rootReadme = `${docRel}/README.md`;
  const orphans = pages.map(pageRel).filter((r) => r !== rootReadme && !isHistorical(r) && !linkedPages.has(r));
  const foldersWithoutReadme = [];
  const rec = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const rel = toPosix(path.relative(root, dir));
    const hasPages = entries.some((e) => e.isFile() && e.name.endsWith(".md") && !isPromptFile(e.name));
    if (!isHistorical(rel) && hasPages && !entries.some((e) => /^readme\.md$/i.test(e.name))) foldersWithoutReadme.push(rel);
    for (const e of entries) if (e.isDirectory() && !e.name.startsWith(".")) rec(path.join(dir, e.name));
  };
  rec(docRoot);
  const obj = { pages: pages.length, layout, broken, orphans, foldersWithoutReadme, hubLinesWithoutDesc, missingH1 };
  const layoutLines = layout.conforms
    ? [`layout: follows the create-jev-doc format (${domains.length} domains)`]
    : [
        "layout: does NOT follow the create-jev-doc format",
        ...(layout.missingRootHub ? [`  - no ${docRel}/README.md root hub`] : []),
        ...(!domains.length ? ["  - no domain folders: all pages sit at the root of the docs folder"] : []),
        ...(layout.pagesOutsideDomains.length ? [`  - ${layout.pagesOutsideDomains.length} pages outside a domain folder: ${layout.pagesOutsideDomains.slice(0, 8).join(", ")}${layout.pagesOutsideDomains.length > 8 ? ", …" : ""}`] : []),
        ...(layout.domainsWithoutHub.length ? [`  - domains without a README hub: ${layout.domainsWithoutHub.join(", ")}`] : []),
        ...(layout.domainsNotInRootHub.length ? [`  - domains the root hub doesn't link: ${layout.domainsNotInRootHub.join(", ")}`] : []),
        ...(layout.pagesNotInAnyHub.length ? [`  - ${layout.pagesNotInAnyHub.length} pages not listed in any README hub`] : []),
        ...(hubLinesWithoutDesc.length ? [`  - ${hubLinesWithoutDesc.length} hub lines without a description`] : []),
      ];
  print(
    obj,
    [
      `${pages.length} pages checked in ${docRel}/`,
      "",
      ...layoutLines,
      "",
      "broken links:",
      list(broken),
      "",
      "pages no other page links to (add them to a hub):",
      list(orphans),
      "",
      "folders with pages but no README.md hub:",
      list(foldersWithoutReadme),
      "",
      "hub entries without a description (write `- [Title](page.md): what it covers`):",
      list(hubLinesWithoutDesc),
      "",
      "pages without a # title:",
      list(missingH1),
    ].join("\n"),
  );
}

function cmdStamp() {
  if (!docRoot) return print({ error: "no docs folder" }, "No docs folder to stamp.");
  const head = isGit ? git(["rev-parse", "HEAD"], root)?.trim() : null;
  const next = { ...state, commit: head, updatedAt: new Date().toISOString(), tool: "create-jev-doc" };
  fs.writeFileSync(path.join(docRoot, STATE_FILE), `${JSON.stringify(next, null, 2)}\n`);
  const dirty = isGit && (git(["status", "--porcelain", "-uno"], root) || "").trim();
  print(next, `Recorded ${head ? head.slice(0, 12) : "(no git)"} in ${docRel}/${STATE_FILE}.${dirty ? " Note: the working tree has uncommitted changes; they count as documented only once committed." : ""}`);
}

const commands = { inventory: cmdInventory, map: cmdMap, changed: cmdChanged, check: cmdCheck, stamp: cmdStamp };
if (!commands[cmd]) {
  console.error(`unknown command: ${cmd}. Use one of: ${Object.keys(commands).join(", ")}`);
  process.exit(2);
}
commands[cmd]();
