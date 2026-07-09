# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev          # dev server, http://localhost:3000
npm run build        # production build (output: 'standalone')
npm start            # serve the production build
npm test             # vitest run (one-shot)
npm run test:watch   # vitest watch
```

Run a single test file or test name:

```bash
npx vitest run tests/ingest.test.ts
npx vitest run -t "bumps patch version"
```

Local run requires env (copy `.env.example` → `.env`): `ADMIN_USER`, `ADMIN_PASSWORD`, `MARKETPLACE_REPO_URL`, `MARKETPLACE_NAME`. First boot clones the marketplace repo into `data/marketplace/`.

Docker: `docker build -t skill-hub . && docker run -p 3000:3000 --env-file .env -v $(pwd)/data:/data skill-hub`. The image sets `DATA_DIR=/data` / `MARKETPLACE_DIR=/data/marketplace` and installs `git` as a runtime dependency (the app clones/pulls at runtime).

## Architecture

Next.js 16 App Router + React 19 + TypeScript (strict) + Tailwind v4 + Vitest. No database. **The marketplace git repo is the single source of truth** — the app only wraps it: browse reads from a local clone, upload/import writes into it and pushes back.

### Layering

- `src/lib/*.ts` — pure logic (git ops, ingest, auth, settings, watched). Synchronously testable with Vitest; no Next imports except `session.ts`/`auth.ts` (which lazy-`import('next/headers')`).
- `src/app/api/*/route.ts` — thin route handlers. Pattern: check `getUser()` (auth) → call lib → `syncFromRemote()` → mutate via `withWorkTree` → `push()` → on push failure `resetTo(before)`. Always `stripCreds()` errors before returning (the repo URL may embed a token).
- `src/app/**/page.tsx` — server components, `export const dynamic = 'force-dynamic'` (reads live repo state). Detail pages read via `git show HEAD:...`.
- `src/app/_components/*` — client components (forms, drag-and-drop grid, toasts).

### The no-checkout repo pattern (load-bearing)

`data/marketplace/` is a `--no-checkout` clone: the working directory is empty except `.git`. **Never** read/write plugin files off the filesystem there.

- **Reads** go through git: `git show HEAD:<path>` (`marketplace.ts:gitShow`), `git ls-tree HEAD` (`ingest.ts:pluginExistsInHead`, `marketplace.ts:getPluginDetail`).
- **Writes** go through `withWorkTree(repoDir, fn, msg)` (`src/lib/worktree.ts`): mkdtemp → `git --work-tree=tmp checkout -f HEAD` → `fn(tmp)` mutates files → `git add -A` → `git commit` → rm tmp. The caller only touches the temp worktree; commit is centralized here.
- `ensureRepo()` (`src/lib/repo.ts`) bootstraps: clone `--no-checkout` if a remote URL exists, else `git init`; migrates any legacy checked-out worktree back to no-checkout; seeds the first commit if there's no HEAD.
- `syncFromRemote()` fetches and `reset --mixed origin/<branch>` **only if** there are no local-ahead commits (`rev-list origin..HEAD`); local unpushed commits are preserved. Call this before every mutating push to avoid non-fast-forward rejections.

### Data layout

`DATA_DIR` (env, default `./data`, Docker `/data`) holds all runtime state:
- `marketplace/` — the no-checkout marketplace clone (git is the DB).
- `watched/<id>/` — shallow clones (`--depth 1 --recurse-submodules`) of monitored upstream skill repos.
- `watched.json` — watched-repo list (also mirrored into the marketplace repo at `.skill-hub/watched.json` so it survives container rebuilds; `restoreWatchedFromRepo()` rehydrates it).
- `settings.json` — `repoUrl`, `token` (injected into the git URL's username field), and `authSecret` (auto-generated on first boot if `AUTH_SECRET` env is unset).

`src/lib/config.ts` centralizes `DATA_DIR`/`REPO_DIR`/`MARKETPLACE_NAME` and `stripCreds()`.

### Skill ingestion (`src/lib/ingest.ts`)

Upload a zip → extract to tmp → `findRoot()` locates the package root (`.claude-plugin/plugin.json` = plugin, `SKILL.md` = skill; shallow BFS, stops at first root per branch) → copy into `plugins/<name>/` via `withWorkTree`, writing/patching `plugin.json` + the `.claude-plugin/marketplace.json` manifest entry → push. Version rule: on overwrite the new version must be strictly greater than the current HEAD version (`semver.ts`, X.Y.Z only); `bumpPatch` is the default.

### Watched repos & updates (`src/lib/watched.ts`)

Monitor upstream skill repos, shallow-cloned into `data/watched/<id>`. `buildIndex()` scans all cached clones (memoized in-process; `invalidateIndex()` on any mutation) to produce an aggregate package index. `updateStatus()` diffs local marketplace versions against the index and reports packages whose remote version is higher. Refresh runs per-repo fetch+reset with a concurrency pool of 6; a failing clone doesn't abort the others.

### Auth (`src/lib/auth.ts`, `src/lib/session.ts`)

Hand-rolled: HMAC-SHA256 token = `base64url(payload).base64url(hmac(payload, secret))`, 7-day TTL, stored in httpOnly cookie `sh_session`. Credentials come from `ADMIN_USER`/`ADMIN_PASSWORD` env; compared with `timingSafeEqual`. In-memory per-IP rate limiting (5 fails / 5 min). `requireUser()` throws a 401 `Response` for guarded routes. No auth library.

### GitHub proxy (`src/app/proxy/[...path]/route.ts`)

Proxies `git` clone traffic to GitHub for users behind the GFW. Strips `git-protocol` to force protocol v0 (v2's chunked/multi-round responses break Next's stream forwarding and hang clones) and strips hop-by-hop headers. `githubProxy.ts` validates `owner/repo` segments to prevent path traversal.

## Conventions

- New `.ts`/`.tsx` files start with `/** @author sgz @since YYYY-MM-DD */` (see existing files).
- Deliberate shortcuts/simplifications are marked with a `// ponytail: <reason>` comment naming the ceiling and upgrade path — preserve and respect these.
- Design notes and plans live under `docs/superpowers/` (gitignored); consult them for historical context on non-obvious features.
- The marketplace repo's manifest is `.claude-plugin/marketplace.json` (Claude Code's official schema); plugin files live under `plugins/<name>/`. Don't break this layout — it's what makes `/plugin marketplace add` work against the published repo.
