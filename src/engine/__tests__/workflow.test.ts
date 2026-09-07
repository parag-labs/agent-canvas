import { describe, expect, it } from "vitest";
import {
  agent,
  input,
  output,
  parseWorkflow,
  workflow,
  WorkflowError,
} from "../workflow";

describe("workflow DSL", () => {
  it("builds a valid linear workflow", () => {
    const wf = workflow("W")
      .add(input("start"))
      .add(agent("a", { tools: ["web_search"] }))
      .add(output("end"))
      .connect("start", "a")
      .connect("a", "end")
      .build();
    expect(wf.nodes).toHaveLength(3);
    expect(wf.edges).toHaveLength(2);
  });

  it("rejects duplicate node names", () => {
    expect(() =>
      workflow("W").add(input("x")).add(output("x")).build(),
    ).toThrow(WorkflowError);
  });

  it("requires exactly one input node", () => {
    expect(() => workflow("W").add(output("end")).build()).toThrow(/exactly one input/);
  });

  it("requires at least one output node", () => {
    expect(() => workflow("W").add(input("start")).build()).toThrow(/at least one output/);
  });

  it("rejects a cycle", () => {
    // Build edges that form a cycle via parseWorkflow (the builder's compile-time edge
    // typing would normally prevent unknown names, but a cycle is a runtime property).
    expect(() =>
      parseWorkflow({
        name: "cyclic",
        nodes: [
          { kind: "input", id: "start", name: "start" },
          { kind: "transform", id: "t", name: "t", op: "uppercase" },
          { kind: "output", id: "end", name: "end" },
        ],
        edges: [
          { from: "start", to: "t" },
          { from: "t", to: "start" },
          { from: "t", to: "end" },
        ],
      }),
    ).toThrow(/cycle/);
  });

  it("rejects an edge to an unknown node", () => {
    expect(() =>
      parseWorkflow({
        name: "bad",
        nodes: [
          { kind: "input", id: "start", name: "start" },
          { kind: "output", id: "end", name: "end" },
        ],
        edges: [{ from: "start", to: "ghost" }],
      }),
    ).toThrow(/unknown node/);
  });

  it("validates untrusted input with Zod (rejects a bad node)", () => {
    expect(() =>
      parseWorkflow({
        name: "bad",
        nodes: [{ kind: "input", id: "s", name: "s" }, { kind: "nope", id: "x", name: "x" }],
        edges: [],
      }),
    ).toThrow();
  });
});
