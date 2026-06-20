# Release HOWTO

## Creating npm version

Good habit is to ask Gaunt Sloth to review changes before releasing them:

```bash
git --no-pager diff v0.8.3..HEAD | gth review
```

Make sure `npm config set git-tag-version true`

! Important ! The `files` block of package.json strictly controls what is actually released,
the `files` makes .npmignore ignored.

### Unified, locked versioning (all four packages)

As of v2 **all four packages release in lockstep at one version**:

- `@gaunt-sloth/core`, `@gaunt-sloth/agent`, `@gaunt-sloth/review` (the scoped libraries), and
- `gaunt-sloth` — the fat user-facing CLI (dir `packages/assistant`; the package **name** is
  `gaunt-sloth`, not `@gaunt-sloth/assistant`). The former `@gaunt-sloth/tools` and
  `@gaunt-sloth/api` were merged into `@gaunt-sloth/agent` in the 2.0 break.

`packages/core/package.json` is the source of truth for the version. `npm version` does not work
well in workspaces for scoped packages, so use the bump script. Version computation uses
`semver.inc(current, releaseType, preid)` — the same engine npm uses:

```bash
npm run release:bump                          # patch-increment core's version AND sync all four
npm run release:bump -- minor                 # patch | minor | major AND sync
npm run release:bump -- prerelease alpha      # walk the prerelease counter on the alpha channel
npm run release:bump -- preminor alpha        # open the next minor's alpha line
npm run release:bump -- 2.0.0-alpha.0         # set an explicit version AND sync
npm run release:bump-and-commit -- <args>     # same, then refresh package-lock.json and commit
```

Release types: `patch | minor | major | prepatch | preminor | premajor | prerelease`, plus an
explicit `MAJOR.MINOR.PATCH[-prerelease]`. An optional preid (`alpha | beta | rc`) applies to the
`pre*`/`prerelease` verbs.

The script rewrites each package's `"version"`, the scoped libraries' exact pins on each other,
and the fat CLI's `@gaunt-sloth/*` dependency pins. It also writes `publishConfig.tag` into **all
four** package.jsons, derived from the new version: a prerelease (`2.0.0-alpha.0`) gets its preid
(`alpha`/`beta`/`rc`) as the tag; a stable version gets `latest`. This is the `latest`-hijack
guard (see below). Commit the result before publishing — `release:bump-and-commit` does that for
you, including the lockfile refresh (`npm install --package-lock-only`) that keeps the next
`npm ci` happy.

### Prereleases never take `latest`

`npm publish` defaults to `--tag latest` for **every** version regardless of any prerelease
suffix. Two guards keep a prerelease (`-alpha`/`-beta`/`-rc`) off `latest`:

1. **`publishConfig.tag`** in each package.json (written by the bump script) — so even a bare
   `npm publish` routes to the prerelease channel.
2. **Explicit `--tag <dist-tag>`** in the release pipeline, derived from the resulting version.

A stable version derives `latest`; a prerelease derives its preid.

### Releasing — the consolidated pipeline (CI, recommended)

**One workflow, [release.yml](../.github/workflows/release.yml), replaces the old `publish.yml`
and `publish-packages.yml`.** Dispatch it from the Actions tab via the "Run workflow" button. It
is `workflow_dispatch` (not `release: published`) so the tag + GitHub Release are created **last**,
only after every gate is green. Job graph:

```
lint+unit  ->  integration-tests (big provider)
           ->  integration-tests-platforms (macOS + Windows)
           ->  release   (bump + build + push + tag + GitHub Release + publish all four)
```

The "Run workflow" form has three inputs:

- **`bump`** — the semver verb: `patch | minor | major | prepatch | preminor | premajor |
  prerelease | explicit`.
- **`preid`** — `alpha | beta | rc`; only used by the `pre*`/`prerelease` verbs.
- **`explicit_version`** — an exact version (e.g. `2.0.0-alpha.0`); only used when `bump = explicit`.

The full lifecycle from those inputs:

