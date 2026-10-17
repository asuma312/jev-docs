# Coverage helper

[`doc-coverage.mjs`](../../skills/create-jev-doc/scripts/doc-coverage.mjs) is the executable part of the [create-jev-doc skill](skill.md). It is a single Node script with no dependencies beyond Node built-ins and a `git` binary on the `PATH`. It reads the repository and its git history, and the only file it ever writes is `<docs>/.jev-doc.json`, in `stamp`.

## Invocation and options

```bash
node doc-coverage.mjs <command> [--root <repo>] [--doc <dir>] [--since <commit>] [--limit <n>] [--json]
```

The command is the first argument when it doesn't start with `--`. Otherwise it defaults to `inventory`. An unknown command prints the valid ones to stderr and exits with code 2.

| Option | Default | Effect |
|---|---|---|
| `--root` | `git rev-parse --show-toplevel` from the current directory, else the current directory | Repository root |
| `--doc` | first existing `doc`, `docs`, `documentation` under the root | Docs folder, relative to the root |
| `--since` | the `commit` in `.jev-doc.json` | Baseline for `changed` |
| `--limit` | 60 | Items shown per list in text output (`… N more` after that) |
| `--json` | off | Print one JSON object instead of text |

An option value that starts with `--` is ignored, and the default is used instead. Git is called through `execFileSync`, with stderr discarded and a 256 MB output buffer. A failed git call returns `null`, and the script falls back to the default for that call. The root counts as a repository when `git rev-parse --is-inside-work-tree` prints `true`.

## Which files count as source

The file list comes from `git ls-files --cached --others --exclude-standard`, which means tracked files plus untracked files that aren't ignored. Outside a repository, the script walks the file system instead, skipping dot entries except `.github`. `isSource(rel)` then keeps a file only if all of these hold:

