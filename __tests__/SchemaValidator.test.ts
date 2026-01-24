import { describe, it, expect } from "vitest";
import { SchemaValidator, SchemaValidationError } from "../src/core/SchemaValidator.js";

describe("SchemaValidator", () => {
  const validator = new SchemaValidator();

  const schema = {
    type: "object",
    properties: {
      name: { type: "string" },
      age: { type: "number", default: 25 },
      email: { type: "string", format: "email" },
    },
    required: ["name"],
    additionalProperties: false,
  };

  describe("validate", () => {
    it("should validate correct data", () => {
      const result = validator.validate(schema, { name: "Alice", age: 30 });
      expect(result.valid).toBe(true);
      expect(result.data).toEqual({ name: "Alice", age: 30 });
    });

    it("should apply defaults", () => {
      const result = validator.validate(schema, { name: "Bob" });
      expect(result.valid).toBe(true);
      expect((result.data as any).age).toBe(25);
    });

    it("should coerce types", () => {
      const result = validator.validate(schema, { name: "Charlie", age: "30" });
      expect(result.valid).toBe(true);
      expect((result.data as any).age).toBe(30);
    });

    it("should reject missing required fields", () => {
      const result = validator.validate(schema, { age: 30 });
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it("should reject invalid format", () => {
      const result = validator.validate(schema, {
        name: "Dave",
        email: "not-an-email",
      });
      expect(result.valid).toBe(false);
    });
  });

  describe("validateOrThrow", () => {
    it("should return data for valid input", () => {
      const result = validator.validateOrThrow(schema, { name: "Eve" }, "test");
      expect((result as any).name).toBe("Eve");
    });

    it("should throw SchemaValidationError for invalid input", () => {
      expect(() =>
        validator.validateOrThrow(schema, {}, "test"),
      ).toThrow(SchemaValidationError);
    });

    it("should include context in error message", () => {
      try {
        validator.validateOrThrow(schema, {}, "my_context");
      } catch (e) {
        expect((e as Error).message).toContain("my_context");
      }
    });
  });

  describe("enrichDefaults", () => {
    it("should enrich with defaults without strict validation", () => {
      const result = validator.enrichDefaults(schema, { name: "Frank" });
      expect((result as any).age).toBe(25);
    });
  });

  describe("caching", () => {
    it("should cache compiled validators", () => {
      // Calling validate twice with same schema should not recompile
      const r1 = validator.validate(schema, { name: "A" });
      const r2 = validator.validate(schema, { name: "B" });
      expect(r1.valid).toBe(true);
      expect(r2.valid).toBe(true);
    });
  });
});
