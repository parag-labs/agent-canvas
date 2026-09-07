# Contributing

Thanks for taking a look. This is a personal portfolio project, but the workflow is the
same one I'd use on a team.

## Setup

```bash
pnpm install
pnpm dev
```

Requirements: Node 20+ and pnpm 9+. No API keys — the default LLM is a deterministic mock.

## Before you push

All four gates must be green; CI runs exactly these:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

If you touch the engine, add or update a test in `src/engine/__tests__/`. The engine is
meant to be fully covered by unit tests — please keep it that way.

## Ground rules

- **The engine stays framework-free.** Nothing in `src/engine/` may import from `src/app`
  or `src/components`, or from React/Next. The dependency arrow points UI → engine only.
- **Keep the core rule intact.** The model proposes; deterministic code validates and
  executes. Any new tool must go through the policy gate. Don't add a path that lets model
  output perform an action directly.
- **Determinism.** Use the injected clock and the seeded counter — no `Math.random()` or
  bare `Date.now()` in engine logic that a test can't control.
- **Never fabricate eval numbers.** The table in the README is produced by `pnpm eval`. If
  behavior changes, re-run it and paste the real output.
- **Types over comments.** Prefer making an invalid state unrepresentable (branded ids,
  discriminated unions, the typed builder) to documenting that it shouldn't happen.

## Commit style

Small, focused commits with imperative subjects ("Add token-budget guard to agent loop").
Keep the diff to one concern.
