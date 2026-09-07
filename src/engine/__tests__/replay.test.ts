import { describe, expect, it } from "vitest";
import { execute } from "../executor";
import { MockLLM } from "../llm";
import { researchWorkflow } from "../examples";
import { reconstructAt, replay, stepsFromEvents } from "../replay";

function detClock() {
  let t = 0;
  return () => (t += 10);
}

describe("replay & time-travel", () => {
  it("is deterministic: two runs produce the same event shape", async () => {
    const wf = researchWorkflow();
    const a = await execute(wf, "same input", { llm: new MockLLM(), clock: detClock() });
    const b = await replay(wf, "same input", { llm: new MockLLM(), clock: detClock() });
    expect(a.events.map((e) => e.type)).toEqual(b.events.map((e) => e.type));
    expect(a.output).toEqual(b.output);
  });

  it("renders an ordered step timeline", async () => {
    const result = await execute(researchWorkflow(), "hello", { llm: new MockLLM(), clock: detClock() });
    const steps = stepsFromEvents(result.events);
    expect(steps.map((s) => s.node)).toEqual(["start", "researcher", "quality", "done"]);
    expect(steps.every((s) => s.status === "completed")).toBe(true);
  });

  it("reconstructs run state as of a sequence number", async () => {
    const result = await execute(researchWorkflow(), "hello", { llm: new MockLLM(), clock: detClock() });
    const full = reconstructAt(result.events, result.events.at(-1)!.seq);
    expect(full.completedNodes).toContain("done");

    // Folding only the first few events yields a partial snapshot.
    const early = reconstructAt(result.events, 2);
    expect(early.completedNodes.length).toBeLessThan(full.completedNodes.length);
  });

  it("marks the failing node in the timeline", async () => {
    // A model whose tool args fail validation still completes, but a denied human approval
    // fails the run - use that to produce a failed step.
    const { humanApproval, input, output, workflow } = await import("../workflow");
    const wf = workflow("NeedsApproval")
      .add(input("start"))
      .add(humanApproval("gate", "confirm"))
      .add(output("end"))
      .connect("start", "gate")
      .connect("gate", "end")
      .build();
    const result = await execute(wf, "x", { llm: new MockLLM(), clock: detClock(), approve: () => false });
    expect(result.status).toBe("failed");
    const steps = stepsFromEvents(result.events);
    expect(steps.some((s) => s.status === "failed")).toBe(true);
  });
});
