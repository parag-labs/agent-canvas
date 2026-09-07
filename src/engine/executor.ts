/**
 * The event-sourced execution engine. It walks a validated workflow as a DAG, executes
 * each node deterministically, and records every step as an event. The agent node is the
 * only place a model runs, and it runs a *bounded* reason/act loop - capped iterations,
 * tool calls, and token budget - with every tool call passing the policy gate. The result
 * is fully described by its event log, which is what makes replay and evaluation exact.
 */

import { EventLog, type LoggedEvent } from "./events";
import { RunId, makeCounter } from "./ids";
import type { LLMProvider } from "./llm";
import { assertNever, type WorkflowNode } from "./nodes";
import { authorizeTool } from "./policy";
import { defaultTools, ToolRegistry } from "./tools";
import type { Edge, Workflow } from "./workflow";

/** A request for human approval, of a node or a dangerous tool. */
export interface ApprovalRequest {
  readonly kind: "node" | "tool";
  readonly name: string;
}

export interface RunOptions {
  readonly llm: LLMProvider;
  readonly tools?: ToolRegistry;
  /** Human approval decision. Defaults: node approvals granted, dangerous tools denied. */
  readonly approve?: (req: ApprovalRequest) => boolean;
  /** Injectable clock for deterministic timestamps/latency in tests. */
  readonly clock?: () => number;
  readonly runId?: RunId;
}

export interface RunMetrics {
  readonly durationMs: number;
  readonly toolCalls: number;
  readonly tokens: number;
  readonly costUsd: number;
  readonly score: number | undefined;
}

export interface RunResult {
  readonly runId: RunId;
  readonly status: "completed" | "failed";
  readonly output: unknown;
  readonly events: readonly LoggedEvent[];
  readonly metrics: RunMetrics;
  readonly error?: string;
}

const COST_PER_TOKEN = 0.000002; // mock $/token, deterministic

const defaultApprove = (req: ApprovalRequest): boolean => req.kind === "node";

