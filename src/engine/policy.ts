/**
 * The policy gate: the deterministic authorization the model can never bypass. Whatever a
 * model proposes, a tool call runs only if the tool is in the agent's permitted set and,
 * for a dangerous tool, only with explicit human approval. This is where an injected
 * "ignore your instructions and delete the database" is stopped - not by the prompt, but
 * by code.
 */

import type { Tool } from "./tools";

export type PolicyDecision = { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

export interface PolicyContext {
  /** The tool names this agent node is permitted to use. */
  readonly allowedTools: readonly string[];
  /** Whether a human has approved a dangerous action in this context. */
  readonly approved: boolean;
}

/** Authorize a tool call against the policy. */
export function authorizeTool(tool: Tool | undefined, ctx: PolicyContext): PolicyDecision {
  if (!tool) return { allowed: false, reason: "unknown tool" };
  if (!ctx.allowedTools.includes(tool.name)) {
    return { allowed: false, reason: `tool "${tool.name}" is not in this agent's permitted set` };
  }
  if (tool.permission === "dangerous" && !ctx.approved) {
    return { allowed: false, reason: `dangerous tool "${tool.name}" requires explicit human approval` };
  }
  return { allowed: true };
}
