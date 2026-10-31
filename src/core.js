/**
 * Pure, framework-free logic for the balance widget.
 *
 * Two jobs:
 *   1. Decide whether "now" is inside DeepSeek's peak window, using Beijing
 *      time (Asia/Shanghai, UTC+8, no DST) and mainland China statutory holidays.
 *   2. Render wallet amounts the way the DeepSeek Platform does.
 *
 * Nothing in this module touches the DOM, `Intl`, or the local time zone, so it
 * behaves identically in the browser and in `node --test`.
 */

/** China Standard Time is a fixed UTC+8 offset; the country has no DST. */
export const BEIJING_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * Peak windows, in Beijing wall-clock minutes from midnight.
 * Start is inclusive, end is exclusive: 09:00-11:59 and 14:00-17:59 are peak.
 */
export const PEAK_WINDOWS = [
  { startMinute: 9 * 60, endMinute: 12 * 60 },
  { startMinute: 14 * 60, endMinute: 18 * 60 },
];

/**
 * Mainland China statutory holiday ranges, inclusive on both ends.
 *
 * Source: 国务院办公厅关于2025年部分节假日安排的通知 (国办发明电〔2024〕12号)
 *         https://www.gov.cn/zhengce/content/202411/content_6986382.htm
 *         国务院办公厅关于2026年部分节假日安排的通知 (国办发明电〔2025〕7号)
 *         https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm
 *
 * Weekends already fall outside peak windows; ranges that happen to include a
 * weekend are kept verbatim so the table matches the official notice. Make-up
 * workdays (调休) are intentionally ignored: the widget's rule is "Monday to
 * Friday, excluding statutory holidays", so a Saturday make-up workday stays
 * idle.
 *
 * Add the next year's notice here when it is published; `HOLIDAY_YEARS` and the
 * UI's coverage warning update automatically.
 */
export const HOLIDAY_RANGES = {
  2025: [
    ['2025-01-01', '2025-01-01', '元旦'],
    ['2025-01-28', '2025-02-04', '春节'],
    ['2025-04-04', '2025-04-06', '清明节'],
    ['2025-05-01', '2025-05-05', '劳动节'],
    ['2025-05-31', '2025-06-02', '端午节'],
    ['2025-10-01', '2025-10-08', '国庆节、中秋节'],
  ],
  2026: [
    ['2026-01-01', '2026-01-03', '元旦'],
    ['2026-02-15', '2026-02-23', '春节'],
    ['2026-04-04', '2026-04-06', '清明节'],
    ['2026-05-01', '2026-05-05', '劳动节'],
    ['2026-06-19', '2026-06-21', '端午节'],
    ['2026-09-25', '2026-09-27', '中秋节'],
    ['2026-10-01', '2026-10-07', '国庆节'],
  ],
};

/** Years for which the holiday table is complete. */
export const HOLIDAY_YEARS = new Set(Object.keys(HOLIDAY_RANGES).map(Number));

/** How far ahead `nextTransition` scans before giving up (holidays can be 9 days). */
const MAX_TRANSITION_SCAN_MS = 16 * 24 * 60 * 60 * 1000;

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function pad(value) {
  return String(value).padStart(2, '0');
}

