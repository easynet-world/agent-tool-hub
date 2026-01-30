---
name: yahoo-finance-skill
description: Yahoo Finance stock data by symbol. Three tools (each self-describing); use tools/yahoo-finance for general quotes, tools/yahoo-finance/quote or tools/yahoo-finance/chart for a specific API.
license: MIT
compatibility: Requires Node.js 18+ and network access to query1.finance.yahoo.com, query2.finance.yahoo.com.
---

# Yahoo Finance Stock Information (Skill)

This skill uses optional Agent Skills frontmatter: **license** (MIT) and **compatibility** (Node.js + network). It can use any tools the hub exposes (no allowlist enforced).

This skill exposes three tools; each tool's **name and description** come from its implementation (StructuredTool). Tool names:

- **tools/yahoo-finance** — default quote (quoteSummary then chart fallback)
- **tools/yahoo-finance/quote** — quote summary API only
- **tools/yahoo-finance/chart** — chart/OHLCV API only

All take input: `{ "symbol": "AAPL" }`.

## Quick start

```json
{ "symbol": "AAPL" }
```

With optional fields:

```json
{
  "symbol": "MSFT"
}
```

## Behavior

- **symbol** (required): Ticker symbol (e.g. AAPL, MSFT, GOOGL).
- Fetches from Yahoo Finance public endpoints; returns current price, previous close, open, day high/low, volume, and currency.
- No API key required. Rate limits may apply.

For API details see [references/REFERENCE.md](references/REFERENCE.md) (Level 3 resource — file reference from skill root).

## Output

```json
{
  "result": {
    "symbol": "string",
    "price": "number",
    "currency": "string",
    "previousClose": "number",
    "open": "number",
    "dayHigh": "number",
    "dayLow": "number",
    "volume": "number",
    "shortName": "string"
  }
}
```
