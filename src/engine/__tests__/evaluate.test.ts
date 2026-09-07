import { describe, expect, it } from "vitest";
import { compare, evaluate, formatComparison, type EvalCase } from "../evaluate";
import { MockLLM } from "../llm";
import { researchWorkflow } from "../examples";

function detClock() {
  let t = 0;
  return () => (t += 10);
}

const cases: EvalCase[] = [
  { name: "raft", input: "what is raft", expectContains: "answer", expectTool: "web_search" },
  { name: "generics", input: "typescript generics", expectContains: "answer", expectTool: "web_search" },
  { name: "consensus", input: "distributed consensus", expectContains: "answer" },
];

describe("evaluation", () => {
  it("scores a candidate from real runs", async () => {
    const report = await evaluate(cases, {
      name: "researcher",
      workflow: researchWorkflow(),
      options: { llm: new MockLLM(), clock: detClock() },
    });
    expect(report.cases).toBe(3);
    expect(report.correctness).toBe(1);
    expect(report.toolAccuracy).toBe(1);
    expect(report.unsafeActions).toBe(0);
    expect(report.avgTokens).toBeGreaterThan(0);
  });

  it("compares two candidates and renders a table", async () => {
    const reports = await compare(cases, [
      { name: "A", workflow: researchWorkflow(), options: { llm: new MockLLM(), clock: detClock() } },
      { name: "B", workflow: researchWorkflow(), options: { llm: new MockLLM(), clock: detClock() } },
    ]);
    expect(reports).toHaveLength(2);
    const table = formatComparison(reports);
    expect(table).toContain("Correctness");
    expect(table).toContain("Unsafe actions");
  });
});
