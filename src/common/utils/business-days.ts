/**
 * A deadline `days` days after `from` (PA·8): a calendar date, at midnight
 * UTC like the other date-only fields. With `businessDaysOnly`, Saturdays
 * and Sundays don't count, and a deadline never falls on one. Public
 * holidays aren't known yet: they count as working days.
 */
export function addDelay(
  from: Date,
  days: number,
  businessDaysOnly: boolean,
): Date {
  const date = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );
  if (!businessDaysOnly) {
    date.setUTCDate(date.getUTCDate() + days);
    return date;
  }
  let left = days;
  while (left > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (!isWeekend(date)) left -= 1;
  }
  // A zero-day delay from a weekend lands on the next working day.
  while (isWeekend(date)) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

function isWeekend(date: Date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}
