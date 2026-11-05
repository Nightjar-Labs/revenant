---
inclusion: fileMatch
fileMatchPattern: ["**/*.test.ts", "**/*.test.tsx"]
---

# Revenant — Testing Steering

## Test Location
Colocate unit and property-based tests next to source: `filter.test.ts` next to `filter.ts`.
Integration / e2e tests live in `packages/server/src/__tests__/`.

## Property-Based Testing
Use `fast-check` for operator invariants (idempotence, order preservation, subset).
Default `numRuns: 100` per property; increase for critical paths if flakes occur.
Label each property test with a comment linking to design.md correctness properties:

```ts
// Property 1: Unique is idempotent
fc.assert(fc.property(itemsArbitrary, (items) => { /* ... */ }), { numRuns: 100 });
```

## Arbitraries
Define shared arbitraries for `Item` in `packages/engine/src/__tests__/arbitraries.ts`:
- `itemArbitrary`: generates valid `ItemSchema` instances.
- `itemsArbitrary`: `fc.array(itemArbitrary)` with reasonable size bounds.

## Mocks
Operators are pure. Tests requiring side effects must inject mocks:
- `Fetcher`: return fixture responses; never call real network.
- `Clock`: return deterministic timestamps.

## Fixtures
Store fixture RSS/Atom/JSON responses in `packages/engine/src/__tests__/fixtures/`.
