/**
 * Brave Search skill handler.
 */
async function handler(args) {
  const { query, count } = args ?? {};

  if (!query || typeof query !== "string") {
    throw new Error("query is required");
  }

  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) {
    throw new Error("BRAVE_API_KEY is required");
  }

  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(Number(count ?? 5), 20)));

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Brave Search API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const results = (data.web?.results ?? []).map((result) => ({
    title: result.title,
    url: result.url,
    description: result.description,
  }));

  return {
    result: {
      query,
      results,
    },
    evidence: [
      {
        type: "text",
        ref: "brave-search-results",
        summary: `Returned ${results.length} result(s) for \"${query}\"`,
        createdAt: new Date().toISOString(),
      },
    ],
  };
}

export default handler;
