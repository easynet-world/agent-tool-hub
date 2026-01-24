import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * Brave Search tool using LangChain's StructuredTool interface.
 * Performs web searches via the Brave Search API.
 */
class BraveSearchTool extends StructuredTool {
  name = "brave_search";
  description = "Search the web using Brave Search API. Returns relevant search results for a given query.";

  schema = z.object({
    query: z.string().describe("The search query"),
    count: z.number().optional().default(5).describe("Number of results to return (max 20)"),
  });

  constructor(fields = {}) {
    super(fields);
    this.apiKey = fields.apiKey ?? process.env.BRAVE_API_KEY;
  }

  async _call({ query, count }) {
    if (!this.apiKey) {
      throw new Error("BRAVE_API_KEY is required");
    }

    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(Math.min(count ?? 5, 20)));

    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Brave Search API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const results = (data.web?.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      description: r.description,
    }));

    return JSON.stringify(results);
  }
}

export default new BraveSearchTool();
