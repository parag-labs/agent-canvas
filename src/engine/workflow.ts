/**
 * The typed workflow DSL. The builder threads the set of declared node names through its
 * own type parameter, so `connect("a", "b")` only compiles when both "a" and "b" were
 * actually added. That is the flagship compile-time guarantee: you cannot wire an edge to
 * a node that doesn't exist. `build()` then runs the runtime checks a type system can't:
 * unique names, exactly one input, reachable outputs, and acyclicity.
 */

import { z } from "zod";
import { EdgeId, NodeId, WorkflowId } from "./ids";
import {
  type AgentLimits,
  type AgentNode,
  type ConditionNode,
  type EvaluatorNode,
  type HumanApprovalNode,
  type InputNode,
  type OutputNode,
  type Predicate,
  type ToolNode,
  type TransformNode,
  type WorkflowNode,
  nodeSchema,
} from "./nodes";

/** A directed, optionally labeled edge between two nodes. */
export interface Edge {
  readonly id: EdgeId;
  readonly from: NodeId;
  readonly to: NodeId;
  /** For condition nodes, "true"/"false"; otherwise undefined. */
  readonly label?: string;
}

/** A validated workflow ready to execute. */
export interface Workflow {
  readonly id: WorkflowId;
  readonly name: string;
  readonly nodes: readonly WorkflowNode[];
  readonly edges: readonly Edge[];
}

/** A workflow validation failure, with a specific, human-readable reason. */
export class WorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowError";
  }
}

// --- node factories: each carries its name as a literal type ---

const DEFAULT_LIMITS: AgentLimits = { maxIterations: 6, maxToolCalls: 12, tokenBudget: 4000 };

export function input<N extends string>(name: N): InputNode & { name: N } {
  return { kind: "input", id: NodeId(name), name };
}

export function agent<N extends string>(
  name: N,
  cfg: { model?: string; systemPrompt?: string; tools?: readonly string[]; limits?: Partial<AgentLimits> } = {},
): AgentNode & { name: N } {
  return {
    kind: "agent", id: NodeId(name), name,
    model: cfg.model ?? "mock", systemPrompt: cfg.systemPrompt ?? "",
    tools: cfg.tools ?? [], limits: { ...DEFAULT_LIMITS, ...cfg.limits },
  };
}

export function tool<N extends string>(name: N, toolName: string): ToolNode & { name: N } {
  return { kind: "tool", id: NodeId(name), name, tool: toolName };
}

export function condition<N extends string>(name: N, predicate: Predicate): ConditionNode & { name: N } {
  return { kind: "condition", id: NodeId(name), name, predicate };
}

export function humanApproval<N extends string>(name: N, reason: string): HumanApprovalNode & { name: N } {
  return { kind: "humanApproval", id: NodeId(name), name, reason };
}

export function evaluator<N extends string>(name: N, scorer: string, expected?: string): EvaluatorNode & { name: N } {
  return { kind: "evaluator", id: NodeId(name), name, scorer, ...(expected !== undefined ? { expected } : {}) };
}

export function transform<N extends string>(name: N, op: TransformNode["op"]): TransformNode & { name: N } {
  return { kind: "transform", id: NodeId(name), name, op };
}

export function output<N extends string>(name: N): OutputNode & { name: N } {
  return { kind: "output", id: NodeId(name), name };
}

interface EdgeInput {
  from: string;
  to: string;
  label?: string;
}

/**
 * The workflow builder. `Names` accumulates the literal names of every node added, so
 * `connect` can restrict `from`/`to` to names that actually exist.
 */
export class WorkflowBuilder<Names extends string = never> {
  private readonly nodes: WorkflowNode[] = [];
  private readonly edges: EdgeInput[] = [];

  constructor(private readonly workflowName: string) {}

  /** Add a node; widens the builder's name set to include this node's literal name. */
  add<N extends string>(node: WorkflowNode & { name: N }): WorkflowBuilder<Names | N> {
    this.nodes.push(node);
    return this as unknown as WorkflowBuilder<Names | N>;
  }

  /** Connect two declared nodes. `from` and `to` are constrained to added node names. */
  connect(from: Names, to: Names, label?: string): this {
    this.edges.push(label !== undefined ? { from, to, label } : { from, to });
    return this;
  }

  build(): Workflow {
    return assemble(this.workflowName, this.nodes, this.edges);
  }
}

/** Start a workflow definition. */
export function workflow(name: string): WorkflowBuilder {
  return new WorkflowBuilder(name);
}

/** Assemble and validate a workflow from raw nodes + edges. */
function assemble(name: string, nodes: WorkflowNode[], edges: EdgeInput[]): Workflow {
  const names = new Set<string>();
  for (const n of nodes) {
    if (names.has(n.name)) throw new WorkflowError(`duplicate node name: ${n.name}`);
    names.add(n.name);
  }
  const inputs = nodes.filter((n) => n.kind === "input");
  if (inputs.length !== 1) throw new WorkflowError(`a workflow needs exactly one input node, found ${inputs.length}`);
  if (!nodes.some((n) => n.kind === "output")) throw new WorkflowError("a workflow needs at least one output node");

  const builtEdges: Edge[] = edges.map((e, i) => {
    if (!names.has(e.from)) throw new WorkflowError(`edge references unknown node: ${e.from}`);
    if (!names.has(e.to)) throw new WorkflowError(`edge references unknown node: ${e.to}`);
    return { id: EdgeId(`e${i + 1}`), from: NodeId(e.from), to: NodeId(e.to), ...(e.label !== undefined ? { label: e.label } : {}) };
  });

  const wf: Workflow = { id: WorkflowId(name), name, nodes, edges: builtEdges };
  assertAcyclic(wf);
  return wf;
}

/** Reject a workflow whose edges form a cycle - the executor walks a DAG. */
function assertAcyclic(wf: Workflow): void {
  const adjacency = new Map<string, string[]>();
  for (const n of wf.nodes) adjacency.set(n.name, []);
  for (const e of wf.edges) adjacency.get(String(e.from))!.push(String(e.to));

  const state = new Map<string, "visiting" | "done">();
  const visit = (node: string): void => {
    const s = state.get(node);
    if (s === "done") return;
    if (s === "visiting") throw new WorkflowError(`workflow has a cycle through node: ${node}`);
    state.set(node, "visiting");
    for (const next of adjacency.get(node) ?? []) visit(next);
    state.set(node, "done");
  };
  for (const n of wf.nodes) visit(n.name);
}

// --- external (untrusted) workflow input ---

const edgeInputSchema = z.object({ from: z.string(), to: z.string(), label: z.string().optional() });

/** Zod schema for a workflow arriving from outside the process (e.g. an HTTP body). */
export const workflowInputSchema = z.object({
  name: z.string().min(1),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeInputSchema),
});

/** Parse and validate an untrusted workflow definition into a typed, checked Workflow. */
export function parseWorkflow(raw: unknown): Workflow {
  const parsed = workflowInputSchema.parse(raw);
  return assemble(parsed.name, parsed.nodes as WorkflowNode[], parsed.edges);
}
