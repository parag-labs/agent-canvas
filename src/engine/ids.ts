/**
 * Branded IDs. A plain `string` for a node id and a `string` for a run id are the same
 * type to the compiler, which makes it easy to pass the wrong one. Branding tags each id
 * with a phantom property so the compiler keeps them distinct while they stay plain
 * strings at runtime.
 */

declare const brand: unique symbol;

/** A nominal wrapper: `T` tagged with a unique brand `B`. */
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type WorkflowId = Brand<string, "WorkflowId">;
export type NodeId = Brand<string, "NodeId">;
export type EdgeId = Brand<string, "EdgeId">;
export type RunId = Brand<string, "RunId">;

export const WorkflowId = (s: string): WorkflowId => s as WorkflowId;
export const NodeId = (s: string): NodeId => s as NodeId;
export const EdgeId = (s: string): EdgeId => s as EdgeId;
export const RunId = (s: string): RunId => s as RunId;

/** Monotonic-ish id helper for runs/events (deterministic when a counter is supplied). */
export function makeCounter(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}
