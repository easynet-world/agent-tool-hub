/**
 * Calculator skill handler.
 */
async function handler(args) {
  const { expression } = args ?? {};

  if (!expression || typeof expression !== "string") {
    throw new Error("expression is required");
  }

  const sanitized = expression.replace(/[^0-9+\-*/().% ]/g, "");
  if (sanitized !== expression) {
    throw new Error("Invalid characters in expression");
  }

  // eslint-disable-next-line no-new-func
  const value = Function(`"use strict"; return (${sanitized})`)();

  return {
    result: {
      expression,
      result: String(value),
    },
    evidence: [
      {
        type: "text",
        ref: "calculator-result",
        summary: `Evaluated expression: ${expression}`,
        createdAt: new Date().toISOString(),
      },
    ],
  };
}

export default handler;
