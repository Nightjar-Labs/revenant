---
inclusion: always
---

# Revenant — Tech Steering

## Pinned Stack

| Layer | Choice |
|---|---|
| Language | TypeScript (strict mode, `noUncheckedIndexedAccess`) |
| Runtime | Node 22 |
| Package management | npm workspaces monorepo |
| HTTP server | Hono |
| UI framework | React 19 + Vite |
| Canvas | @xyflow/react |
| Schema validation | Zod (pipeline schema, operator config) |
| Feed parsing | fast-xml-parser |
| JSON queries | jsonpath-plus |
| Testing | Vitest + fast-check (property-based) |
| Linting / formatting | ESLint + Prettier |

## Pipeline Storage
Pipelines are plain `*.pipe.json` files on disk under `data/pipes/`. No database.
The schema is validated with Zod on load and on save.

## Engine Design Constraints
- `packages/engine` is a **pure library**: operators perform no I/O.
- Fetching is **injected** via a `Fetcher` interface passed at runtime.
- The server provides an SSRF-safe fetcher that:
  - Resolves DNS before connecting and blocks RFC-1918 / loopback ranges.
  - Enforces a response size limit (default 5 MB) and a timeout (default 10 s).
  - Allows only `http:` and `https:` schemes.

## Common Commands
```
npm run dev      # start server + Vite dev server (watch mode)
npm run test     # vitest run (all packages)
npm run lint     # eslint + prettier --check
npm run build    # tsc + vite build (all packages)
```

## Constraints
- No auth, no multi-tenancy, no external service dependencies at runtime.
- License: MIT.
- Do not introduce new runtime dependencies without updating this file.
