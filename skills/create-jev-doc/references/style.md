# Documentation style

These rules produce documentation that is precise enough to change code from, and structured so a reader (or Jev) can find the right page from a one-line description.

## Layout

```
doc/
  README.md               root hub: what the docs cover, every domain with a one-line description
  .jev-doc.json           helper state: documented commit, excludes, domain plan
  .jevdocsignore          optional: paths the jev-docs hook should not offer
  <domain>/
    README.md             domain hub: scope, ## Pages, ## Ownership
    <topic>.md            one topic per page
    <topic>-catalogue-1.md, -2.md …   long registries split in parts
  _archive/               superseded material, kept for provenance, never current instructions
  _generated/             tool output that lives in the docs tree
```

- Name folders and files in lowercase kebab-case after the responsibility (`payment-retries.md`), not after a source file (`retryWorker.md`).
- One domain per responsibility a person would ask about. A domain with one page can still have a folder; that keeps room to grow.
- Folders starting with `_`, and folders named `archive` or `history`, are treated as non-current by the helper and the hook.

## Root hub (`doc/README.md`)

```markdown
# <Project> documentation

One paragraph: what the documentation covers, how it is organized, and which
material is current versus historical.

## Domains

- [Authentication](auth/README.md): sign-up, sign-in, session tokens, password reset and account recovery.
- [Billing](billing/README.md): plans, invoices, payment retries, refunds and the provider webhook.
- [Build and release](build/README.md): build pipeline, environment configuration, packaging and deployment.

## Documentation status

What is known to be incomplete, superseded or pending review.
```

## Domain hub (`doc/<domain>/README.md`)

```markdown
# Billing

One or two sentences on the domain's scope and what it deliberately leaves to other domains.

## Pages

- [Plans and pricing](plans.md): plan catalogue, price resolution, currency rounding and trial rules.
- [Invoices](invoices.md): invoice lifecycle, numbering, tax lines, PDF rendering and storage.
- [Payment retries](payment-retries.md): retry schedule, idempotency keys, dunning emails and final failure.

## Ownership

[`src/billing/index.ts`](../../src/billing/index.ts) is the public facade. [`src/billing/invoices.ts`](../../src/billing/invoices.ts)
owns invoice state; [`src/billing/provider.ts`](../../src/billing/provider.ts) is the only module that calls the payment
provider. Name each owning file and what it owns.
```

**The hub line is the most important sentence on the page.** Format: `- [Title](page.md): comma-separated list of what the page covers.` Use the concrete nouns a person would type when they need the page: feature names, entities, operations, failure cases. Avoid vague words like "overview", "details" or "misc". Every page must appear in exactly one hub. A page can be mentioned from others too.

## Page template

```markdown
# Payment retries

Opening paragraph: the owner files (linked), what they do, what they delegate to whom,
and what this page does not cover (with links to those pages).

## <Behavior topic>
## <Behavior topic>
## State and persistence
## Consumers and integration
## Limits
## Verification
```

Choose section names for the behaviors the code actually has. The last four are common, so keep them when they apply:

- **State and persistence**: where data lives (tables, files, keys, in-memory structures), its shape, defaults, migrations, what survives a restart, and what doesn't.
- **Consumers and integration**: who calls this code and what they rely on. Events, hooks, routes and jobs that reach it.
- **Limits**: what the code doesn't do, known edge cases, unsupported inputs, missing guarantees (no transaction, no retry, not idempotent).
- **Verification**: the tests that cover the page's behaviors, linked, with what each one checks. Say whether you ran them. Name behaviors no test covers.

A long registry or catalogue (every route, every command, every config key) gets a table, split across `-catalogue-1.md`, `-2.md`… pages when it grows past about 2,500 words.

## Writing rules

**Write contracts, not tours.** Each sentence should state a fact someone could check against the code and rely on when changing it.

| Vague (avoid) | Contract-level (write this) |
|---|---|
| The retry module handles failed payments. | `scheduleRetry(invoiceId)` enqueues at most four attempts at 1, 3, 7 and 14 days after the first failure; a fifth failure marks the invoice `uncollectible` and emits `invoice.failed`. |
| Sessions are stored securely. | Session rows live in `sessions(id, user_id, expires_at, revoked_at)`; the token carries only the session ID, and every request rechecks `revoked_at`, so revocation takes effect on the next request. |
| Errors are handled. | A provider timeout leaves the attempt `pending`; the next scheduler tick retries it with the same idempotency key, so the provider sees one charge. |

- **Name things exactly.** Functions, classes, routes, commands, config keys, table and column names, event names and file paths go in backticks, spelled as in the code.
- **Link owners.** Link a source file the first time a page names it, with a path relative to the page (`../../src/billing/retry.ts`). Prefer linking the owning file over listing every file.
- **Cover the unhappy paths.** Validation, ordering, concurrency, partial failure, rollback or compensation, idempotency, limits, timeouts. Say what happens, not just that it is handled.
- **Units and types.** Say whether a number is seconds or milliseconds, cents or currency units, inclusive or exclusive, an integer or a float, and how it is rounded.
- **State boundaries.** Distinguish in-memory from persisted, per-request from global, and client from server.
- **Negative statements are useful.** "Does not retry", "is not transactional" and "is not exposed over HTTP" stop readers from assuming.
- **Prose for behavior, tables for catalogues.** Use paragraphs for how things work and tables for enumerations (routes, flags, error codes). Avoid long bullet lists of fragments.
- **One idea per paragraph**, 2 to 6 sentences. Lead with the fact, then the condition or exception.
- **No speculation, no marketing, no history.** Describe what the code does now. History belongs in `_archive/` or the version control log.

## Status and evidence vocabulary

Use these words consistently, so readers can tell current contracts from everything else:

- **current**: implemented and reachable in the code you read.
- **proposal** / **plan**: agreed or suggested, but not implemented. Keep these on their own pages and title them so ("… design", "… plan").
- **historical**: superseded. It lives in `_archive/` and is not current guidance.
- **not determined from source**: you couldn't establish it by reading the code. Say what would settle it.
- **covered by `<test>`**: a test exists that exercises the behavior. Add "(ran, passing)" only if you ran it in this session.
- **not exercised**: nobody ran it here (for example a live deployment, a real browser or external services).

## Size and splitting

- Target 500 to 2,500 words per page. Split a page when a reader looking for one topic would have to skim through another.
- Split by responsibility (contracts, persistence, UI, operations), not by arbitrary length.
- When you split, update the hub so each part has its own description.
