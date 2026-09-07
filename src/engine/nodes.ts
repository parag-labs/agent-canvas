/**
 * The node type system: a discriminated union of every kind of node a workflow can
 * contain. The `kind` field is the discriminant, and `assertNever` gives us exhaustive
 * checking - if a new node kind is added and a switch doesn't handle it, the build fails.
 */

import { z } from "zod";
import type { NodeId } from "./ids";

/** Every node kind. Adding one here forces every exhaustive switch to handle it. */
export type NodeKind =
  | "input"
  | "agent"
  | "tool"
  | "condition"
  | "humanApproval"
  | "evaluator"
  | "transform"
  | "output";

/** Fields common to all nodes. */
interface NodeBase {
  readonly id: NodeId;
  readonly name: string;
}

/** The entry point; carries the workflow's initial input into the graph. */
export interface InputNode extends NodeBase {
  readonly kind: "input";
}

/** An LLM-driven agent: runs a bounded reason/act loop over its allowed tools. */
export interface AgentNode extends NodeBase {
  readonly kind: "agent";
  readonly model: string;
  readonly systemPrompt: string;
  readonly tools: readonly string[];
  readonly limits: AgentLimits;
}

/** Every agent must be bounded. These are hard rails the executor enforces. */
export interface AgentLimits {
  readonly maxIterations: number;
  readonly maxToolCalls: number;
  readonly tokenBudget: number;
}

/** Invoke a single tool directly (no LLM). */
export interface ToolNode extends NodeBase {
  readonly kind: "tool";
  readonly tool: string;
}

/** Route to one of two outgoing edges based on a deterministic predicate. */
export interface ConditionNode extends NodeBase {
  readonly kind: "condition";
  /** A structured predicate over the current value - never `eval`'d code. */
  readonly predicate: Predicate;
}

/** A structured, safe predicate (no arbitrary code execution). */
export interface Predicate {
  readonly path: string; // dot-path into the value, or "" for the value itself
  readonly op: "eq" | "neq" | "contains" | "gt" | "lt" | "exists";
  readonly value?: string | number;
}

/** Pause for a human decision before continuing. */
export interface HumanApprovalNode extends NodeBase {
  readonly kind: "humanApproval";
  readonly reason: string;
}

/** Score the current value 0..1 with a named scorer. */
export interface EvaluatorNode extends NodeBase {
  readonly kind: "evaluator";
  readonly scorer: string;
  readonly expected?: string;
}

/** A deterministic value transform. */
export interface TransformNode extends NodeBase {
  readonly kind: "transform";
  readonly op: "uppercase" | "lowercase" | "trim" | "jsonStringify" | "length";
}

/** A terminal node collecting a result. */
export interface OutputNode extends NodeBase {
  readonly kind: "output";
}

/** The discriminated union of all nodes. */
export type WorkflowNode =
  | InputNode
  | AgentNode
  | ToolNode
  | ConditionNode
  | HumanApprovalNode
  | EvaluatorNode
  | TransformNode
  | OutputNode;

/** Narrow a node kind to its node type (a small conditional-type utility). */
export type NodeOfKind<K extends NodeKind> = Extract<WorkflowNode, { kind: K }>;

/**
 * Exhaustiveness helper. Call in the `default` branch of a switch over a discriminated
 * union; if a case is unhandled the argument won't be `never` and the build fails.
 */
export function assertNever(x: never, message = "unexpected variant"): never {
  throw new Error(`${message}: ${JSON.stringify(x)}`);
}

// --- runtime validation (Zod) for nodes crossing an untrusted boundary ---

const predicateSchema = z.object({
  path: z.string(),
  op: z.enum(["eq", "neq", "contains", "gt", "lt", "exists"]),
  value: z.union([z.string(), z.number()]).optional(),
});

const limitsSchema = z.object({
  maxIterations: z.number().int().positive().max(50),
  maxToolCalls: z.number().int().positive().max(100),
  tokenBudget: z.number().int().positive(),
});

/** Zod schema for a node, used when a workflow arrives from outside the process. */
export const nodeSchema: z.ZodType<WorkflowNode> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("input"), id: z.string(), name: z.string() }),
  z.object({
    kind: z.literal("agent"), id: z.string(), name: z.string(),
    model: z.string(), systemPrompt: z.string(), tools: z.array(z.string()), limits: limitsSchema,
  }),
  z.object({ kind: z.literal("tool"), id: z.string(), name: z.string(), tool: z.string() }),
  z.object({ kind: z.literal("condition"), id: z.string(), name: z.string(), predicate: predicateSchema }),
  z.object({ kind: z.literal("humanApproval"), id: z.string(), name: z.string(), reason: z.string() }),
  z.object({ kind: z.literal("evaluator"), id: z.string(), name: z.string(), scorer: z.string(), expected: z.string().optional() }),
  z.object({ kind: z.literal("transform"), id: z.string(), name: z.string(), op: z.enum(["uppercase", "lowercase", "trim", "jsonStringify", "length"]) }),
  z.object({ kind: z.literal("output"), id: z.string(), name: z.string() }),
]) as unknown as z.ZodType<WorkflowNode>;
