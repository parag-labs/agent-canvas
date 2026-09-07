/**
 * POST /api/run - execute a workflow and return its result and event log.
 *
 * The request names one of the built-in example workflows and provides an input; the
 * engine runs it server-side with the deterministic mock model (no API key). The workflow
 * is never taken as arbitrary client code - only a known example id is accepted - and the
 * body is validated with Zod at the boundary.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { execute, MockLLM, researchWorkflow, triageWorkflow, overPermissionedWorkflow } from "@/engine";
import type { Workflow } from "@/engine";

const bodySchema = z.object({
  example: z.enum(["research", "triage", "overPermissioned"]),
  input: z.string().min(1).max(2000),
  approveDangerous: z.boolean().optional(),
});

const examples: Record<z.infer<typeof bodySchema>["example"], () => Workflow> = {
  research: researchWorkflow,
  triage: triageWorkflow,
  overPermissioned: overPermissionedWorkflow,
};

export async function POST(req: Request): Promise<Response> {
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const workflow = examples[parsed.example]();
  const result = await execute(workflow, parsed.input, {
    llm: new MockLLM(),
    ...(parsed.approveDangerous ? { approve: (r) => r.kind === "tool" } : {}),
  });

  return NextResponse.json({
    runId: result.runId,
    status: result.status,
    output: result.output,
    metrics: result.metrics,
    events: result.events,
  });
}