| want | from | inputs | result | dist-tag |
| --- | --- | --- | --- | --- |
| first v2 alpha | 0.1.8 / 1.5.6 | `bump=explicit`, `explicit_version=2.0.0-alpha.0` | `2.0.0-alpha.0` | alpha |
| next alpha | 2.0.0-alpha.0 | `bump=prerelease`, `preid=alpha` | `2.0.0-alpha.1` | alpha |
| promote to beta | 2.0.0-alpha.3 | `bump=prerelease`, `preid=beta` | `2.0.0-beta.0` | beta |
| promote to rc | 2.0.0-beta.1 | `bump=prerelease`, `preid=rc` | `2.0.0-rc.0` | rc |
| GA | 2.0.0-rc.2 | `bump=patch` *(finalizes)* | `2.0.0` | **latest** |
| stable patch | 2.0.22 | `bump=patch` | `2.0.23` | latest |
| next minor's alpha | 2.0.22 | `bump=preminor`, `preid=alpha` | `2.1.0-alpha.0` | alpha |

The `release` job checks out `main`, bumps + commits the version, builds, pushes the commit, runs
`./tag-packages.sh --push` (which now tags all four, including `gaunt-sloth`), creates
`gh release create v<version>` (with `--prerelease` when the version has a prerelease suffix), and
publishes all four to npmjs in dependency order with `--tag <derived>`. Publishing uses npm
Trusted Publishing (OIDC) — no token. Each package's Trusted Publisher on npmjs must point at this
repo and `release.yml`.

### Releasing manually

Bump and commit first (see above): npm refuses to republish an existing version.

Tags follow the `<name>@<version>` convention (npm monorepo style) and are annotated. The helper
reads each package's current `package.json` and tags all four — `@gaunt-sloth/core@<v>`,
`@gaunt-sloth/agent@<v>`, `@gaunt-sloth/review@<v>`, and `gaunt-sloth@<v>` for the fat CLI.
Existing tags are skipped, so it's safe to re-run:

```bash
./tag-packages.sh            # create the tags locally
./tag-packages.sh --push     # create and push them (PUSH=1 ./tag-packages.sh also works)
```

Preview what will be included in each package:

```bash
npm pack --dry-run -w @gaunt-sloth/core
npm pack --dry-run -w @gaunt-sloth/agent
npm pack --dry-run -w @gaunt-sloth/review
npm pack --dry-run -w gaunt-sloth
```

Publish all four in dependency order (core → agent → review → `gaunt-sloth`). The script defaults
to a local Verdaccio at `http://localhost:4873`
(see [CONTRIBUTING.md](../CONTRIBUTING.md#local-development-registry-optional)); set `REGISTRY` to
target npmjs:

```bash
REGISTRY=https://registry.npmjs.org npm run release:publish
```

Note: the first ever publish of a scoped package requires `--access public` (pass it via
`NPM_PUBLISH_ARGS="--access public"`). After that it's not needed. To force a dist-tag for a
prerelease when running manually, add `--tag <alpha|beta|rc>` to `NPM_PUBLISH_ARGS`
(`publishConfig.tag` already covers this, but the explicit flag is belt-and-suspenders).

### Test-deploying library packages

See [TEST-DEPLOY.md](TEST-DEPLOY.md) for how to test-deploy `@gaunt-sloth/review`
as a standalone global install before publishing.

## GitHub Release

The consolidated pipeline creates the GitHub Release automatically (`gh release create
v<version>`, with `--prerelease` for prerelease versions) as its last step. You normally don't
create releases by hand. If you ever need to:

(if you have multiple accounts in gh, you may need to do `gh auth switch`)

```bash
gh release create v<version> --generate-notes        # or --notes-from-tag / --notes-file / --notes
```

## Viewing diff side by side

Configure KDE diff Kompare as github difftool

```bash
# Configure default git diff tool
git config --global diff.tool kompare
# Compare all changed files
git difftool v0.9.3 HEAD -d
```

Configure vimdiff

```bash
# Configure default git diff tool
git config --global diff.tool vimdiff
# Compare changed files one by one
git difftool v0.9.3 HEAD
```

## Cleaning up the mess

Delete incidental remote and local tag

```bash
git tag -d v0.3.0
git push --delete origin v0.3.0
```
