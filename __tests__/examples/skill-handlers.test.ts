import { describe, it, expect, afterEach } from "vitest";
import systemTimeHandler from "../../examples/tools/system-time/skill/handler.js";

describe("skill example handlers", () => {
  afterEach(() => {
    // no globals to clean for system-time
  });

  it("system-time returns iso, epochMs, timezone, formatted (same shape as core now)", async () => {
    const output = await systemTimeHandler({});
    expect(output.result).toHaveProperty("iso");
    expect(output.result).toHaveProperty("epochMs");
    expect(output.result).toHaveProperty("timezone");
    expect(output.result).toHaveProperty("formatted");
    expect(typeof output.result.epochMs).toBe("number");
    expect(new Date(output.result.iso).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(new Date(output.result.iso).getTime()).toBeGreaterThanOrEqual(Date.now() - 1000);
  });

  it("system-time with format locale returns locale formatted string", async () => {
    const output = await systemTimeHandler({ format: "locale" });
    expect(output.result.formatted).toBeDefined();
    expect(output.result.iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
