/**
 * The LLM provider abstraction. The engine depends only on `LLMProvider`, never on a
 * vendor, so the same agent runs against a real model in production and a deterministic
 * mock in CI. The contract keeps model output *structured*: a response is either a tool
 * request or a final answer - never free text the engine has to parse loosely.
 */

/** What the agent knows when it asks the model to act. */
export interface CompletionRequest {
  readonly system: string;
  readonly input: string;
  readonly availableTools: readonly string[];
  readonly history: readonly string[];
}

/** A structured model response: request a tool, or finish with an answer. */
export type LLMResponse =
  | { readonly kind: "tool"; readonly tool: string; readonly args: unknown; readonly tokens: number }
  | { readonly kind: "final"; readonly text: string; readonly tokens: number };

/** A provider-agnostic model. */
export interface LLMProvider {
  readonly name: string;
  complete(req: CompletionRequest): Promise<LLMResponse>;
}

/**
 * A deterministic mock model used in every test and the default demo. Its behaviour is a
 * simple, explainable rule: if the input explicitly names an available tool, request that
 * tool once; otherwise, if a tool is available and hasn't been used yet, use the first
 * one; otherwise, finish with an answer that quotes what it has seen. This makes agent
 * runs reproducible and lets the security tests drive a tool request that the policy layer
 * must then refuse.
 */
export class MockLLM implements LLMProvider {
  readonly name = "mock";

  async complete(req: CompletionRequest): Promise<LLMResponse> {
    const usedTool = req.history.some((h) => h.startsWith("tool:"));

    // If the input mentions a specific available tool, request it (this is how an
    // injected "call delete_database" reaches - and is stopped by - the policy gate).
    const mentioned = req.availableTools.find((t) => req.input.toLowerCase().includes(t.toLowerCase()));
    if (mentioned && !usedTool) {
      return { kind: "tool", tool: mentioned, args: argsFor(mentioned, req.input), tokens: 12 };
    }

    // Otherwise use the first available tool once, then answer.
    if (req.availableTools.length > 0 && !usedTool) {
      const first = req.availableTools[0]!;
      return { kind: "tool", tool: first, args: argsFor(first, req.input), tokens: 12 };
    }

    const lastTool = [...req.history].reverse().find((h) => h.startsWith("tool:"));
    const basis = lastTool ? lastTool.slice("tool:".length) : req.input;
    return { kind: "final", text: `answer: ${basis}`.trim(), tokens: 16 };
  }
}

/** Derive plausible tool args from free-form input (deterministic). */
function argsFor(tool: string, input: string): unknown {
  switch (tool) {
    case "web_search":
      return { query: input };
    case "echo":
      return { text: input };
    case "calculator":
      return { a: 2, b: 2, op: "+" };
    case "delete_database":
      return { name: "prod" };
    default:
      return {};
  }
}

/** A scripted model that returns fixed responses in order - for driving specific agent
 * paths in tests (e.g. a model that insists on a dangerous tool). */
export class ScriptedLLM implements LLMProvider {
  readonly name = "scripted";
  private i = 0;
  constructor(private readonly responses: readonly LLMResponse[]) {}

  async complete(): Promise<LLMResponse> {
    const r = this.responses[Math.min(this.i, this.responses.length - 1)];
    this.i++;
    return r ?? { kind: "final", text: "answer:", tokens: 1 };
  }
}
