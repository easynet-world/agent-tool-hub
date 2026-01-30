/**
 * Yahoo Finance skill — chart program: chart API only.
 * Exports a class extending StructuredTool; loader instantiates and uses the instance.
 */
import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { fetchChart } from "./lib/yahoo-api.js";

class YahooFinanceChartTool extends StructuredTool {
  name = "yahoo-finance-chart";
  description =
    "Fetch Yahoo Finance chart/OHLCV data by symbol. Returns price, open, high, low, volume from the chart API.";
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
      const chart = await fetchChart(ticker);
      if (chart) return { result: chart };
      return { result: null, error: `No chart data for symbol "${ticker}". Check symbol or try again later.` };
    } catch (err) {
      return { result: null, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export default YahooFinanceChartTool;
