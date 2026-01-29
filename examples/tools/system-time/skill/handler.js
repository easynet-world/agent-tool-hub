/**
 * System time skill handler.
 * Return shape aligned with core/util.time.now: iso, epochMs, timezone, formatted.
 */
async function handler(args) {
  const { format, timezone } = args ?? {};
  const now = new Date();
  const tz =
    typeof timezone === "string" && timezone
      ? timezone
      : Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";

  let formatted;
  if (format === "locale") {
    formatted = now.toLocaleString();
  } else {
    try {
      formatted = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZoneName: "short",
      }).format(now);
    } catch {
      formatted = now.toISOString();
    }
  }

  return {
    result: {
      iso: now.toISOString(),
      epochMs: now.getTime(),
      timezone: tz,
      formatted,
    },
  };
}

export default handler;
