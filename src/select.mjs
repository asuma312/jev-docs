// Two-stage selection with Jev:
//   1. a gate question plus one yes/no question per top-level docs area;
//   2. one yes/no question per page inside the best areas, split across
//      parallel requests when they would not fit in one.

import path from "node:path";
import { clip, toPosix } from "./docs-index.mjs";

const num = (name, fallback) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export const CONFIG = {
  maxDocs: num("JEV_DOCS_MAX", 8),
  docThreshold: num("JEV_DOCS_THRESHOLD", 0.5),
  groupThreshold: num("JEV_DOCS_GROUP_THRESHOLD", 0.35),
  maxGroups: num("JEV_DOCS_MAX_GROUPS", 4),
  gateThreshold: num("JEV_DOCS_GATE_THRESHOLD", 0.3),
  timeoutMs: num("JEV_DOCS_TIMEOUT_MS", 6000),
  // Rough per-request budget in characters (~4 chars per token, well under Jev's 64K tokens).
  requestChars: num("JEV_DOCS_REQUEST_CHARS", 120000),
  model: process.env.JEV_DOCS_MODEL || undefined,
};

export const GATE_QUESTION =
  "Does answering or carrying out `request` depend on knowledge specific to this software project " +
  "(its code, systems, data, design or processes), rather than being small talk or a general question?";

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

export async function select(index, state, log = { requests: [] }) {
  const { TypeSafeClient, noul } = await import("@typesafe-ai/sdk");
  const client = new TypeSafeClient({ timeout: CONFIG.timeoutMs, retry: { maxRetries: 1 }, logLevel: "off" });
  const ask = async (questions) => {
    const t = Date.now();
    const res = await client.systemOne({ state, questions, model: CONFIG.model });
    log.requests.push({ questions: Object.keys(questions).length, ms: Date.now() - t, usage: res.usage, model: res.model });
    return res.answers;
  };
  const budget = Math.max(20000, CONFIG.requestChars - JSON.stringify(state).length);

  const stage1 = { gate: noul(GATE_QUESTION) };
  index.groups.forEach((g, i) => (stage1[`g${i}`] = noul(groupQuestion(g))));
  const a1 = await ask(stage1);
  log.gate = a1.gate.noul;
  const groupScores = index.groups.map((g, i) => ({ name: g.name, p: a1[`g${i}`].noul })).sort((x, y) => y.p - x.p);
  log.groups = groupScores.map((g) => `${g.name}=${g.p.toFixed(2)}`);
  if (a1.gate.noul < CONFIG.gateThreshold) return [];

  let picked = groupScores.filter((g) => g.p >= CONFIG.groupThreshold).slice(0, CONFIG.maxGroups);
  if (!picked.length) picked = groupScores.slice(0, 1);
  const pickedNames = new Set(picked.map((g) => g.name));

  const candidates = index.docs.filter((d) => pickedNames.has(d.group));
  const entries = candidates.map((d, i) => [`d${i}`, noul(docQuestion(d))]);
  const answers = Object.assign({}, ...(await Promise.all(chunkQuestions(entries, budget).map(ask))));
  return candidates
    .map((d, i) => ({ ...d, p: answers[`d${i}`]?.noul ?? 0 }))
    .filter((d) => d.p >= CONFIG.docThreshold)
    .sort((x, y) => y.p - x.p)
    .slice(0, CONFIG.maxDocs);
}

export function renderContext(selected, docsRoot, projectDir) {
  const base = toPosix(path.relative(projectDir, docsRoot)) || ".";
  return [
    `Here are the important documentation files for this request (selected automatically from ${base}/ by Jev; read the ones that apply before starting, and ignore any that don't fit):`,
    ...selected.map((d) => `- ${base}/${d.rel} — ${clip(d.summary, 200)}`),
  ].join("\n");
}
