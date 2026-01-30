/**
 * Yahoo Finance skill — quote program: quoteSummary API only.
 * Exports a class extending StructuredTool; loader instantiates and uses the instance.
 */
import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { fetchQuoteSummary } from "./lib/yahoo-api.js";

class YahooFinanceQuoteTool extends StructuredTool {
  name = "yahoo-finance-quote";
  description =
    "Fetch Yahoo Finance quote summary by symbol. Returns price, previous close, open, day high/low, volume, currency from the quoteSummary API.";
  schema = z.object({
    symbol: z.string().describe("Stock ticker symbol (e.g. AAPL, MSFT, GOOGL)"),
  });

  async _call({ symbol }) {
    if (!symbol || typeof symbol !== "string") {
      return { result: null, error: "Missing or invalid 'symbol' (e.g. AAPL, MSFT)" };
    }
    const ticker = String(symbol).trim().toUpperCase();
    if (!ticker) return { result: null, error: "Symbol cannot be empty." };
    try {
      const summary = await fetchQuoteSummary(ticker);
      if (summary) return { result: summary };
      return { result: null, error: `No quote summary for symbol "${ticker}". Check symbol or try again later.` };
    } catch (err) {
      return { result: null, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export default YahooFinanceQuoteTool;