function utcMidnight(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

/** date string (`YYYY-MM-DD`) -> statutory holiday name */
const HOLIDAY_NAMES = (() => {
  const names = new Map();
  for (const ranges of Object.values(HOLIDAY_RANGES)) {
    for (const [from, to, name] of ranges) {
      for (let day = utcMidnight(from); day <= utcMidnight(to); day += DAY_MS) {
        const date = new Date(day);
        names.set(
          `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
          name,
        );
      }
    }
  }
  return names;
})();

/**
 * Split an instant into Beijing wall-clock fields.
 * @param {number} ms - Unix epoch milliseconds.
 * @returns {{year:number,month:number,day:number,hour:number,minute:number,second:number,weekday:number,date:string,minuteOfDay:number}}
 */
export function beijingParts(ms) {
  const shifted = new Date(ms + BEIJING_UTC_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  const hour = shifted.getUTCHours();
  const minute = shifted.getUTCMinutes();
  return {
    year,
    month,
    day,
    hour,
    minute,
    second: shifted.getUTCSeconds(),
    weekday: shifted.getUTCDay(),
    date: `${year}-${pad(month)}-${pad(day)}`,
    minuteOfDay: hour * 60 + minute,
  };
}

/**
 * @param {string} date - `YYYY-MM-DD`
 * @returns {string | null} holiday name, or null on a workday.
 */
export function holidayNameFor(date) {
  return HOLIDAY_NAMES.get(date) ?? null;
}

/**
 * Whether a Beijing wall-clock minute is inside a peak window.
 * Weekends and statutory holidays are never peak.
 * @param {ReturnType<typeof beijingParts>} parts
 */
export function isPeakParts(parts) {
  if (parts.weekday === 0 || parts.weekday === 6) return false;
  if (HOLIDAY_NAMES.has(parts.date)) return false;
  return PEAK_WINDOWS.some(
    (window) => parts.minuteOfDay >= window.startMinute && parts.minuteOfDay < window.endMinute,
  );
}

function isPeakAt(ms) {
  return isPeakParts(beijingParts(ms));
}

/**
 * Find the next minute at which the peak/idle state flips.
 * @param {number} ms - current instant
 * @param {boolean} peak - current state
 * @returns {{at:number,inMs:number,peak:boolean} | null}
 */
export function nextTransition(ms, peak) {
  const firstMinute = Math.floor(ms / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  const limit = firstMinute + MAX_TRANSITION_SCAN_MS;
  for (let at = firstMinute; at <= limit; at += MINUTE_MS) {
    if (isPeakAt(at) !== peak) {
      return { at, inMs: at - ms, peak: !peak };
    }
  }
  return null;
}

/**
 * Describe the peak/idle state at an instant.
 * @param {number} ms - Unix epoch milliseconds.
 * @returns {{
 *   peak: boolean,
 *   reason: 'weekend' | 'holiday' | 'peak-window' | 'off-hours',
 *   holidayName: string | null,
 *   weekend: boolean,
 *   covered: boolean,
 *   date: string,
 *   weekday: number,
 *   minuteOfDay: number,
 *   next: {at:number,inMs:number,peak:boolean} | null,
 *   parts: ReturnType<typeof beijingParts>,
 * }}
 */
export function slotAt(ms) {
  const parts = beijingParts(ms);
  const weekend = parts.weekday === 0 || parts.weekday === 6;
  const holidayName = HOLIDAY_NAMES.get(parts.date) ?? null;
  const inWindow = PEAK_WINDOWS.some(
    (window) => parts.minuteOfDay >= window.startMinute && parts.minuteOfDay < window.endMinute,
  );
  const peak = isPeakParts(parts);
  const reason = weekend
    ? 'weekend'
    : holidayName !== null
      ? 'holiday'
      : inWindow
        ? 'peak-window'
        : 'off-hours';
  return {
    peak,
    reason,
    holidayName,
    weekend,
    covered: HOLIDAY_YEARS.has(parts.year),
    date: parts.date,
    weekday: parts.weekday,
    minuteOfDay: parts.minuteOfDay,
    next: nextTransition(ms, peak),
    parts,
  };
}

/**
 * Format a Platform decimal amount for display.
 *
 * The Platform UI uses two decimals with thousands separators. Positive
 * amounts are truncated towards zero, and a positive amount below one cent is
 * shown as `<0.01`; negative amounts are rounded away from zero and never shown
 * smaller than one cent in magnitude.
 *
 * @param {string | number | null | undefined} raw - decimal string such as "12.3" or "0E-16".
 * @returns {string | null} formatted digits (no currency symbol), or null when invalid.
 */
export function formatAmount(raw) {
  if (raw === null || raw === undefined) return null;
  let value = String(raw).trim();
  if (value === '') return null;

  // Platform may emit exponent notation such as "0E-16" or "1e+3".
  if (/e/i.test(value)) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    value = numeric.toFixed(12);
  }

  if (!/\d/.test(value)) return null;
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(value);
  if (match === null) return null;
  const negative = match[1] === '-';
  const integerPart = match[2] === '' ? '0' : match[2];
  const fractionPart = match[3] ?? '';

  const centsDigits = (fractionPart + '00').slice(0, 2);
  const rest = fractionPart.slice(2);
  const beyondCents = /[1-9]/.test(rest);

  if (!negative) {
    const integerIsZero = /^0*$/.test(integerPart);
    if (integerIsZero && centsDigits === '00' && beyondCents) return '<0.01';
    return `${groupDigits(integerPart)}.${centsDigits}`;
  }

  // Round the magnitude away from zero at the cent.
  let cents = BigInt(integerPart || '0') * 100n + BigInt(centsDigits);
  if (rest !== '' && rest.charCodeAt(0) >= 53 /* '5' */) cents += 1n;
  if (cents === 0n && (beyondCents || /[1-9]/.test(fractionPart))) cents = 1n;
  if (cents === 0n) return '0.00';
  const integer = (cents / 100n).toString();
  const fraction = (cents % 100n).toString().padStart(2, '0');
  return `-${groupDigits(integer)}.${fraction}`;
}

function groupDigits(digits) {
  const trimmed = digits.replace(/^0+(?=\d)/, '');
  return trimmed.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Split a duration into whole calendar units.
 * @param {number} ms
 */
export function durationParts(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
    totalSeconds: total,
  };
}

/**
 * Beijing wall-clock `HH:mm`, optionally prefixed with `MM-DD`.
 * @param {number} ms
 * @param {{ withDate?: boolean }} [options]
 */
export function beijingClock(ms, options = {}) {
  const parts = beijingParts(ms);
  const time = `${pad(parts.hour)}:${pad(parts.minute)}`;
  return options.withDate === false ? time : `${pad(parts.month)}-${pad(parts.day)} ${time}`;
}

/**
 * Beijing wall-clock `HH:mm:ss`.
 * @param {number} ms
 */
export function beijingTime(ms) {
  const parts = beijingParts(ms);
  return `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}
