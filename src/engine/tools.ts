/**
 * The type-safe tool registry. A tool declares a Zod input schema, a permission level, and
 * a typed handler; the registry validates arguments at the boundary before the handler
 * runs, so a tool can trust its input. Permission levels feed the policy layer - a
 * "dangerous" tool never runs without explicit approval, no matter what the model asks.
 */

import { z } from "zod";

/** How risky a tool is. Drives the policy gate. */
export type Permission = "read" | "write" | "dangerous";

/** A tool: a validated, permissioned, typed capability the agent may use. */
export interface Tool<I = unknown, O = unknown> {
  readonly name: string;
  readonly description: string;
  readonly permission: Permission;
  readonly input: z.ZodType<I>;
  readonly run: (input: I) => Promise<O> | O;
}

/** Helper to define a tool while preserving its input/output types. */
export function defineTool<I, O>(t: Tool<I, O>): Tool<I, O> {
  return t;
}

/** A registry of tools, keyed by name. */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): this {
    this.tools.set(tool.name, tool as Tool);
    return this;
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  /** Validate args against the tool's schema and invoke it. Throws on unknown tool or
   * invalid args - the deterministic boundary the LLM's request must pass. */
  async invoke(name: string, args: unknown): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`unknown tool: ${name}`);
    const parsed = tool.input.parse(args);
    return tool.run(parsed);
  }
}

// --- the default tool set (deterministic mocks; no network) ---

/** Build a registry with the built-in demo tools. */
export function defaultTools(): ToolRegistry {
  const reg = new ToolRegistry();

  reg.register(
    defineTool({
      name: "web_search",
      description: "Search the web for a query (returns fixed demo results).",
      permission: "read",
      input: z.object({ query: z.string() }),
      run: ({ query }) => `results for "${query}": [1] overview [2] details [3] examples`,
    }) as Tool,
  );

  reg.register(
    defineTool({
      name: "calculator",
      description: "Evaluate a simple a<op>b arithmetic expression.",
      permission: "read",
      input: z.object({ a: z.number(), b: z.number(), op: z.enum(["+", "-", "*", "/"]) }),
      run: ({ a, b, op }) => {
        switch (op) {
          case "+": return a + b;
          case "-": return a - b;
          case "*": return a * b;
          case "/": return b === 0 ? "error: divide by zero" : a / b;
        }
      },
    }) as Tool,
  );

  reg.register(
    defineTool({
      name: "echo",
      description: "Return the input text unchanged.",
      permission: "read",
      input: z.object({ text: z.string() }),
      run: ({ text }) => text,
    }) as Tool,
  );

  // A deliberately dangerous tool. It exists so the policy layer can be shown refusing it;
  // it must never run without explicit human approval (see the security tests).
  reg.register(
    defineTool({
      name: "delete_database",
      description: "Irreversibly delete a database. DANGEROUS.",
      permission: "dangerous",
      input: z.object({ name: z.string() }),
      run: ({ name }) => `deleted database ${name}`,
    }) as Tool,
  );

  return reg;
}
