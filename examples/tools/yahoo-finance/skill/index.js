/**
 * Yahoo Finance skill — default program: quote (tries quoteSummary, then chart API).
 * Exports a class extending StructuredTool; loader instantiates and uses the instance.
 */
import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { fetchQuoteSummary, fetchChart } from "./lib/yahoo-api.js";

class YahooFinanceTool extends StructuredTool {
  name = "yahoo-finance";
  description =
    "Fetch Yahoo Finance stock quote by symbol (e.g. AAPL, MSFT). Tries quoteSummary API first, then chart API. Returns price, previous close, open, day high/low, volume, currency.";
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
      const chart = await fetchChart(ticker);
      if (chart) return { result: chart };
      return { result: null, error: `No quote data for symbol "${ticker}". Check symbol or try again later.` };
    } catch (err) {
      return { result: null, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export default YahooFinanceTool;
