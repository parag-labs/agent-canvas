import { describe, expect, it } from "vitest";
import { defaultTools, defineTool, ToolRegistry } from "../tools";
import { z } from "zod";

describe("tool registry", () => {
  it("validates arguments against the tool's schema", async () => {
    const reg = defaultTools();
    // Valid args run.
    await expect(reg.invoke("calculator", { a: 2, b: 3, op: "+" })).resolves.toBe(5);
    // Invalid args are rejected at the boundary.
    await expect(reg.invoke("calculator", { a: "two", b: 3, op: "+" })).rejects.toThrow();
  });

  it("throws for an unknown tool", async () => {
    const reg = new ToolRegistry();
    await expect(reg.invoke("ghost", {})).rejects.toThrow(/unknown tool/);
  });

  it("preserves declared permissions", () => {
    const reg = defaultTools();
    expect(reg.get("web_search")!.permission).toBe("read");
    expect(reg.get("delete_database")!.permission).toBe("dangerous");
  });

  it("defineTool keeps input/output types", async () => {
    const t = defineTool({
      name: "double",
      description: "double a number",
      permission: "read",
      input: z.object({ n: z.number() }),
      run: ({ n }) => n * 2,
    });
    expect(await t.run({ n: 21 })).toBe(42);
  });
});
