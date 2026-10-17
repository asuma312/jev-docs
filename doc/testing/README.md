# Testing

The repository's tests use Node's built-in `node:test` runner with no extra dependencies, and run without network access or a TypeSafe key.

## Pages

- [Test suites](test-suites.md): how to run the tests, the four suites and each test's subject, temporary-folder isolation, and the behaviors no automated test covers.

## Ownership

The suites live in [`test/`](../../test/docs-index.test.mjs): [`docs-index.test.mjs`](../../test/docs-index.test.mjs), [`select.test.mjs`](../../test/select.test.mjs), [`session.test.mjs`](../../test/session.test.mjs) and [`doc-coverage.test.mjs`](../../test/doc-coverage.test.mjs). The `test` script in [`package.json`](../../package.json) runs them.
