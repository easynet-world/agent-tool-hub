# Yahoo Finance API Reference (Level 3 resource)

This file is a **Level 3 resource** — loaded only when the agent needs it (e.g. via `readResource("references/REFERENCE.md")` or file references in SKILL.md).

## Endpoints used by this skill

- **quoteSummary**: `https://query2.finance.yahoo.com/v10/finance/quoteSummary/{symbol}?modules=price,summaryDetail`
- **chart**: `https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=1d`

## Response fields

- `price`, `previousClose`, `open`, `dayHigh`, `dayLow`, `volume`, `currency`, `shortName`, `symbol`

## Rate limits

Yahoo Finance public endpoints may rate-limit; no API key required.
