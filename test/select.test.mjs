import assert from "node:assert/strict";
import { test } from "node:test";

const { select, tiers, renderContext, GATE_QUESTION } = await import("../src/select.mjs");

// Stand-ins for the SDK: `noul` builds the same shape, the client answers from a table.
const noul = (instructions) => ({ type: "noul", instructions });
function fakeClient(score) {
  const calls = [];
  return {
    calls,
    async systemOne({ questions }) {
      calls.push(Object.keys(questions));
      const answers = Object.fromEntries(Object.entries(questions).map(([k, q]) => [k, { type: "noul", noul: score(k, q.instructions) }]));
      return { answers, usage: { input_tokens: 1, output_tokens: 1 }, model: "fake" };
    },
  };
}

function index(groupCount, summaryChars = 50) {
  const groups = Array.from({ length: groupCount }, (_, i) => ({ name: `area${i}`, count: 2, summary: `area${i}/ ${"x".repeat(summaryChars)}` }));
  const docs = groups.flatMap((g) => [
    { rel: `${g.name}/README.md`, group: g.name, summary: `${g.name} hub` },
    { rel: `${g.name}/page.md`, group: g.name, summary: `${g.name} page` },
  ]);
  return { groups, docs };
}

test("stage 1 is split into several requests when areas exceed the budget, gate first", async () => {
  // 40 areas × ~4,000 characters each exceed the default 120,000-character request budget.
  const client = fakeClient((k) => (k === "gate" ? 0.9 : 0.1));
  await select(index(40, 4000), { request: "anything" }, { requests: [] }, { client, noul });
  const stage1 = client.calls.filter((keys) => keys.some((k) => k === "gate" || k.startsWith("g")));
  assert.ok(stage1.length > 1);
  assert.equal(stage1[0][0], "gate");
  assert.equal(stage1.flat().filter((k) => k.startsWith("g") && k !== "gate").length, 40);
});

test("gate below the threshold stops after stage 1", async () => {
  const client = fakeClient(() => 0.1);
  const log = { requests: [] };
  const out = await select(index(3), { request: "hi" }, log, { client, noul });
  assert.deepEqual(out, []);
  assert.equal(client.calls.length, 1);
  assert.equal(log.gate, 0.1);
});

test("stage 2 asks only about pages in picked areas and applies the page threshold", async () => {
  const client = fakeClient((k, text) => {
    if (k === "gate") return 0.9;
    if (k.startsWith("g")) return text.includes("area1/") ? 0.8 : 0.1;
    return text.includes("area1/page.md") ? 0.7 : 0.2;
  });
  const out = await select(index(3), { request: "work on area1" }, { requests: [] }, { client, noul });
  assert.deepEqual(out.map((d) => d.rel), ["area1/page.md"]);
  assert.equal(client.calls.at(-1).length, 2);
});

test("an aborted signal stops pending requests", async () => {
  const client = {
    systemOne: (_req, opts) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve({ answers: {}, usage: {}, model: "fake" }), 2000);
        opts?.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(opts.signal.reason);
        });
      }),
  };
  const ac = new AbortController();
  setTimeout(() => ac.abort(new Error("deadline")), 50);
  const t0 = Date.now();
  await assert.rejects(select(index(3), { request: "x" }, { requests: [] }, { client, noul }, ac.signal), /deadline/);
  assert.ok(Date.now() - t0 < 1000);
});

test("tiers put high-probability pages first, at most three, and always the top page", () => {
  const page = (rel, p) => ({ rel, p, summary: rel });
  const t = tiers([page("a", 0.95), page("b", 0.9), page("c", 0.8), page("d", 0.78), page("e", 0.6)]);
  assert.deepEqual(t.primary.map((d) => d.rel), ["a", "b", "c"]);
  assert.deepEqual(t.secondary.map((d) => d.rel), ["d", "e"]);
  const low = tiers([page("x", 0.6), page("y", 0.55)]);
  assert.deepEqual(low.primary.map((d) => d.rel), ["x"]);
  assert.deepEqual(low.secondary.map((d) => d.rel), ["y"]);
});

test("rendered context separates must-read pages from optional ones", () => {
  const out = renderContext([{ rel: "a.md", p: 0.9, summary: "A" }, { rel: "b.md", p: 0.6, summary: "B" }], "/p/doc", "/p");
  const lines = out.split("\n");
  const must = lines.indexOf("Read these before you start:");
  const also = lines.findIndex((l) => l.startsWith("Also relevant"));
  assert.ok(must > 0 && also > must);
  assert.equal(lines[must + 1], "- doc/a.md — A");
  assert.equal(lines[also + 1], "- doc/b.md — B");
  assert.ok(!/ignore any/i.test(out));
});

test("the gate asks about understanding, not routine operations", () => {
  assert.match(GATE_QUESTION, /require understanding how some part of this project works/);
  assert.match(GATE_QUESTION, /committing, pushing, merging/);
});

test("when no area passes, the single best area is still explored", async () => {
  const client = fakeClient((k, text) => (k === "gate" ? 0.9 : k.startsWith("g") ? (text.includes("area2/") ? 0.2 : 0.1) : 0.9));
  const out = await select(index(3), { request: "x" }, { requests: [] }, { client, noul });
  assert.deepEqual(out.map((d) => d.group), ["area2", "area2"]);
});
