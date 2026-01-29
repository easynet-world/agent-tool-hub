import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * Web page access tool using LangChain's StructuredTool interface.
 * Fetches a URL and returns the response as text (for future website access).
 */
class PageAccessTool extends StructuredTool {
  name = "page_access";
  description =
    "Fetch a web page by URL and return its text content. Use for accessing website content.";

  schema = z.object({
    url: z.string().describe("The URL of the web page to fetch"),
    maxLength: z
      .number()
      .optional()
      .default(50000)
      .describe("Maximum characters to return (default 50000)"),
  });

  async _call({ url, maxLength }) {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const text = await response.text();
    const capped =
      maxLength && text.length > maxLength
        ? text.slice(0, maxLength) + "\n...[truncated]"
        : text;

    return capped;
  }
}

export default new PageAccessTool();
