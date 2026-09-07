/**
 * The typed event model. A run is a sequence of events, and every meaningful thing that
 * happens emits one. Because the run is fully described by its events, we get replay and
 * time-travel debugging for free: to reconstruct any point in a run, fold its events up to
 * that sequence number. The union is discriminated on `type` for exhaustive handling.
 */

import type { NodeId, RunId, WorkflowId } from "./ids";

/** A tool call the agent requested, and how it was resolved. */
export interface ToolCallRecord {
  readonly tool: string;
  readonly args: unknown;
}

/** The domain events a workflow run emits. */
export type WorkflowEvent =
  | { readonly type: "WorkflowStarted"; readonly workflowId: WorkflowId; readonly input: unknown }
  | { readonly type: "NodeStarted"; readonly node: NodeId; readonly kind: string }
  | { readonly type: "ModelResponse"; readonly node: NodeId; readonly text: string; readonly tokens: number }
  | { readonly type: "ToolRequested"; readonly node: NodeId; readonly tool: string; readonly args: unknown }
  | { readonly type: "ToolCompleted"; readonly node: NodeId; readonly tool: string; readonly ok: boolean; readonly result: unknown }
  | { readonly type: "ToolRejected"; readonly node: NodeId; readonly tool: string; readonly reason: string }
  | { readonly type: "ApprovalRequested"; readonly node: NodeId; readonly reason: string }
  | { readonly type: "ApprovalDecided"; readonly node: NodeId; readonly approved: boolean }
  | { readonly type: "NodeCompleted"; readonly node: NodeId; readonly value: unknown; readonly score?: number }
  | { readonly type: "WorkflowCompleted"; readonly output: unknown }
  | { readonly type: "WorkflowFailed"; readonly error: string };

/** Every event type name (a template-literal-derived union). */
export type WorkflowEventType = WorkflowEvent["type"];

/** An event as stored: the domain event plus its position and timestamp. */
export type LoggedEvent = WorkflowEvent & { readonly seq: number; readonly ts: number };

/**
 * An append-only event log. The clock is injectable so runs are deterministic in tests
 * (a fixed clock yields identical timestamps every run).
 */
export class EventLog {
  private readonly events: LoggedEvent[] = [];
  private seq = 0;

  constructor(
    readonly runId: RunId,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /** Append a domain event and return the logged form. */
  append(event: WorkflowEvent): LoggedEvent {
    const logged = { ...event, seq: ++this.seq, ts: this.clock() } as LoggedEvent;
    this.events.push(logged);
    return logged;
  }

  /** All events, in order. */
  all(): readonly LoggedEvent[] {
    return this.events;
  }

  /** Events up to and including a sequence number - the basis for time-travel. */
  upTo(seq: number): readonly LoggedEvent[] {
    return this.events.filter((e) => e.seq <= seq);
  }

  /** Count of events of a given type. */
  countOf(type: WorkflowEventType): number {
    return this.events.filter((e) => e.type === type).length;
  }
}
