# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-09-07

First public release.

### Added
- Typed workflow DSL with compile-time edge safety (`workflow.ts`) — a builder whose type
  parameter widens as nodes are added, so `.connect()` only accepts declared node names.
- Discriminated-union node model (input/agent/tool/condition/humanApproval/evaluator/
  transform/output) with a Zod schema and exhaustiveness checking.
- Event-sourced execution engine (`executor.ts`) with a bounded reason/act agent loop
  (max iterations, max tool calls, token budget).
- Deterministic policy gate (`policy.ts`): deny-by-default tools, dangerous tools blocked
  without explicit approval.
- Append-only event log with time-travel replay (`replay.ts`).
- Scored evaluation harness and `pnpm eval` CLI producing real, reproducible metrics.
- 26 Vitest tests across the DSL, executor, replay, evaluation, tools, and an adversarial
  security suite.
- Next.js UI with a React Flow canvas and a server-side `/api/run` route (mock LLM, no
  secrets).
- Docker + docker-compose, GitHub Actions CI (lint / typecheck / test / build), and full
  docs (README, ARCHITECTURE, SECURITY, CONTRIBUTING).

[0.1.0]: https://github.com/parag-labs/agent-canvas/releases/tag/v0.1.0
