/**
 * Shared Yahoo Finance API helpers. Used by default (index), quote, and chart programs.
 */
export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export async function fetchQuoteSummary(symbol) {
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

export async function fetchChart(symbol) {
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
