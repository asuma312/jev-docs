# Two-stage selection

[`src/select.mjs`](../../src/select.mjs) turns the docs index and the prompt state into a short list of pages. It asks Jev yes/no questions in two stages: first one question per top-level docs area, then one question per page inside the best areas. Everything except the answers is deterministic code. The index it reads is described on the [docs index page](../index/docs-index.md), and the caller is the [hook runtime](runtime.md).

## Configuration

`CONFIG` is computed once, when the module loads, from environment variables. `num(name, fallback)` accepts a value only if it parses to a finite number greater than zero. Otherwise it uses the default, so a threshold can't be set to `0`.

| Field | Variable | Default | Use |
|---|---|---|---|
| `maxDocs` | `JEV_DOCS_MAX` | 5 | Cap on returned pages |
| `docThreshold` | `JEV_DOCS_THRESHOLD` | 0.5 | Minimum page probability |
| `primaryThreshold` | `JEV_DOCS_PRIMARY_THRESHOLD` | 0.75 | Pages at or above this are listed as must-read |
| `maxPrimary` | `JEV_DOCS_MAX_PRIMARY` | 3 | Cap on must-read pages |
| `groupThreshold` | `JEV_DOCS_GROUP_THRESHOLD` | 0.35 | Minimum area probability for stage 2 |
| `maxGroups` | `JEV_DOCS_MAX_GROUPS` | 4 | Cap on areas explored in stage 2 |
| `gateThreshold` | `JEV_DOCS_GATE_THRESHOLD` | 0.5 | Below this, stage 2 is skipped |
| `timeoutMs` | `JEV_DOCS_TIMEOUT_MS` | 6000 | Per-attempt SDK timeout, in milliseconds |
| `deadlineMs` | `JEV_DOCS_DEADLINE_MS` | 5000 | Whole-run budget from process start; the hook aborts pending requests past it (see [hook runtime](runtime.md#deadline)) |
| `requestChars` | `JEV_DOCS_REQUEST_CHARS` | 120000 | Character budget per request, state included |
| `model` | `JEV_DOCS_MODEL` | unset | Passed as `model`; unset lets the SDK use its default |

## Jev client and requests

`select(index, state, log, deps, signal)` takes an optional `deps` object `{ client, noul }` and an optional `AbortSignal`. The hook passes nothing. In that case, `defaultDeps` imports `TypeSafeClient` and `noul` from `@typesafe-ai/sdk` dynamically, so the SDK loads only when a selection actually runs. Tests pass a fake client with a `systemOne` method. The client is created with `timeout: CONFIG.timeoutMs`, `retry: { maxRetries: 1 }` and `logLevel: "off"`. It takes its key and base URL from the SDK's own environment variables (`TYPESAFE_API_KEY`, `TYPESAFE_BASE_URL`).

Every request goes through the inner `ask(questions)`. It first calls `signal.throwIfAborted()`, so no new request starts after an abort. Then it calls `client.systemOne({ state, questions, model }, { signal })`, so the SDK cancels the request in flight when the signal fires. It appends `{ questions, ms, usage, model }` to `log.requests` and returns the answers. All questions are `noul` (yes/no) questions. Each answer's `noul` field is the probability of yes, from 0 to 1. The same `state` object is sent with every request: `{ request, recent_requests? }`, built by the hook runtime.

## Stage 1: gate and areas

Stage 1 asks these questions, in this order:

- `gate`: `GATE_QUESTION` asks whether carrying out `request` requires understanding how some part of the project works (behavior, rules, data, architecture or design), rather than a routine operation: committing, pushing, merging, deploying, running or stopping something, checking status, or continuing previous work. Routine operations are project-specific but gain nothing from documentation. On real prompts during development, this question scored 0.07–0.37 for routine operations and 0.79–0.93 for real work. The earlier question ("depends on project-specific knowledge?") scored 0.60–0.96 for both, so it let routine prompts through.
- `g0`…`gN`: one `groupQuestion(g)` per entry in `index.groups`. Each asks whether someone handling `request` would need documentation from that area, and includes the area's summary.

The questions go through the same chunking as stage 2 (see below), so many areas or long area summaries are split across parallel requests instead of exceeding Jev's request limit. The gate is the first entry, so it always travels in the first chunk. With the default budget and typical summaries, this is one request.

`log.gate` gets the gate probability, and `log.groups` lists every area as `name=probability`, highest first. If the gate is below `gateThreshold`, `select` returns an empty list. The stage-1 requests have already been made and billed by then.

Otherwise, the areas at or above `groupThreshold` are picked, highest first, up to `maxGroups`. If none qualifies, the single highest-scoring area is picked anyway. So once the gate passes, stage 2 always runs on at least one area.

## Stage 2: pages

The candidates are every page in `index.docs` whose `group` is one of the picked areas. Each gets the key `d<i>` and a `docQuestion(d)`, which asks whether the assistant should read the page at path `d.rel` before handling `request`, and includes the page summary.

Both stages send their questions through the inner `askAll(entries)`, which calls `chunkQuestions(entries, budget)`. That function splits the questions into consecutive chunks. It measures each question as the length of its JSON serialization and starts a new chunk when adding a question would exceed the budget. A single question larger than the budget still gets a chunk of its own. The budget is `requestChars` minus the length of the serialized state, with a floor of 20,000 characters. All chunks are sent at once with `Promise.all`, and their answers are merged. If any chunk fails, the whole selection fails, and the hook records the error.

A page's probability is its answer's `noul`, or 0 if the answer is missing. Pages at or above `docThreshold` are kept, sorted by probability from highest to lowest, and cut to `maxDocs`. Each returned page is the index entry plus `p`.

## Rendered context

`tiers(selected)` splits the pages, sorted by probability, into two lists:

- `primary`: the top page, plus any page at or above `primaryThreshold`, up to `maxPrimary`. The top page is always must-read, because the gate already established that the task needs documentation.
- `secondary`: the rest.

`renderContext(selected, docsRoot, projectDir)` builds the text the hook injects. An opening sentence names the docs folder relative to the project (`.` when they are the same folder). It says the pages describe how the involved parts work, and that the agent should rely on them instead of inferring behavior from code alone. Then come two lists:

- **Read these before you start:** the primary pages
- **Also relevant — open them if the task touches what they cover:** the secondary pages, shown only when there are any

Each page is a line `- <base>/<rel> — <summary>`, with the summary clipped to 200 characters by `clip`.

The wording is deliberately firm for the top pages. In real sessions before this change, the old text ("read the ones that apply… ignore any that don't fit", with up to 8 pages) led the agent to open at least one suggested page in only 2 of 23 turns, and 5 of 71 suggested pages in total.

## Limits

- Probabilities from different requests aren't calibrated against each other, but pages from different chunks are compared as if they were.
- The gate and area thresholds are absolute. Areas with uniformly low scores fall back to the single best area instead of an empty result.
- There is no retry budget across chunks: a timeout in one chunk drops every page from that prompt.
- With the client's `maxRetries: 1`, a single request could take about twice `timeoutMs`, plus backoff, but the hook's deadline (5 s by default) cuts it off first.
- Firmer wording raises the chance that the agent reads a wrongly picked page too. Reading a page costs little compared with ignoring a right one, but page quality still matters. Folders that aren't contracts (lore, narrative, raw notes) can outrank technical pages for broad prompts, and can be excluded with `.jevdocsignore`.
- Whether the new gate and wording actually raise the share of suggested pages that agents open has not yet been measured in real sessions.

## Verification

[`test/docs-index.test.mjs`](../../test/docs-index.test.mjs) covers `chunkQuestions` (it respects the budget and keeps every question) and `renderContext` (paths are relative to the project).

[`test/select.test.mjs`](../../test/select.test.mjs) calls `select` with a fake client and `noul` through the `deps` argument, and checks four things:

- stage 1 is split across several requests when 40 large areas exceed the budget, with the gate first
- a gate below the threshold stops after one request
- stage 2 asks only about pages in the picked areas and applies the page threshold
- the single best area is explored when no area passes
- an aborted signal rejects `select` while a fake request is still pending, in well under a second

It also checks that `tiers` caps must-read pages at three and always promotes the top page, that `renderContext` puts must-read and optional pages under their own headings without the old "ignore any" wording, and that the gate question asks about understanding rather than routine operations.

These tests don't reach the TypeSafe API. Two live runs with the installed key, against a project with about 950 pages, behaved as intended. "commit, push and deploy" scored 0.22 at the gate and injected nothing. "explain how the sect works" scored 0.92 and injected three must-read and two optional pages, in under a second. These live runs are not repeatable from this repository. The suite was run while writing this page: 27 tests, all passing.
