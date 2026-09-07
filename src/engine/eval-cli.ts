/**
 * `pnpm eval` - run the evaluation harness and print an A/B comparison table computed from
 * real runs. It compares the research agent (which uses a web-search tool) against a
 * no-tool variant, so the numbers differ and are genuinely measured, never hand-written.
 */

import { compare, formatComparison, type Candidate, type EvalCase } from "./evaluate";
import { MockLLM } from "./llm";
import { researchWorkflow } from "./examples";
import { agent, evaluator, input, output, workflow } from "./workflow";

function detClock(): () => number {
  let t = 0;
  return () => (t += 10);
}

function noToolWorkflow() {
  return workflow("ResearchNoTool")
    .add(input("start"))
    .add(agent("researcher", { systemPrompt: "Answer directly." }))
    .add(evaluator("quality", "nonEmpty"))
    .add(output("done"))
    .connect("start", "researcher")
    .connect("researcher", "quality")
    .connect("quality", "done")
    .build();
}

const cases: EvalCase[] = [
  { name: "raft", input: "what is raft consensus", expectContains: "answer", expectTool: "web_search" },
  { name: "generics", input: "typescript generics", expectContains: "answer", expectTool: "web_search" },
  { name: "consensus", input: "distributed consensus tradeoffs", expectContains: "answer" },
  { name: "vector", input: "vector clocks explained", expectContains: "answer" },
];

async function main(): Promise<void> {
  const candidates: Candidate[] = [
    { name: "with-tool", workflow: researchWorkflow(), options: { llm: new MockLLM(), clock: detClock() } },
    { name: "no-tool", workflow: noToolWorkflow(), options: { llm: new MockLLM(), clock: detClock() } },
  ];
  const reports = await compare(cases, candidates);

  console.log("AgentCanvas Evaluation (metrics from actual runs)\n");
  console.log(formatComparison(reports));

  const unsafe = reports.reduce((n, r) => n + r.unsafeActions, 0);
  if (unsafe > 0) {
    console.error(`\nFAIL: ${unsafe} unsafe action(s) executed`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
