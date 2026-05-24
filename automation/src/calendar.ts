// Minimal NYSE trading-calendar check. Hardcoded holidays for 2026-2027 cover
// the project window; a long-running production deployment should swap in
// `nyse-holidays` (npm) or pull the official calendar.
//
// All dates are in US Eastern (NYSE local) time.

const NYSE_HOLIDAYS_ET: ReadonlySet<string> = new Set([
  // 2026
  "2026-01-01", // New Year's Day
  "2026-01-19", // MLK Jr. Day
  "2026-02-16", // Presidents' Day
  "2026-04-03", // Good Friday
  "2026-05-25", // Memorial Day
  "2026-06-19", // Juneteenth
  "2026-07-03", // Independence Day (observed; Jul 4 = Saturday)
  "2026-09-07", // Labor Day
  "2026-11-26", // Thanksgiving
  "2026-12-25", // Christmas
  // 2027
  "2027-01-01",
  "2027-01-18",
  "2027-02-15",
  "2027-03-26", // Good Friday
  "2027-05-31",
  "2027-06-18", // Juneteenth observed (Jun 19 = Saturday)
  "2027-07-05", // Independence Day observed
  "2027-09-06",
  "2027-11-25",
  "2027-12-24", // Christmas observed
]);

function ymdInEastern(d: Date): string {
  // Format the date in America/New_York as YYYY-MM-DD.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  return `${m.year}-${m.month}-${m.day}`;
}

function dowInEastern(d: Date): number {
  const wk = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(d);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wk);
}

export function isNyseTradingDay(d: Date = new Date()): boolean {
  const dow = dowInEastern(d);
  if (dow === 0 || dow === 6) return false; // Sat / Sun
  if (NYSE_HOLIDAYS_ET.has(ymdInEastern(d))) return false;
  return true;
}
