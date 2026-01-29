import Ajv, { type ValidateFunction, type ErrorObject } from "ajv";
import addFormats from "ajv-formats";

/**
 * Schema validation result.
 */
export interface ValidationResult {
  valid: boolean;
  errors?: ErrorObject[];
  data?: unknown;
}

/**
 * AJV-based JSON Schema validator with coercion and default enrichment.
 */
export class SchemaValidator {
  private readonly ajv: Ajv;
  private readonly cache = new Map<string, ValidateFunction>();

  constructor() {
    this.ajv = new Ajv({
      allErrors: true,
      coerceTypes: true,
      useDefaults: true,
      removeAdditional: "failing",
      strict: false,
    });
    addFormats(this.ajv);
  }

  /**
   * Validate data against a JSON Schema.
   * Coerces types and applies defaults in-place.
   */
  validate(schema: object, data: unknown): ValidationResult {
    const validate = this.getOrCompile(schema);
    const cloned = structuredClone(data);
    const valid = validate(cloned) as boolean;

    if (valid) {
      return { valid: true, data: cloned };
    }

    return {
      valid: false,
      errors: validate.errors ?? undefined,
    };
  }

  /**
   * Validate and return coerced data, or throw a descriptive error.
   */
  validateOrThrow(schema: object, data: unknown, context: string): unknown {
    const result = this.validate(schema, data);
    if (!result.valid) {
      const messages = (result.errors ?? [])
        .map((e) => `${e.instancePath || "/"} ${e.message}`)
        .join("; ");
      throw new SchemaValidationError(
        `${context}: ${messages}`,
        result.errors ?? [],
      );
    }
    return result.data;
  }

  /**
   * Apply default values from schema to data without full validation.
   */
  enrichDefaults(schema: object, data: unknown): unknown {
    const validate = this.getOrCompile(schema);
    const cloned = structuredClone(data);
    validate(cloned);
    return cloned;
  }

  private getOrCompile(schema: object): ValidateFunction {
    const normalized = this.normalizeSchema(schema);
    const key = JSON.stringify(normalized);
    let cached = this.cache.get(key);
    if (!cached) {
      cached = this.ajv.compile(normalized);
      this.cache.set(key, cached);
    }
    return cached;
  }

  /** Ensure schema is AJV-compatible (required = string[], nullable handled via type). */
  private normalizeSchema(schema: object): object {
    return this.normalizeSchemaRec(schema as Record<string, unknown>) as object;
  }

  private normalizeSchemaRec(s: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(s)) {
      if (key === "required") {
        const raw = value;
        out.required = Array.isArray(raw)
          ? raw.filter((x): x is string => typeof x === "string")
          : typeof raw === "string"
            ? [raw]
            : [];
        continue;
      }
      if (key === "nullable") {
        // Skip copying nullable; we'll fix type below if nullable was true
        continue;
      }
      if (key === "properties" && value !== null && typeof value === "object") {
        const props: Record<string, unknown> = {};
        for (const [pk, pv] of Object.entries(value as Record<string, unknown>)) {
          if (pv !== null && typeof pv === "object" && !Array.isArray(pv)) {
            props[pk] = this.normalizeSchemaRec(pv as Record<string, unknown>);
          } else {
            props[pk] = pv;
          }
        }
        out.properties = props;
        continue;
      }
      if (
        (key === "items" || key === "additionalProperties") &&
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
      ) {
        out[key] = this.normalizeSchemaRec(value as Record<string, unknown>);
        continue;
      }
      if (
        (key === "oneOf" || key === "anyOf" || key === "allOf") &&
        Array.isArray(value)
      ) {
        out[key] = value.map((item) =>
          item !== null && typeof item === "object" && !Array.isArray(item)
            ? this.normalizeSchemaRec(item as Record<string, unknown>)
            : item,
        );
        continue;
      }
      out[key] = value;
    }

    // AJV: "nullable" requires "type". Convert nullable to type including "null".
    if (s.nullable === true) {
      const existingType = out.type;
      if (existingType === undefined) {
        out.type = "object";
      } else if (Array.isArray(existingType)) {
        if (!existingType.includes("null")) out.type = [...existingType, "null"];
      } else {
        out.type = [existingType, "null"];
      }
    }
    return out;
  }
}

/**
 * Error thrown on schema validation failure.
 */
export class SchemaValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: ErrorObject[],
  ) {
    super(message);
    this.name = "SchemaValidationError";
  }
}
