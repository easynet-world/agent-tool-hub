/**
 * Example Skill handler: Code Review.
 * Exports a function matching the SkillHandler signature.
 */
async function handler(args, ctx) {
  const { code, language } = args;

  // Example: simple analysis
  const issues = [];
  if (code.length > 500) {
    issues.push("Function is quite long, consider breaking it up");
  }
  if (code.includes("console.log")) {
    issues.push("Remove console.log statements before production");
  }

  return {
    result: {
      language: language || "unknown",
      linesOfCode: code.split("\n").length,
      issues,
      score: issues.length === 0 ? 10 : Math.max(1, 10 - issues.length * 2),
    },
    evidence: [
      {
        type: "text",
        ref: "code-review-output",
        summary: `Reviewed ${code.length} chars of ${language || "unknown"} code, found ${issues.length} issues`,
        createdAt: new Date().toISOString(),
      },
    ],
  };
}

export default handler;