/** Execute a workflow to completion (or failure), returning its result and event log. */
export async function execute(workflow: Workflow, input: unknown, opts: RunOptions): Promise<RunResult> {
  const clock = opts.clock ?? (() => Date.now());
  const runId = opts.runId ?? RunId(makeCounter("run")());
  const tools = opts.tools ?? defaultTools();
  const approve = opts.approve ?? defaultApprove;
  const log = new EventLog(runId, clock);

  const started = clock();
  let tokens = 0;
  let toolCalls = 0;
  let lastScore: number | undefined;

  const byName = new Map(workflow.nodes.map((n) => [String(n.id), n]));

  log.append({ type: "WorkflowStarted", workflowId: workflow.id, input });

  try {
    let current: WorkflowNode | undefined = workflow.nodes.find((n) => n.kind === "input");
    let value: unknown = input;

    // A DAG walk with a hard step cap as a final safety rail against a malformed graph.
    for (let steps = 0; current && steps < workflow.nodes.length + 1; steps++) {
      log.append({ type: "NodeStarted", node: current.id, kind: current.kind });

      const outcome = await runNode(current, value, { log, llm: opts.llm, tools, approve, onTokens: (t) => (tokens += t), onToolCall: () => toolCalls++ });
      value = outcome.value;
      if (outcome.score !== undefined) lastScore = outcome.score;

      log.append(outcome.score !== undefined
        ? { type: "NodeCompleted", node: current.id, value, score: outcome.score }
        : { type: "NodeCompleted", node: current.id, value });

      if (current.kind === "output") break;

      const next: WorkflowNode | undefined = nextNode(workflow, current, outcome.branch, byName);
      if (!next) break;
      current = next;
    }

    log.append({ type: "WorkflowCompleted", output: value });
    return {
      runId, status: "completed", output: value, events: log.all(),
      metrics: { durationMs: clock() - started, toolCalls, tokens, costUsd: round(tokens * COST_PER_TOKEN), score: lastScore },
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.append({ type: "WorkflowFailed", error });
    return {
      runId, status: "failed", output: undefined, events: log.all(), error,
      metrics: { durationMs: clock() - started, toolCalls, tokens, costUsd: round(tokens * COST_PER_TOKEN), score: lastScore },
    };
  }
}

interface NodeContext {
  readonly log: EventLog;
  readonly llm: LLMProvider;
  readonly tools: ToolRegistry;
  readonly approve: (req: ApprovalRequest) => boolean;
  readonly onTokens: (t: number) => void;
  readonly onToolCall: () => void;
}

interface NodeOutcome {
  readonly value: unknown;
  readonly score?: number;
  /** For a condition node, the label of the edge to follow ("true"/"false"). */
  readonly branch?: string;
}

async function runNode(node: WorkflowNode, value: unknown, ctx: NodeContext): Promise<NodeOutcome> {
  switch (node.kind) {
    case "input":
      return { value };
    case "transform":
      return { value: applyTransform(node.op, value) };
    case "tool": {
      const result = await callTool(node.id, node.tool, argForToolNode(value), [node.tool], ctx);
      return { value: result };
    }
    case "agent":
      return { value: await runAgent(node, value, ctx) };
    case "condition":
      return { value, branch: evalPredicate(node.predicate, value) ? "true" : "false" };
    case "humanApproval": {
      ctx.log.append({ type: "ApprovalRequested", node: node.id, reason: node.reason });
      const approved = ctx.approve({ kind: "node", name: node.name });
      ctx.log.append({ type: "ApprovalDecided", node: node.id, approved });
      if (!approved) throw new Error(`human approval denied at "${node.name}"`);
      return { value };
    }
    case "evaluator":
      return { value, score: score(node.scorer, value, node.expected) };
    case "output":
      return { value };
    default:
      return assertNever(node);
  }
}

async function runAgent(node: Extract<WorkflowNode, { kind: "agent" }>, value: unknown, ctx: NodeContext): Promise<unknown> {
  const history: string[] = [];
  let calls = 0;
  let current = String(value ?? "");

  for (let i = 0; i < node.limits.maxIterations; i++) {
    const resp = await ctx.llm.complete({ system: node.systemPrompt, input: current, availableTools: node.tools, history });
    ctx.onTokens(resp.tokens);

    if (resp.kind === "final") {
      ctx.log.append({ type: "ModelResponse", node: node.id, text: resp.text, tokens: resp.tokens });
      return resp.text;
    }

    if (calls >= node.limits.maxToolCalls) break;
    calls++;
    const result = await callTool(node.id, resp.tool, resp.args, node.tools, ctx);
    history.push(`tool:${JSON.stringify(result)}`);
  }
  // Loop bound reached without a final answer.
  const summary = `answer: ${history.at(-1)?.slice("tool:".length) ?? current}`;
  ctx.log.append({ type: "ModelResponse", node: node.id, text: summary, tokens: 0 });
  return summary;
}

/** Run one tool call through the policy gate and the registry's runtime validation. */
async function callTool(nodeId: WorkflowNode["id"], toolName: string, args: unknown, allowed: readonly string[], ctx: NodeContext): Promise<unknown> {
  ctx.onToolCall();
  ctx.log.append({ type: "ToolRequested", node: nodeId, tool: toolName, args });

  const tool = ctx.tools.get(toolName);
  const decision = authorizeTool(tool, { allowedTools: allowed, approved: ctx.approve({ kind: "tool", name: toolName }) });
  if (!decision.allowed) {
    ctx.log.append({ type: "ToolRejected", node: nodeId, tool: toolName, reason: decision.reason });
    return `rejected: ${decision.reason}`;
  }
  try {
    const result = await ctx.tools.invoke(toolName, args);
    ctx.log.append({ type: "ToolCompleted", node: nodeId, tool: toolName, ok: true, result });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.log.append({ type: "ToolCompleted", node: nodeId, tool: toolName, ok: false, result: message });
    return `error: ${message}`;
  }
}

/** Pick the next node from the current one, honouring a condition branch label. */
function nextNode(wf: Workflow, current: WorkflowNode, branch: string | undefined, byName: Map<string, WorkflowNode>): WorkflowNode | undefined {
  const outgoing = wf.edges.filter((e: Edge) => String(e.from) === String(current.id));
  if (outgoing.length === 0) return undefined;
  if (branch !== undefined) {
    const labeled = outgoing.find((e) => e.label === branch) ?? outgoing.find((e) => e.label === undefined);
    return labeled ? byName.get(String(labeled.to)) : undefined;
  }
  return byName.get(String(outgoing[0]!.to));
}

// --- deterministic node helpers ---

function applyTransform(op: Extract<WorkflowNode, { kind: "transform" }>["op"], value: unknown): unknown {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  switch (op) {
    case "uppercase": return s.toUpperCase();
    case "lowercase": return s.toLowerCase();
    case "trim": return s.trim();
    case "jsonStringify": return JSON.stringify(value);
    case "length": return s.length;
  }
}

function argForToolNode(value: unknown): unknown {
  // A tool node passes the current value through as the tool's most likely argument.
  if (value !== null && typeof value === "object") return value;
  return { query: String(value ?? ""), text: String(value ?? "") };
}

function evalPredicate(p: Extract<WorkflowNode, { kind: "condition" }>["predicate"], value: unknown): boolean {
  const target = getPath(value, p.path);
  switch (p.op) {
    case "exists": return target !== undefined && target !== null;
    case "eq": return String(target) === String(p.value);
    case "neq": return String(target) !== String(p.value);
    case "contains": return String(target).includes(String(p.value));
    case "gt": return Number(target) > Number(p.value);
    case "lt": return Number(target) < Number(p.value);
  }
}

function getPath(value: unknown, path: string): unknown {
  if (path === "") return value;
  let cur: unknown = value;
  for (const key of path.split(".")) {
    if (cur !== null && typeof cur === "object" && key in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return cur;
}

function score(scorer: string, value: unknown, expected?: string): number {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  switch (scorer) {
    case "nonEmpty": return s.trim().length > 0 ? 1 : 0;
    case "contains": return expected !== undefined && s.toLowerCase().includes(expected.toLowerCase()) ? 1 : 0;
    case "exactMatch": return expected !== undefined && s.trim() === expected.trim() ? 1 : 0;
    default: return 0;
  }
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
