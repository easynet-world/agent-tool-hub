import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * Code Review tool using LangChain's StructuredTool interface.
 * Analyzes code for quality issues, style violations, and potential bugs.
 */
class CodeReviewTool extends StructuredTool {
  name = "code_review";
  description = "Reviews code for quality issues, style violations, and potential bugs. Returns a structured review with issues and a quality score.";

  schema = z.object({
    code: z.string().describe("The code to review"),
    language: z.string().optional().describe("Programming language of the code"),
  });

  async _call({ code, language }) {
    const issues = [];

    if (code.length > 500) {
      issues.push("Function is quite long, consider breaking it up");
    }
    if (code.includes("console.log")) {
      issues.push("Remove console.log statements before production");
    }
    if (code.includes("var ")) {
      issues.push("Prefer 'const' or 'let' over 'var'");
    }
    if ((code.match(/\n/g) || []).length > 50) {
      issues.push("File exceeds 50 lines, consider splitting into smaller modules");
    }

    const linesOfCode = code.split("\n").length;
    const score = issues.length === 0 ? 10 : Math.max(1, 10 - issues.length * 2);

    return JSON.stringify({
      language: language || "unknown",
      linesOfCode,
      issues,
      score,
    });
  }
}

export default new CodeReviewTool();
