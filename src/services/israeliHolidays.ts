// Israeli holidays on which most businesses close, for the "add as closed" suggestion next to the
// special hours of the Google listing (docs/gbp-sync-spec.md, phase A). Pure, no I/O.
//
// A suggestion only: nothing here is ever saved or sent to Google by itself. The owner adds a day,
// can edit it, and saves.
//
// The dates are Gregorian days on which the holiday itself falls in Israel (one day of Sukkot, one of
// Pesach, no second days as in the diaspora), computed from the Hebrew calendar and checked against
// the published calendar. Hanukkah and Purim are deliberately absent: they are not closure days.
// Independence Day follows the Knesset rule: when 5 Iyar falls on Friday or Saturday it moves to the
// Thursday before, and when it falls on Monday it moves to Tuesday (so 2028 is 2 May).
// The table ends at the end of 2028: after that there are no suggestions until it is extended
// (README part 139).

export interface Holiday { id: string; name: string; date: string }

/** The first day of the year each table row belongs to, for the "table ends" check. */
export const HOLIDAYS_TABLE_FROM = '2026-01-01';
export const HOLIDAYS_TABLE_TO = '2028-12-31';

const H = (id: string, name: string, date: string): Holiday => ({ id, name, date });

export const HOLIDAYS: readonly Holiday[] = [
  // 5786 / 5787
  H('pesach', 'פסח', '2026-04-02'),
  H('pesach7', 'שביעי של פסח', '2026-04-08'),
  H('independence', 'יום העצמאות', '2026-04-22'),
  H('shavuot', 'שבועות', '2026-05-22'),
  H('rosh1', 'ראש השנה', '2026-09-12'),
  H('rosh2', 'ראש השנה (יום שני)', '2026-09-13'),
  H('yomkippur', 'יום כיפור', '2026-09-21'),
  H('sukkot', 'סוכות', '2026-09-26'),
  H('simchat', 'שמחת תורה', '2026-10-03'),
  // 5787 / 5788
  H('pesach', 'פסח', '2027-04-22'),
  H('pesach7', 'שביעי של פסח', '2027-04-28'),
  H('independence', 'יום העצמאות', '2027-05-12'),
  H('shavuot', 'שבועות', '2027-06-11'),
  H('rosh1', 'ראש השנה', '2027-10-02'),
  H('rosh2', 'ראש השנה (יום שני)', '2027-10-03'),
  H('yomkippur', 'יום כיפור', '2027-10-11'),
  H('sukkot', 'סוכות', '2027-10-16'),
  H('simchat', 'שמחת תורה', '2027-10-23'),
  // 5788 / 5789
  H('pesach', 'פסח', '2028-04-11'),
  H('pesach7', 'שביעי של פסח', '2028-04-17'),
  H('independence', 'יום העצמאות', '2028-05-02'),
  H('shavuot', 'שבועות', '2028-05-31'),
  H('rosh1', 'ראש השנה', '2028-09-21'),
  H('rosh2', 'ראש השנה (יום שני)', '2028-09-22'),
  H('yomkippur', 'יום כיפור', '2028-09-30'),
  H('sukkot', 'סוכות', '2028-10-05'),
  H('simchat', 'שמחת תורה', '2028-10-12'),
];

/** How far ahead the suggestions look. */
export const HOLIDAY_WINDOW_DAYS = 120;

export interface HolidaySuggestion { id: string; name: string; date: string }

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The holidays from `now` (today included) up to `days` days ahead, in date order, leaving out days
 * the owner already has in their special hours (`existing`: YYYY-MM-DD).
 */
export function suggestHolidays(now: Date, existing: readonly string[] = [], days = HOLIDAY_WINDOW_DAYS): HolidaySuggestion[] {
  const from = dayOf(now);
  const to = dayOf(new Date(now.getTime() + days * 86_400_000));
  const have = new Set(existing);
  return HOLIDAYS
    .filter((h) => h.date >= from && h.date <= to && !have.has(h.date))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((h) => ({ id: `${h.id}-${h.date}`, name: h.name, date: h.date }));
}
