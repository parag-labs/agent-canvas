# Security model

AgentCanvas is built around one assumption: **the model is untrusted**. It may be wrong,
and its input may be adversarial (prompt injection). The engine is designed so that being
wrong or being attacked cannot cause an unsafe action.

## The boundary

> The LLM reasons and proposes. Deterministic code validates and executes.

An agent node can propose any tool call, including a dangerous one. Whether that call runs
is decided by `authorizeTool` in `src/engine/policy.ts` — deterministic code that the
model's output feeds into but cannot rewrite.

```ts
export function authorizeTool(tool: Tool | undefined, ctx: PolicyContext): PolicyDecision {
  if (!tool) return { allowed: false, reason: "unknown tool" };
  if (!ctx.allowedTools.includes(tool.name))
    return { allowed: false, reason: `tool "${tool.name}" is not in this agent's permitted set` };
  if (tool.permission === "dangerous" && !ctx.approved)
    return { allowed: false, reason: `dangerous tool "${tool.name}" requires explicit human approval` };
  return { allowed: true };
}
```

## Controls

1. **Deny-by-default tools.** An agent only sees the tools its node was granted at design
   time. A tool the workflow didn't grant is rejected even if the model names it.

2. **Dangerous tools need explicit approval.** Tools flagged `dangerous` (e.g.
   `delete_database`) are refused unless a human approval is present for that call. The
   default approval policy grants node approvals but **denies** dangerous tools.

3. **Bounded execution.** Every agent loop is capped by `maxIterations`, `maxToolCalls`,
   and a token budget, and the DAG walk has a hard step cap. A hostile or confused agent
   cannot loop forever or run up unbounded cost.

4. **Append-only audit trail.** Every proposal, allow, deny, and execution is an immutable
   event (`ToolRequested`, `ToolRejected`, `ToolCompleted`, …). You can see exactly what
   the model asked for and what the engine did about it.

## Why the mock model is deliberately "trickable"

`MockLLM` will request a tool if the input merely mentions its name. That is intentional:
it stands in for a model that *has* been successfully prompt-injected. The security test
(`src/engine/__tests__/security.test.ts`) drives an adversarial input at an
over-permissioned workflow so the model proposes `delete_database` — and then asserts the
tool is **still never executed**, because the policy gate refuses it.

That's the whole point: the safety property is proven to come from the **policy**, not
from the prompt. A prompt-based guard would pass the same test for the wrong reason.

## What is out of scope

- This is a portfolio/reference implementation. Runs are held in memory; there is no
  authentication, multi-tenant isolation, or persistence.
- The default LLM is a mock. A real provider adapter would sit behind the existing `LLM`
  interface without changing the policy gate.
- Tools here are simulations (echo, web_search, delete_database). Wiring real side effects
  would mean giving each a real implementation *behind the same authorization gate* — the
  gate is the extension point, by design.

## Reporting

This is a personal portfolio project. If you spot a security issue in the model, please
open an issue describing it.
