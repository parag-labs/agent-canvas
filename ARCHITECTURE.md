# Architecture

AgentCanvas is split into two halves with a hard line between them:

1. **A deterministic engine** (`src/engine/`) with no framework dependencies. This is the
   part that is unit-tested and the part that matters. It has no knowledge of React, Next,
   or HTTP.
2. **A thin Next.js UI** (`src/app`, `src/components`) that visualizes a workflow and calls
   the engine over one API route.

Everything below is about the engine.

## The core rule

> The LLM reasons and proposes. Deterministic code validates and executes.

An agent node runs a model. The model can propose a final answer or a tool call. It cannot
*perform* anything. Tool execution only happens after `authorizeTool` (in `policy.ts`)
allows it, and the executor — not the model — decides control flow. This keeps the trusted
computing base small and testable: the model's output is just data flowing into a
deterministic state machine.

## Modules

| Module | Responsibility |
|--------|----------------|
| `ids.ts` | Branded id types (`NodeId`, `RunId`, …) and a monotonic counter for deterministic ids. |
| `nodes.ts` | The `WorkflowNode` discriminated union (input/agent/tool/condition/humanApproval/evaluator/transform/output), its Zod schema, and `assertNever`. |
| `workflow.ts` | The typed builder DSL, `assemble()` runtime validation, and `parseWorkflow()` for untrusted JSON. |
| `events.ts` | The event union and the append-only `EventLog`. |
| `tools.ts` | The `ToolRegistry`, tool permissions (`safe` / `dangerous`), and runtime arg validation. |
| `llm.ts` | The `LLMProvider` interface plus `MockLLM` / `ScriptedLLM`. |
| `policy.ts` | `authorizeTool` — the deterministic authorization gate. |
| `executor.ts` | `execute()`: the event-sourced DAG walk and the bounded agent loop. |
| `replay.ts` | Reconstruct and step through a run from its event log. |
| `evaluate.ts` | The scored evaluation harness. |
| `examples.ts` | Example workflows shared by tests, eval, and UI. |

## Typed workflow DSL

`workflow(name)` returns a `WorkflowBuilder<Names>` whose `Names` type parameter is a union
of the node names declared so far. Each `.add(node)` widens `Names`; `.connect(from, to)`
is typed to only accept members of `Names`. So an edge to a node you never declared is a
**compile-time** error.

`.build()` (aka `assemble()`) then does the runtime checks that types can't express:

- node names are unique,
- there is exactly one `input` node,
- there is at least one `output` node,
- every edge references real nodes,
- the graph is acyclic.

`parseWorkflow(json)` is the untrusted path: it validates with Zod first, then runs the
same assembly checks, so external input converges on exactly the same invariants as
code-built workflows.

## Event sourcing

`execute()` never mutates shared state in place; it appends immutable events
(`WorkflowStarted`, `NodeStarted`, `ModelResponse`, `ToolRequested`, `ToolRejected`,
`ToolCompleted`, `NodeCompleted`, `WorkflowCompleted`, …) to an `EventLog`. The `RunResult`
is derived entirely from that log. Two consequences:

- **Replay / time-travel** (`replay.ts`) is just folding the event log forward to any
  index — the UI scrubber and the replay tests both use it.
- **Evaluation** reads the same events, so metrics reflect exactly what happened.

## Determinism

- The clock is injectable (`opts.clock`); tests use a monotonic counter so timestamps and
  latency are reproducible.
- Ids come from a seeded counter, not randomness.
- The `MockLLM` is a pure function of its inputs.

That's why the eval table is stable run to run and safe to commit.

## The bounded agent loop

`runAgent` caps three things so a confused or adversarial agent can't run away:

- `maxIterations` — total reason/act cycles,
- `maxToolCalls` — tool invocations,
- `tokenBudget` — accumulated tokens (cost is `tokens * COST_PER_TOKEN`).

If the loop hits its bound without a final answer, it summarizes and returns — it never
hangs. On top of that, the DAG walk itself has a hard step cap (`nodes.length + 1`) as a
last rail against a malformed graph.

## UI boundary

`src/app/api/run/route.ts` runs the engine server-side against a known example workflow
and a `MockLLM`; it takes no secrets. `src/components/Canvas.tsx` is a `"use client"`
component that imports the (pure, browser-safe) engine builders only for visualization and
posts to `/api/run` to execute. The engine depends on nothing in the UI; the dependency
arrow points one way.
