import { describe, expect, it } from "vitest";
import { execute } from "../executor";
import { MockLLM } from "../llm";
import { researchWorkflow, triageWorkflow } from "../examples";

function detClock() {
  let t = 0;
  return () => (t += 10);
}

function opts() {
  return { llm: new MockLLM(), clock: detClock() };
}

describe("execution engine", () => {
  it("runs a linear workflow to completion", async () => {
    const result = await execute(researchWorkflow(), "what is raft consensus", opts());
    expect(result.status).toBe("completed");
    expect(String(result.output)).toContain("answer:");
    expect(result.events[0]!.type).toBe("WorkflowStarted");
    expect(result.events.at(-1)!.type).toBe("WorkflowCompleted");
  });

  it("emits an event for each node and a score from the evaluator", async () => {
    const result = await execute(researchWorkflow(), "hello", opts());
    const started = result.events.filter((e) => e.type === "NodeStarted");
    expect(started.length).toBe(4); // input, agent, evaluator, output
    expect(result.metrics.score).toBe(1); // nonEmpty
    expect(result.metrics.tokens).toBeGreaterThan(0);
    expect(result.metrics.toolCalls).toBeGreaterThan(0);
  });

  it("records a tool call inside the agent loop", async () => {
    const result = await execute(researchWorkflow(), "typescript generics", opts());
    const toolDone = result.events.find((e) => e.type === "ToolCompleted");
    expect(toolDone).toBeDefined();
    expect(toolDone && toolDone.type === "ToolCompleted" && toolDone.tool).toBe("web_search");
  });

  it("routes a condition node down the true branch", async () => {
    const result = await execute(triageWorkflow(), "this is urgent please", opts());
    expect(result.status).toBe("completed");
    // The "urgent" branch runs echo (notify); the output should echo the input.
    expect(String(result.output)).toContain("urgent");
  });

  it("routes a condition node down the false branch", async () => {
    const result = await execute(triageWorkflow(), "just a normal note", opts());
    // The false branch uppercases the input.
    expect(String(result.output)).toBe("JUST A NORMAL NOTE");
  });

  it("bounds the agent loop by its iteration limit", async () => {
    // A model that never finishes would loop forever without the bound.
    const neverFinishes = {
      name: "loopy",
      async complete() {
        return { kind: "tool", tool: "web_search", args: { query: "x" }, tokens: 5 } as const;
      },
    };
    const result = await execute(researchWorkflow(), "x", { llm: neverFinishes, clock: detClock() });
    // maxIterations default is 6, so no more than 6 tool requests from the agent node.
    const requests = result.events.filter((e) => e.type === "ToolRequested");
    expect(requests.length).toBeLessThanOrEqual(6);
    expect(result.status).toBe("completed");
  });
});
