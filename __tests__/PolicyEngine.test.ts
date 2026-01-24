import { describe, it, expect } from "vitest";
import { PolicyEngine, PolicyDeniedError } from "../src/core/PolicyEngine.js";
import {
  calcToolSpec,
  fileWriteToolSpec,
  destructiveToolSpec,
  defaultCtx,
  fullPermCtx,
} from "./fixtures/index.js";

describe("PolicyEngine", () => {
  describe("capability gate", () => {
    it("should allow when permissions cover capabilities", () => {
      const engine = new PolicyEngine();
      expect(() =>
        engine.enforce(calcToolSpec, {}, defaultCtx),
      ).not.toThrow();
    });

    it("should deny when missing required capabilities", () => {
      const engine = new PolicyEngine();
      expect(() =>
        engine.enforce(fileWriteToolSpec, { path: "/tmp/x", content: "" }, {
          ...defaultCtx,
          permissions: ["read:web"],
        }),
      ).toThrow(PolicyDeniedError);
    });

    it("should deny destructive without explicit permission", () => {
      const engine = new PolicyEngine();
      expect(() =>
        engine.enforce(destructiveToolSpec, { table: "users" }, {
          ...defaultCtx,
          permissions: ["write:db"],
        }),
      ).toThrow(PolicyDeniedError);
    });

    it("should allow destructive with explicit permission", () => {
      const engine = new PolicyEngine();
      expect(() =>
        engine.enforce(destructiveToolSpec, { table: "users" }, fullPermCtx),
      ).not.toThrow();
    });
  });

  describe("path sandboxing", () => {
    it("should deny path traversal", () => {
      const engine = new PolicyEngine({
        sandboxPaths: ["/safe/dir"],
      });

      const result = engine.check(
        fileWriteToolSpec,
        { path: "/safe/dir/../etc/passwd", content: "" },
        fullPermCtx,
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("traversal");
    });

    it("should deny paths outside sandbox", () => {
      const engine = new PolicyEngine({
        sandboxPaths: ["/safe/dir"],
      });

      const result = engine.check(
        fileWriteToolSpec,
        { path: "/other/dir/file.txt", content: "" },
        fullPermCtx,
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("outside sandbox");
    });

    it("should allow paths inside sandbox", () => {
      const engine = new PolicyEngine({
        sandboxPaths: ["/safe/dir"],
      });

      const result = engine.check(
        fileWriteToolSpec,
        { path: "/safe/dir/file.txt", content: "" },
        fullPermCtx,
      );

      expect(result.allowed).toBe(true);
    });
  });

  describe("URL restrictions", () => {
    const networkToolSpec = {
      ...calcToolSpec,
      capabilities: ["network" as const],
    };

    it("should deny URLs in denylist", () => {
      const engine = new PolicyEngine({
        urlDenylist: ["evil\\.com"],
      });

      const result = engine.check(
        networkToolSpec,
        { url: "https://evil.com/api" },
        fullPermCtx,
      );

      expect(result.allowed).toBe(false);
    });

    it("should deny URLs not in allowlist", () => {
      const engine = new PolicyEngine({
        urlAllowlist: ["api\\.example\\.com"],
      });

      const result = engine.check(
        networkToolSpec,
        { url: "https://other.com/api" },
        fullPermCtx,
      );

      expect(result.allowed).toBe(false);
    });

    it("should allow URLs in allowlist", () => {
      const engine = new PolicyEngine({
        urlAllowlist: ["api\\.example\\.com"],
      });

      const result = engine.check(
        networkToolSpec,
        { url: "https://api.example.com/v1" },
        fullPermCtx,
      );

      expect(result.allowed).toBe(true);
    });
  });

  describe("SQL pattern checks", () => {
    const dbToolSpec = {
      ...calcToolSpec,
      capabilities: ["write:db" as const],
    };

    it("should deny DROP statements", () => {
      const engine = new PolicyEngine();
      const result = engine.check(
        dbToolSpec,
        { sql: "DROP TABLE users" },
        fullPermCtx,
      );

      expect(result.allowed).toBe(false);
    });

    it("should deny TRUNCATE statements", () => {
      const engine = new PolicyEngine();
      const result = engine.check(
        dbToolSpec,
        { query: "TRUNCATE TABLE logs" },
        fullPermCtx,
      );

      expect(result.allowed).toBe(false);
    });

    it("should allow safe SELECT statements", () => {
      const engine = new PolicyEngine();
      const result = engine.check(
        dbToolSpec,
        { sql: "SELECT * FROM users WHERE id = 1" },
        fullPermCtx,
      );

      expect(result.allowed).toBe(true);
    });
  });
});
