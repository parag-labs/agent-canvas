/**
 * Time-travel debugging. Because a run is fully described by its event log, we can
 * reconstruct the run at any sequence number by folding the events up to it, and we can
 * render the run as a list of steps to scrub through. "Replay from step N" is exact
 * because the engine is deterministic: the same workflow and input always produce the same
 * events.
 */

import type { LoggedEvent } from "./events";
import { execute, type RunOptions, type RunResult } from "./executor";
import type { Workflow } from "./workflow";

/** One node's step in the run timeline. */
export interface Step {
  readonly startedSeq: number;
  readonly node: string;
  readonly kind: string;
  readonly status: "completed" | "failed" | "running";
  readonly value?: unknown;
  readonly score?: number;
}

/** Turn an event log into an ordered list of node steps (the timeline UI). */
export function stepsFromEvents(events: readonly LoggedEvent[]): Step[] {
  const steps: Step[] = [];
  let open: { startedSeq: number; node: string; kind: string } | undefined;

  for (const e of events) {
    if (e.type === "NodeStarted") {
      if (open) steps.push({ ...open, status: "running" });
      open = { startedSeq: e.seq, node: String(e.node), kind: e.kind };
    } else if (e.type === "NodeCompleted" && open) {
      steps.push({ ...open, status: "completed", value: e.value, ...(e.score !== undefined ? { score: e.score } : {}) });
      open = undefined;
    } else if (e.type === "WorkflowFailed" && open) {
      steps.push({ ...open, status: "failed" });
      open = undefined;
    }
  }
  if (open) steps.push({ ...open, status: "running" });
  return steps;
}

/** A folded snapshot of run state at a point in time. */
export interface Snapshot {
  readonly seq: number;
  readonly completedNodes: readonly string[];
  readonly lastValue: unknown;
  readonly tokens: number;
  readonly toolCalls: number;
  readonly awaitingApproval: string | undefined;
}

/** Reconstruct run state as of a sequence number by folding the events up to it. */
export function reconstructAt(events: readonly LoggedEvent[], seq: number): Snapshot {
  const completedNodes: string[] = [];
  let lastValue: unknown;
  let tokens = 0;
  let toolCalls = 0;
  let awaitingApproval: string | undefined;

  for (const e of events) {
    if (e.seq > seq) break;
    switch (e.type) {
      case "NodeCompleted":
        completedNodes.push(String(e.node));
        lastValue = e.value;
        break;
      case "ModelResponse":
        tokens += e.tokens;
        break;
      case "ToolRequested":
        toolCalls += 1;
        break;
      case "ApprovalRequested":
        awaitingApproval = String(e.node);
        break;
      case "ApprovalDecided":
        awaitingApproval = undefined;
        break;
      default:
        break;
    }
  }
  return { seq, completedNodes, lastValue, tokens, toolCalls, awaitingApproval };
}

/**
 * Replay a run deterministically. Given the same workflow, input, and options, this
 * produces an identical event log - which is what "replay from step N" and reproducible
 * debugging rely on.
 */
export async function replay(workflow: Workflow, input: unknown, opts: RunOptions): Promise<RunResult> {
  return execute(workflow, input, opts);
}
