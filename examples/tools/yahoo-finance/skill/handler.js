/**
 * Yahoo Finance stock information skill handler.
 * Fetches quote data by symbol from Yahoo Finance public endpoints.
 * No API key required.
 */
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function handler(args) {
  const symbol = args?.symbol;
  if (!symbol || typeof symbol !== "string") {
    return {
      result: null,
      error: "Missing or invalid 'symbol' (e.g. AAPL, MSFT)",
    };
  }

  const ticker = String(symbol).trim().toUpperCase();
  if (!ticker) {
    return { result: null, error: "Symbol cannot be empty." };
  }

  try {
    // Prefer quoteSummary; fallback to chart API
    const summary = await fetchQuoteSummary(ticker);
    if (summary) return { result: summary };

    const chart = await fetchChart(ticker);
    if (chart) return { result: chart };

    return {
      result: null,
      error: `No quote data for symbol "${ticker}". Check symbol or try again later.`,
    };
  } catch (err) {
    return {
      result: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function fetchQuoteSummary(symbol) {
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=price,summaryDetail`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const quote = data?.quoteSummary?.result?.[0];
  if (!quote) return null;

  const priceMod = quote.price || {};
  const summaryMod = quote.summaryDetail || {};
  const regularMarketPrice = priceMod.regularMarketPrice ?? summaryMod.regularMarketPrice;
  const num = (v) => (v != null && typeof v === "object" && "raw" in v ? v.raw : v);

  return {
    symbol: priceMod.symbol ?? symbol,
    shortName: priceMod.shortName ?? null,
    price: num(regularMarketPrice) ?? num(summaryMod.previousClose),
    currency: priceMod.currency ?? summaryMod.currency ?? "USD",
    previousClose: num(summaryMod.previousClose),
    open: num(summaryMod.open),
    dayHigh: num(summaryMod.dayHigh),
    dayLow: num(summaryMod.dayLow),
    volume: num(summaryMod.volume),
  };
}

async function fetchChart(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const chart = data?.chart?.result?.[0];
  if (!chart) return null;

  const meta = chart.meta || {};
  const quote = chart.indicators?.quote?.[0];
  const openArr = quote?.open ?? [];
  const highArr = quote?.high ?? [];
  const lowArr = quote?.low ?? [];
  const closeArr = quote?.close ?? [];
  const volArr = quote?.volume ?? [];
  const last = (arr) => (Array.isArray(arr) ? arr.filter((x) => x != null).pop() : undefined);

  const price = meta.regularMarketPrice ?? last(closeArr);
  if (price == null) return null;

  return {
    symbol: meta.symbol ?? symbol,
    shortName: meta.shortName ?? null,
    price,
    currency: meta.currency ?? "USD",
    previousClose: meta.previousClose ?? last(closeArr),
    open: last(openArr),
    dayHigh: last(highArr),
    dayLow: last(lowArr),
    volume: last(volArr),
  };
}

export default handler;
