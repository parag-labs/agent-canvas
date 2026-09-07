/**
 * The evaluation harness. It runs the same set of cases against one or more workflows and
 * reports metrics computed from *actual runs* - correctness, safety (dangerous tools that
 * executed, which must be zero), tool accuracy, latency, and cost. Nothing here is
 * hand-written; every number comes from executing the engine.
 */

import { execute, type RunOptions } from "./executor";
import type { LoggedEvent } from "./events";
import { defaultTools, type ToolRegistry } from "./tools";
import type { Workflow } from "./workflow";

/** One evaluation case: an input and what a correct output should contain. */
export interface EvalCase {
  readonly name: string;
  readonly input: unknown;
  /** Substring the output should contain to be counted correct. */
  readonly expectContains?: string;
  /** A tool the run is expected to use (for tool-selection accuracy). */
  readonly expectTool?: string;
}

/** A workflow under evaluation, with the run options to use. */
export interface Candidate {
  readonly name: string;
  readonly workflow: Workflow;
  readonly options: RunOptions;
}

/** Aggregated metrics for one candidate. */
export interface CandidateReport {
  readonly name: string;
  readonly cases: number;
  readonly correctness: number; // 0..1
  readonly toolAccuracy: number; // 0..1
  readonly unsafeActions: number; // must be 0
  readonly avgLatencyMs: number;
  readonly avgCostUsd: number;
  readonly avgTokens: number;
}

const DANGEROUS = dangerousToolNames(defaultTools());

/** Run every case against a candidate and aggregate the metrics. */
export async function evaluate(cases: readonly EvalCase[], candidate: Candidate): Promise<CandidateReport> {
  let correct = 0;
  let toolCorrect = 0;
  let toolTotal = 0;
  let unsafe = 0;
  let latency = 0;
  let cost = 0;
  let tokens = 0;

  for (const c of cases) {
    const result = await execute(candidate.workflow, c.input, candidate.options);
    const out = typeof result.output === "string" ? result.output : JSON.stringify(result.output ?? "");

    if (c.expectContains === undefined || out.toLowerCase().includes(c.expectContains.toLowerCase())) correct++;

    if (c.expectTool !== undefined) {
      toolTotal++;
      if (usedTool(result.events, c.expectTool)) toolCorrect++;
    }

    unsafe += countUnsafe(result.events);
    latency += result.metrics.durationMs;
    cost += result.metrics.costUsd;
    tokens += result.metrics.tokens;
  }

  const n = cases.length || 1;
  return {
    name: candidate.name,
    cases: cases.length,
    correctness: correct / n,
    toolAccuracy: toolTotal === 0 ? 1 : toolCorrect / toolTotal,
    unsafeActions: unsafe,
    avgLatencyMs: latency / n,
    avgCostUsd: round(cost / n, 6),
    avgTokens: Math.round(tokens / n),
  };
}

/** Evaluate several candidates on the same cases (the A/B comparison table). */
export async function compare(cases: readonly EvalCase[], candidates: readonly Candidate[]): Promise<CandidateReport[]> {
  return Promise.all(candidates.map((c) => evaluate(cases, c)));
}

/** Render a comparison as a fixed-width table. */
export function formatComparison(reports: readonly CandidateReport[]): string {
  const rows = [
    ["Metric", ...reports.map((r) => r.name)],
    ["Correctness", ...reports.map((r) => pct(r.correctness))],
    ["Tool accuracy", ...reports.map((r) => pct(r.toolAccuracy))],
    ["Unsafe actions", ...reports.map((r) => String(r.unsafeActions))],
    ["Avg latency", ...reports.map((r) => `${r.avgLatencyMs.toFixed(0)}ms`)],
    ["Avg cost", ...reports.map((r) => `$${r.avgCostUsd.toFixed(4)}`)],
    ["Avg tokens", ...reports.map((r) => String(r.avgTokens))],
  ];
  const widths = rows[0]!.map((_, col) => Math.max(...rows.map((r) => r[col]!.length)));
  return rows.map((r) => r.map((cell, i) => cell.padEnd(widths[i]!)).join("  ")).join("\n");
}

function usedTool(events: readonly LoggedEvent[], tool: string): boolean {
  return events.some((e) => e.type === "ToolCompleted" && e.tool === tool && e.ok);
}

function countUnsafe(events: readonly LoggedEvent[]): number {
  return events.filter((e) => e.type === "ToolCompleted" && e.ok && DANGEROUS.has(e.tool)).length;
}

function dangerousToolNames(tools: ToolRegistry): Set<string> {
  return new Set(tools.list().filter((t) => t.permission === "dangerous").map((t) => t.name));
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
