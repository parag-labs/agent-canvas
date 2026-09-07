"use client";

import { useMemo, useState } from "react";
import { ReactFlow, Background, Controls, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  researchWorkflow,
  triageWorkflow,
  overPermissionedWorkflow,
  stepsFromEvents,
  type LoggedEvent,
  type RunMetrics,
  type Workflow,
} from "@/engine";

type ExampleId = "research" | "triage" | "overPermissioned";

const builders: Record<ExampleId, () => Workflow> = {
  research: researchWorkflow,
  triage: triageWorkflow,
  overPermissioned: overPermissionedWorkflow,
};

interface RunResponse {
  runId: string;
  status: "completed" | "failed";
  output: unknown;
  metrics: RunMetrics;
  events: LoggedEvent[];
}

function toFlow(wf: Workflow): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = wf.nodes.map((n, i) => ({
    id: String(n.id),
    position: { x: 60, y: i * 90 },
    data: { label: `${n.name} · ${n.kind}` },
    className: "rfnode",
  }));
  const edges: Edge[] = wf.edges.map((e) => ({
    id: String(e.id),
    source: String(e.from),
    target: String(e.to),
    ...(e.label !== undefined ? { label: e.label } : {}),
    animated: true,
  }));
  return { nodes, edges };
}

export function Canvas() {
  const [example, setExample] = useState<ExampleId>("research");
  const [input, setInput] = useState("what is raft consensus");
  const [approveDangerous, setApproveDangerous] = useState(false);
  const [run, setRun] = useState<RunResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<RunResponse[]>([]);

  const flow = useMemo(() => toFlow(builders[example]()), [example]);
  const steps = run ? stepsFromEvents(run.events) : [];

  async function onRun() {
    setBusy(true);
    try {
      const res = (await fetch("/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ example, input, approveDangerous }),
      }).then((r) => r.json())) as RunResponse;
      setRun(res);
      setHistory((h) => [res, ...h].slice(0, 10));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="topbar">
        <h1>AgentCanvas</h1>
        <span className="muted mono">typed workflows · event-sourced runs · time-travel replay</span>
      </div>
      <div className="layout">
        <div className="canvas-pane">
          <ReactFlow nodes={flow.nodes} edges={flow.edges} fitView proOptions={{ hideAttribution: true }}>
            <Background />
            <Controls />
          </ReactFlow>
        </div>

        <div className="inspector">
          <h2>Run</h2>
          <div className="controls">
            <select value={example} onChange={(e) => setExample(e.target.value as ExampleId)}>
              <option value="research">Research (linear)</option>
              <option value="triage">Triage (branching)</option>
              <option value="overPermissioned">Over-permissioned (safety)</option>
            </select>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="input" />
            <button className="run" onClick={onRun} disabled={busy}>
              {busy ? "Running…" : "Run"}
            </button>
          </div>
          <label className="muted mono" style={{ display: "block", marginTop: 8 }}>
            <input
              type="checkbox"
              checked={approveDangerous}
              onChange={(e) => setApproveDangerous(e.target.checked)}
              style={{ width: "auto", marginRight: 6 }}
            />
            approve dangerous tools (human-in-the-loop)
          </label>

          {run && (
            <>
              <h2>Result</h2>
              <div className="output mono">{String(run.output ?? "(none)")}</div>
              <div className="metrics">
                <Metric k="Status" v={run.status} />
                <Metric k="Tool calls" v={String(run.metrics.toolCalls)} />
                <Metric k="Tokens" v={String(run.metrics.tokens)} />
                <Metric k="Cost" v={`$${run.metrics.costUsd.toFixed(4)}`} />
                <Metric k="Latency" v={`${run.metrics.durationMs}ms`} />
                <Metric k="Score" v={run.metrics.score === undefined ? "—" : String(run.metrics.score)} />
              </div>

              <h2>Timeline (replayable)</h2>
              <ul className="timeline">
                {steps.map((s) => (
                  <li className="step" key={s.startedSeq}>
                    <span className={`dot ${s.status}`} />
                    <span className="mono">{s.node}</span>
                    <span className="muted">· {s.kind}</span>
                    {s.score !== undefined && <span className="muted"> · score {s.score}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}

          {history.length > 0 && (
            <>
              <h2>Run history</h2>
              <ul className="timeline">
                {history.map((h) => (
                  <li className="step" key={h.runId}>
                    <span className={`dot ${h.status === "completed" ? "completed" : "failed"}`} />
                    <span className="mono">{h.runId}</span>
                    <span className="muted">· {h.metrics.toolCalls} tools · {h.metrics.durationMs}ms</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Metric({ k, v }: { k: string; v: string }) {
  return (
    <div className="metric">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}