- no parent folder is in the skip list (`node_modules`, `vendor`, `dist`, `build`, `out`, `target`, `coverage`, `bin`, `obj`, virtual environments, IDE folders and similar), and no parent folder starts with `.`, except `.github`
- it is not inside the docs folder, and not under any prefix in `.jev-doc.json`'s `exclude`
- it is not a lock file (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `Cargo.lock`, `poetry.lock`, `composer.lock`, `Gemfile.lock`), a minified `.min.js` or `.min.css` file, or a `.map` file
- its extension is in the code list (JavaScript and TypeScript variants, Python, Go, Rust, JVM languages, Ruby, PHP, C#, C and C++, Swift, shell, HTML and CSS variants, SQL, YAML, TOML, Terraform and others), or its name is `Dockerfile`
- it is a regular file of at most 1,000,000 bytes

Markdown is not source, so prompt files, skill text and READMEs outside the docs folder never count toward coverage.

## Reference detection

`referencesOf(page, fileSet)` collects the repository files a page points to, in two ways:

- **Links**: every Markdown link target in the page *outside code*, with any link title removed. Before scanning, `withoutCode` empties fenced code blocks (```` ``` ```` or `~~~`, closed by a fence of the same character and at least the same length) and replaces each inline code span with a placeholder word. So an example link shown as code isn't read, but a link whose text is code, such as a link with `` `file.js` `` as its text, still is. The target is resolved relative to the page.
- **Path tokens**: every string like `dir/file.ext`, with at least one `/` and an extension, preceded by a backtick, a quote, `(` or whitespace. Letters and digits from any script are allowed, so accented names match. A token is resolved relative to the page first, then relative to the repository root. Path tokens are read from the whole page, code included, because files are usually named in backticks.
- **Inline code spans**: the full content of each single-line inline code span that contains a `/`, so a path with spaces written in backticks, such as `` `src/old name.js` ``, is found too.

Targets with a URL scheme or starting with `#` are ignored. Anchors and query strings are removed, and percent-escapes are decoded with `safeDecode`. A malformed escape such as `50%.md` is left as written instead of throwing. A reference counts only when the resolved path is in the file set. `map` and `changed` build the file set from source files. `check` builds it from all files plus the doc pages, and uses only the links, to find broken ones.

Pages under `_archive`, `_generated`, `archive` or `history` folders of the docs tree are "historical". Their references are collected, but they don't count toward coverage, and their broken links aren't reported.

## Commands

**`inventory`** groups source files by first path segment (`(root)` for files at the root) and counts files and lines. Areas with more than 25 files also list their second-level folders (up to 12), all sorted by line count. It reports the docs folder and its page count, the documented commit, and `mode`: `update` when the docs folder has at least one `.md` page, otherwise `create`.

**`map`** builds, for every source file, the list of current pages that reference it. `coverage` is documented files divided by all source files, or 1 when there are none. The text output lists the undocumented files grouped by area and then one by one. The JSON output also includes `pages`, mapping each page to the files it references.

**`changed`** needs git and a docs folder. Its baseline is `--since`, or the `commit` in `.jev-doc.json`. If that commit doesn't exist in the repository, it falls back to the last commit that touched the docs folder. With none of these, it reports `no baseline commit`. It collects changes in two steps:

1. `git diff --name-status -z -M <baseline> HEAD` gives committed changes. Fields are NUL-separated: `<status>`, then the path, or `R<score>`/`C<score>` followed by the old and new paths. Renames become `R`, and copies count as an addition of the new path.
2. `git status --porcelain -z -uall` adds working-tree changes. Entries are `XY <path>`, and a rename or copy entry is followed by a separate field with the old path. In that order, the script records renames, deletions, additions and untracked files (`A`, unless the file was already `M` in the committed diff) and modifications.

`-z` keeps every path exactly as git stores it, unquoted, so names with spaces or non-ASCII characters match the `ls-files` names.

It keeps changes to source files, plus deletions and renames of files that pages still reference. Then it sorts them into four lists:

| List | Contains |
|---|---|
| `pagesToUpdate` | Each current page that references a modified, added, deleted or renamed-from file, with those changes |
| `undocumentedNew` | Added files, and renamed files, that no page references under either name |
| `undocumentedModified` | Modified files no page references |
| `brokenRefs` | Deleted files, and the old names of renamed files, that pages still reference |

**`check`** starts with a **layout** verdict. The layout follows the create-jev-doc format, `layout.conforms`, only when all of these hold:

- the docs folder has a root `README.md` hub
- there is at least one domain: a top-level folder, not historical or dot-prefixed, with current pages
- no current page other than the root hub sits directly in the docs folder (`pagesOutsideDomains`)
- every domain has a `README.md` (`domainsWithoutHub`), and the root hub links it (`domainsNotInRootHub`)
- every current page other than a `README.md` is linked from some `README.md` hub (`pagesNotInAnyHub`)
- no hub line lacks a description

The text output prints `layout: follows the create-jev-doc format (N domains)`, or `does NOT follow`, followed by each failed rule. The JSON output has the `layout` object with each list and `domains`. The skill uses this verdict to choose between update and restructure mode (see the [skill page](skill.md#mode-detection)).

It then reports, for the current pages:

- **broken links**: link targets that are neither a known file nor an existing path
- **orphans**: pages that no other page links to, except the root `README.md`
- **folders without a hub**: folders with `.md` pages other than `.prompt.md` files but no `README.md`, case-insensitive
- **hub lines without a description**: list items in a `README.md`, outside code, that consist of a single `.md` link and nothing after it
- **missing titles**: pages without a `# ` heading after any frontmatter, ignoring `.prompt.md` files

**`stamp`** writes `.jev-doc.json` with every existing field, plus `commit` (HEAD, or `null` outside git), `updatedAt` and `tool: "create-jev-doc"`. If tracked files have uncommitted changes, it notes that they count as documented only once committed. The fields are described on the [skill page](skill.md#the-state-file).

## Output

Every command prints one block of text, or with `--json` one pretty-printed JSON object. When a precondition fails (no docs folder, not a repository, no baseline), it prints an object with an `error` field, or an explanatory sentence. In those cases the exit code is still 0, so scripts must check the output, not the exit status.

## Limits

- Coverage is file-level. A file counts as documented if any current page names it, however briefly.
- Path tokens are read from code too, so a source path mentioned only in a code example still counts as a reference.
- A path with spaces is found only when it is a whole inline code span or a link target (with `%20`). Plain prose with spaces isn't parsed as a path.
- Line counts split on `\n`, and a file ending in a newline counts one extra line.
- `check` and the root-hub exception compare `README.md` case-sensitively for the root page.

## Verification

[`test/doc-coverage.test.mjs`](../../test/doc-coverage.test.mjs) builds temporary git repositories and runs the script with `--json`:

- `inventory` in create mode: it skips `dist/` and the lock file
- `map` and `check`: two referenced files, one broken link, one orphan page, one hub line without a description
- `changed` after `stamp`: the state-file baseline, a page to update, a new undocumented file, a deleted file still referenced
- `changed` with an accented file changed in a commit, a file with a space changed in the working tree, a staged rename of a file with a space, and an untracked accented file
- `check`: links in inline code and fenced blocks are ignored, a malformed `50%.md` link is reported without a crash, a link whose text is code still counts for `map`, and the layout verdict passes, then fails once a page sits at the docs root
- `check` on a flat `docs/` folder with no hub: missing root hub, no domains, two pages outside domains

During development, the script also ran read-only against a repository with about 4,000 source files and 1,400 pages. Each command finished in about 2 seconds. The suite was run while writing this page: 24 tests, all passing.
