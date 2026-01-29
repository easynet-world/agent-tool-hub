---
name: yahoo-finance-skill
description: Fetch Yahoo Finance stock information by symbol (e.g. AAPL, MSFT). Returns price, previous close, open, day high/low, volume, currency.
---

# Yahoo Finance Stock Information (Skill)

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
