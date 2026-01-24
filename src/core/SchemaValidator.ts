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
    const key = JSON.stringify(schema);
    let cached = this.cache.get(key);
    if (!cached) {
      cached = this.ajv.compile(schema);
      this.cache.set(key, cached);
    }
    return cached;
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
