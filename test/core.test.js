import test from 'node:test';
import assert from 'node:assert/strict';

import {
  beijingClock,
  beijingParts,
  durationParts,
  formatAmount,
  holidayNameFor,
  isPeakParts,
  nextTransition,
  slotAt,
} from '../src/core.js';

/** Build an instant from a Beijing wall-clock string such as "2026-10-26T09:00:00". */
function beijing(isoLocal) {
  return Date.parse(`${isoLocal}+08:00`);
}

test('beijingParts uses a fixed UTC+8 offset', () => {
  const parts = beijingParts(beijing('2026-10-26T09:05:07'));
  assert.equal(parts.date, '2026-10-26');
  assert.equal(parts.hour, 9);
  assert.equal(parts.minute, 5);
  assert.equal(parts.second, 7);
  assert.equal(parts.weekday, 1); // Monday
  assert.equal(parts.minuteOfDay, 545);
});

test('peak starts at 09:00 and ends at 12:00, then 14:00 to 18:00', () => {
  const cases = [
    ['2026-10-26T08:59:59', false],
    ['2026-10-26T09:00:00', true],
    ['2026-10-26T11:59:59', true],
    ['2026-10-26T12:00:00', false],
    ['2026-10-26T13:59:59', false],
    ['2026-10-26T14:00:00', true],
    ['2026-10-26T17:59:59', true],
    ['2026-10-26T18:00:00', false],
    ['2026-10-26T23:30:00', false],
  ];
  for (const [instant, expected] of cases) {
    assert.equal(slotAt(beijing(instant)).peak, expected, instant);
  }
});

test('weekends are idle all day', () => {
  assert.equal(slotAt(beijing('2026-10-31T10:00:00')).peak, false); // Saturday
  assert.equal(slotAt(beijing('2026-11-01T10:00:00')).peak, false); // Sunday
  assert.equal(slotAt(beijing('2026-10-31T10:00:00')).reason, 'weekend');
});

test('statutory holidays are idle all day, including weekdays', () => {
  const nationalDay = slotAt(beijing('2026-10-01T10:00:00'));
  assert.equal(nationalDay.peak, false);
  assert.equal(nationalDay.reason, 'holiday');
  assert.equal(nationalDay.holidayName, '国庆节');

  const springFestival = slotAt(beijing('2026-02-17T10:00:00'));
  assert.equal(springFestival.peak, false);
  assert.equal(springFestival.holidayName, '春节');

  assert.equal(holidayNameFor('2026-02-24'), null);
  assert.equal(slotAt(beijing('2026-02-24T10:00:00')).peak, true);
});

test('make-up workdays on weekends stay idle', () => {
  // 2026-10-10 is a Saturday listed as a make-up workday by the 2026 notice.
  const saturday = slotAt(beijing('2026-10-10T10:00:00'));
  assert.equal(saturday.weekend, true);
  assert.equal(saturday.peak, false);
});

test('the next transition flips at the window boundary', () => {
  const beforeNoon = slotAt(beijing('2026-10-26T11:59:30'));
  assert.equal(beforeNoon.peak, true);
  assert.equal(beforeNoon.next.at, beijing('2026-10-26T12:00:00'));
  assert.equal(beforeNoon.next.peak, false);
  assert.equal(beforeNoon.next.inMs, 30_000);

  const beforeAfternoon = slotAt(beijing('2026-10-26T13:00:00'));
  assert.equal(beforeAfternoon.next.at, beijing('2026-10-26T14:00:00'));

  const beforeWeekend = slotAt(beijing('2026-10-30T18:00:00')); // Friday evening
  assert.equal(beforeWeekend.peak, false);
  assert.equal(beforeWeekend.next.at, beijing('2026-11-02T09:00:00')); // Monday morning
});

test('next transition skips a whole holiday', () => {
  // National Day 2026 runs Oct 1-7; the previous workday ends Sep 30 at 18:00.
  const start = slotAt(beijing('2026-09-30T18:00:00'));
  assert.equal(start.peak, false);
  assert.equal(start.next.at, beijing('2026-10-08T09:00:00'));
});

test('years outside the holiday table fall back to weekends only and report no coverage', () => {
  const uncovered = slotAt(beijing('2027-01-04T10:00:00')); // Monday
  assert.equal(uncovered.covered, false);
  assert.equal(uncovered.peak, true);
  assert.equal(uncovered.next.at, beijing('2027-01-04T12:00:00'));
});

test('formatAmount follows Platform two-decimal display rules', () => {
  assert.equal(formatAmount('12.345'), '12.34'); // truncated
  assert.equal(formatAmount('12.3'), '12.30');
  assert.equal(formatAmount('1234567.891'), '1,234,567.89');
  assert.equal(formatAmount('0'), '0.00');
  assert.equal(formatAmount('0.00'), '0.00');
  assert.equal(formatAmount('0.004'), '<0.01');
  assert.equal(formatAmount('0.009'), '<0.01');
  assert.equal(formatAmount('0E-16'), '0.00');
  assert.equal(formatAmount('1e+3'), '1,000.00');
  assert.equal(formatAmount('-1.005'), '-1.01'); // rounded away from zero
  assert.equal(formatAmount('-0.004'), '-0.01'); // magnitude floor of one cent
  assert.equal(formatAmount('-0.00'), '0.00');
  assert.equal(formatAmount('-12.345'), '-12.35');
  assert.equal(formatAmount(''), null);
  assert.equal(formatAmount('abc'), null);
  assert.equal(formatAmount(null), null);
});

test('durationParts and beijingClock', () => {
  const parts = durationParts((2 * 3600 + 15 * 60 + 9) * 1000);
  assert.deepEqual(
    { days: parts.days, hours: parts.hours, minutes: parts.minutes, seconds: parts.seconds },
    { days: 0, hours: 2, minutes: 15, seconds: 9 },
  );
  assert.equal(beijingClock(beijing('2026-10-26T09:05:00'), { withDate: false }), '09:05');
  assert.equal(beijingClock(beijing('2026-10-26T09:05:00')), '10-26 09:05');
});

test('isPeakParts handles Sunday and Monday explicitly', () => {
  assert.equal(isPeakParts(beijingParts(beijing('2026-11-02T10:00:00'))), true);
  assert.equal(isPeakParts(beijingParts(beijing('2026-11-01T10:00:00'))), false);
});

test('nextTransition returns null if nothing changes within the horizon', () => {
  // Sanity guard for the scan bound: a normal weekday always has a transition.
  assert.notEqual(nextTransition(beijing('2026-10-26T10:00:00'), true), null);
});
