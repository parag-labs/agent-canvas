/**
 * Example workflows built with the DSL. These are used by the tests, the evaluation
 * harness, and the UI demo, so there is one source of truth for what a valid workflow
 * looks like.
 */

import {
  agent,
  condition,
  evaluator,
  input,
  output,
  tool,
  transform,
  workflow,
  type Workflow,
} from "./workflow";

/** A linear research workflow: search the web, then check the answer is non-empty. */
export function researchWorkflow(): Workflow {
  return workflow("Research")
    .add(input("start"))
    .add(agent("researcher", { systemPrompt: "Research the question.", tools: ["web_search"] }))
    .add(evaluator("quality", "nonEmpty"))
    .add(output("done"))
    .connect("start", "researcher")
    .connect("researcher", "quality")
    .connect("quality", "done")
    .build();
}

/** A branching workflow: route on whether the input mentions "urgent". */
export function triageWorkflow(): Workflow {
  return workflow("Triage")
    .add(input("start"))
    .add(condition("isUrgent", { path: "", op: "contains", value: "urgent" }))
    .add(tool("notify", "echo"))
    .add(transform("shout", "uppercase"))
    .add(output("handled"))
    .connect("start", "isUrgent")
    .connect("isUrgent", "notify", "true")
    .connect("isUrgent", "shout", "false")
    .connect("notify", "handled")
    .connect("shout", "handled")
    .build();
}

/**
 * A deliberately over-permissioned workflow: the agent is *allowed* to name a dangerous
 * tool. It exists to prove the policy gate refuses the dangerous action anyway - the
 * security tests drive an injected input at this workflow.
 */
export function overPermissionedWorkflow(): Workflow {
  return workflow("OverPermissioned")
    .add(input("start"))
    .add(agent("worker", { systemPrompt: "Do the task.", tools: ["web_search", "delete_database"] }))
    .add(output("done"))
    .connect("start", "worker")
    .connect("worker", "done")
    .build();
}
