export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Formats an instant as YYYY-MM-DD in the given IANA timezone.
 */
export function formatDateInTimezone(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA yields YYYY-MM-DD
  return formatter.format(date);
}

/**
 * Adds `days` to a YYYY-MM-DD calendar date string in pure calendar arithmetic.
 */
export function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + days));
  const year = utc.getUTCFullYear();
  const month = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const day = String(utc.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function previousCalendarDay(dateStr: string): string {
  return addDaysToDateString(dateStr, -1);
}

/**
 * Returns whole calendar days difference: b - a (for YYYY-MM-DD strings).
 */
export function diffCalendarDays(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const msA = Date.UTC(ay, am - 1, ad);
  const msB = Date.UTC(by, bm - 1, bd);
  return Math.round((msB - msA) / 86_400_000);
}

/**
 * Generates inclusive list of YYYY-MM-DD strings from startDateStr to endDateStr.
 */
export function listCalendarDaysInclusive(startDateStr: string, endDateStr: string): string[] {
  const diff = diffCalendarDays(startDateStr, endDateStr);
  if (diff < 0) return [];
  const result: string[] = [];
  for (let i = 0; i <= diff; i++) {
    result.push(addDaysToDateString(startDateStr, i));
  }
  return result;
}
