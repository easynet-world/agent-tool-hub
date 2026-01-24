import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * Calculator tool using LangChain's StructuredTool interface.
 * Evaluates simple arithmetic expressions.
 */
class CalculatorTool extends StructuredTool {
  name = "calculator";
  description = "Evaluates simple arithmetic expressions (add, subtract, multiply, divide)";

  schema = z.object({
    expression: z.string().describe("Math expression to evaluate, e.g. '2 + 3 * 4'"),
  });

  async _call({ expression }) {
    const sanitized = expression.replace(/[^0-9+\-*/().% ]/g, "");
    if (sanitized !== expression) {
      throw new Error("Invalid characters in expression");
    }
    const result = Function(`"use strict"; return (${sanitized})`)();
    return String(result);
  }
}

export default new CalculatorTool();
