// Two-stage selection with Jev:
//   1. a gate question plus one yes/no question per top-level docs area;
//   2. one yes/no question per page inside the best areas.
// Each stage is split across parallel requests when its questions would not fit in one.

import path from "node:path";
import { clip, toPosix } from "./docs-index.mjs";

const num = (name, fallback) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export const CONFIG = {
  maxDocs: num("JEV_DOCS_MAX", 5),
  docThreshold: num("JEV_DOCS_THRESHOLD", 0.5),
  // Pages at or above this go in the "read before you start" list (at most maxPrimary of them).
  primaryThreshold: num("JEV_DOCS_PRIMARY_THRESHOLD", 0.75),
  maxPrimary: num("JEV_DOCS_MAX_PRIMARY", 3),
  groupThreshold: num("JEV_DOCS_GROUP_THRESHOLD", 0.35),
  maxGroups: num("JEV_DOCS_MAX_GROUPS", 4),
  gateThreshold: num("JEV_DOCS_GATE_THRESHOLD", 0.5),
  timeoutMs: num("JEV_DOCS_TIMEOUT_MS", 6000),
  // Whole-run budget, counted from process start: past it, pending requests are aborted.
  deadlineMs: num("JEV_DOCS_DEADLINE_MS", 5000),
  // Rough per-request budget in characters (~4 chars per token, well under Jev's 64K tokens).
  requestChars: num("JEV_DOCS_REQUEST_CHARS", 120000),
  model: process.env.JEV_DOCS_MODEL || undefined,
};

// Asks whether the task needs understanding, not just project context: routine operations
// (commit, push, deploy, status, "continue") are project-specific but gain nothing from docs.
// On real prompts it scored 0.07–0.37 for routine operations and 0.79–0.93 for real work.
export const GATE_QUESTION =
  "Does carrying out `request` require understanding how some part of this project works — its behavior, rules, " +
  "data, architecture or design — rather than being a routine operation such as committing, pushing, merging, " +
  "deploying, running or stopping something, checking status, or continuing previous work?";

export const groupQuestion = (g) =>
  `Would someone handling \`request\` need to read project documentation from this area? Area: ${g.summary}`;

export const docQuestion = (d) =>
  `Should the assistant read the documentation page \`${d.rel}\` before handling \`request\`? The page covers: ${d.summary}`;

export function chunkQuestions(entries, budget) {
  const chunks = [];
  let cur = {};
  let size = 0;
  for (const [key, q] of entries) {
    const len = JSON.stringify(q).length;
    if (size + len > budget && Object.keys(cur).length) {
      chunks.push(cur);
      cur = {};
      size = 0;
    }
    cur[key] = q;
    size += len;
  }
  if (Object.keys(cur).length) chunks.push(cur);
  return chunks;
}

// `deps` replaces the TypeSafe client and `noul` helper; tests pass fakes, the hook passes nothing.
async function defaultDeps() {
  const { TypeSafeClient, noul } = await import("@typesafe-ai/sdk");
  return { client: new TypeSafeClient({ timeout: CONFIG.timeoutMs, retry: { maxRetries: 1 }, logLevel: "off" }), noul };
}

// `signal` aborts every pending request; the hook ties it to CONFIG.deadlineMs.
export async function select(index, state, log = { requests: [] }, deps, signal) {
  const { client, noul } = deps || (await defaultDeps());
  const ask = async (questions) => {
    signal?.throwIfAborted();
    const t = Date.now();
    const res = await client.systemOne({ state, questions, model: CONFIG.model }, signal ? { signal } : undefined);
    log.requests.push({ questions: Object.keys(questions).length, ms: Date.now() - t, usage: res.usage, model: res.model });
    return res.answers;
  };
  const budget = Math.max(20000, CONFIG.requestChars - JSON.stringify(state).length);
  const askAll = async (entries) => Object.assign({}, ...(await Promise.all(chunkQuestions(entries, budget).map(ask))));

  // Stage 1 is chunked like stage 2, so many areas can't exceed the request limit; the gate goes first.
  const stage1 = [["gate", noul(GATE_QUESTION)], ...index.groups.map((g, i) => [`g${i}`, noul(groupQuestion(g))])];
  const a1 = await askAll(stage1);
  log.gate = a1.gate.noul;
  const groupScores = index.groups.map((g, i) => ({ name: g.name, p: a1[`g${i}`].noul })).sort((x, y) => y.p - x.p);
  log.groups = groupScores.map((g) => `${g.name}=${g.p.toFixed(2)}`);
  if (a1.gate.noul < CONFIG.gateThreshold) return [];

  let picked = groupScores.filter((g) => g.p >= CONFIG.groupThreshold).slice(0, CONFIG.maxGroups);
  if (!picked.length) picked = groupScores.slice(0, 1);
  const pickedNames = new Set(picked.map((g) => g.name));

  const candidates = index.docs.filter((d) => pickedNames.has(d.group));
  const answers = await askAll(candidates.map((d, i) => [`d${i}`, noul(docQuestion(d))]));
  return candidates
    .map((d, i) => ({ ...d, p: answers[`d${i}`]?.noul ?? 0 }))
    .filter((d) => d.p >= CONFIG.docThreshold)
    .sort((x, y) => y.p - x.p)
    .slice(0, CONFIG.maxDocs);
}

// Splits pages (sorted by p, highest first) into a short must-read list and an optional rest.
// The top page is always must-read: the gate already established that the task needs the docs.
export function tiers(selected) {
  const primary = selected.filter((d, i) => i === 0 || d.p >= CONFIG.primaryThreshold).slice(0, CONFIG.maxPrimary);
  return { primary, secondary: selected.filter((d) => !primary.includes(d)) };
}

// A firm instruction for the top pages: in real sessions, an "ignore any that don't fit" list
// was opened in 2 of 23 turns.
export function renderContext(selected, docsRoot, projectDir) {
  const base = toPosix(path.relative(projectDir, docsRoot)) || ".";
  const line = (d) => `- ${base}/${d.rel} — ${clip(d.summary, 200)}`;
  const { primary, secondary } = tiers(selected);
  const out = [
    `Project documentation for this request, picked from ${base}/ by jev-docs. These pages describe how the parts of the project involved here work; rely on them instead of inferring behavior from the code alone.`,
    "",
    "Read these before you start:",
    ...primary.map(line),
  ];
  if (secondary.length) out.push("", "Also relevant — open them if the task touches what they cover:", ...secondary.map(line));
  return out.join("\n");
}
