---
inclusion: always
---

# Revenant — Structure Steering

## Directory Layout
```
kiroween-pipes/
├── packages/
│   ├── engine/          # pure TS library — DAG, operators, serialisation
│   │   └── src/
│   │       ├── modules/ # one file per operator (see Module Convention below)
│   │       ├── dag/     # graph validation and topological sort
│   │       ├── runner/  # DAG executor, per-node error isolation
│   │       └── schema/  # Zod schemas for PipeJson and item model
│   ├── server/          # Hono app — API, hauntings, SSRF-safe fetcher
│   │   └── src/
│   └── web/             # React 19 + Vite + @xyflow/react canvas
│       └── src/
├── data/
│   └── pipes/           # *.pipe.json files (runtime storage)
├── docs/                # architecture notes, module reference (auto-generated)
├── .kiro/
└── package.json         # workspace root
```

## Naming Conventions
- Files: `kebab-case.ts` for all source files.
- Operator module files: `<plain-name>.ts` (e.g., `filter.ts`, `unique.ts`).
- Zod schemas: `*Schema` suffix (e.g., `FilterConfigSchema`).
- React components: `PascalCase.tsx`.
- Pipe JSON files: `<slug>.pipe.json`.

## Module File Convention
Each file in `packages/engine/src/modules/` exports a single named `definition`:

```ts
import type { ModuleDefinition } from '../types.js';

export const definition: ModuleDefinition<Config, Input, Output> = {
  type: 'filter',          // matches node type in *.pipe.json
  configSchema: FilterConfigSchema,
  inputPorts: ['items'],
  outputPorts: ['out'],
  execute(inputs, config) { /* pure — no I/O */ },
};
```

## Test Colocation
- Unit and property-based tests live next to the source file: `filter.test.ts`.
- Integration / e2e tests live in `packages/server/src/__tests__/`.

## Import Rules
- `web` and `server` may depend on `engine`. The reverse is forbidden.
- `web` must not import from `server` directly (use the HTTP API).
- Shared types used across packages belong in `packages/engine/src/types.ts`.
