import { describe, it, expect, beforeEach } from "vitest";
import { ToolRegistry } from "../src/registry/ToolRegistry.js";
import { calcToolSpec, fileWriteToolSpec, n8nSlackToolSpec } from "./fixtures/index.js";

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe("register / get", () => {
    it("should register and retrieve a tool", () => {
      registry.register(calcToolSpec);
      const spec = registry.get("test/calculator");
      expect(spec).toEqual(calcToolSpec);
    });

    it("should overwrite on re-register", () => {
      registry.register(calcToolSpec);
      const updated = { ...calcToolSpec, version: "2.0.0" };
      registry.register(updated);
      expect(registry.get("test/calculator")!.version).toBe("2.0.0");
    });

    it("should return undefined for unknown tools", () => {
      expect(registry.get("nonexistent")).toBeUndefined();
    });
  });

  describe("bulkRegister", () => {
    it("should register multiple tools", () => {
      registry.bulkRegister([calcToolSpec, fileWriteToolSpec, n8nSlackToolSpec]);
      expect(registry.size).toBe(3);
    });
  });

  describe("unregister", () => {
    it("should remove a registered tool", () => {
      registry.register(calcToolSpec);
      expect(registry.unregister("test/calculator")).toBe(true);
      expect(registry.get("test/calculator")).toBeUndefined();
    });

    it("should return false for unknown tools", () => {
      expect(registry.unregister("nonexistent")).toBe(false);
    });
  });

  describe("search", () => {
    beforeEach(() => {
      registry.bulkRegister([calcToolSpec, fileWriteToolSpec, n8nSlackToolSpec]);
    });

    it("should search by text in name", () => {
      const results = registry.search({ text: "calculator" });
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe("test/calculator");
    });

    it("should search by text in description", () => {
      const results = registry.search({ text: "Slack" });
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe("workflow/send_slack_message");
    });

    it("should filter by kind", () => {
      const results = registry.search({ kind: "n8n" });
      expect(results.length).toBe(1);
      expect(results[0]!.kind).toBe("n8n");
    });

    it("should filter by tags", () => {
      const results = registry.search({ tags: ["math"] });
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe("test/calculator");
    });

    it("should filter by capabilities", () => {
      const results = registry.search({ capabilities: ["write:fs"] });
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe("test/file_write");
    });

    it("should combine multiple filters", () => {
      const results = registry.search({ kind: "langchain", tags: ["io"] });
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe("test/file_write");
    });

    it("should return empty for no matches", () => {
      const results = registry.search({ text: "nonexistent_xyz" });
      expect(results.length).toBe(0);
    });
  });

  describe("snapshot / list", () => {
    it("should export all tools", () => {
      registry.bulkRegister([calcToolSpec, fileWriteToolSpec]);
      const snapshot = registry.snapshot();
      expect(snapshot.length).toBe(2);
    });

    it("should list all tool names", () => {
      registry.bulkRegister([calcToolSpec, fileWriteToolSpec]);
      const names = registry.list();
      expect(names).toContain("test/calculator");
      expect(names).toContain("test/file_write");
    });
  });

  describe("validation", () => {
    it("should reject spec without name", () => {
      expect(() =>
        registry.register({ ...calcToolSpec, name: "" }),
      ).toThrow("name");
    });

    it("should reject spec without version", () => {
      expect(() =>
        registry.register({ ...calcToolSpec, version: "" }),
      ).toThrow("version");
    });
  });
});
