import test from 'node:test';
import assert from 'node:assert/strict';
import { format, parseISO } from 'date-fns';
import { buildSubjectDateTime, dateInMonth, expandRecurringSubjectSchedules, getStartOfWeek, getDurationHours, layoutTimedEvents, normalizeTimeValue, parseCalendarDateTime } from '../src/utils/calendar.ts';

const subject = { id: 1, name: 'คณิตศาสตร์', start_date: '2026-08-31', start_time: '07:15:00', end_time: '08:30:00' };
const event = (id, type, start = '2026-09-07 07:15:00', end = '2026-09-07 08:30:00') => ({ id, type, title: type, subject_id: 1, source: 'manual', start_time: start, end_time: end });
const expand = (events = []) => expandRecurringSubjectSchedules(events, [subject], parseISO('2026-09-07'), parseISO('2026-09-13'));

test('subject times and serialized timetable values keep their entered hours', () => {
  assert.equal(buildSubjectDateTime('2026-09-07', '07:15:00'), '2026-09-07T07:15:00');
  assert.equal(buildSubjectDateTime('2026-09-07 00:00:00', '08:30'), '2026-09-07T08:30:00');
  assert.equal(buildSubjectDateTime('2026-09-07 09:45:00'), '2026-09-07T09:45:00');
  assert.equal(normalizeTimeValue('2026-09-07T07:15:00.000Z'), '07:15:00');
  assert.equal(format(parseCalendarDateTime('2026-09-07T07:15:00+07:00'), 'HH:mm'), '07:15');
});

test('month and year navigation clamp leap days and roll over year boundaries', () => {
  assert.equal(dateInMonth('2026-01-31', 2026, 1), '2026-02-28');
  assert.equal(dateInMonth('2024-01-31', 2024, 1), '2024-02-29');
  assert.equal(dateInMonth('2024-02-29', 2025, 1), '2025-02-28');
  assert.equal(dateInMonth('2026-12-31', 2026, 12), '2027-01-31');
});

test('a Sunday belongs to the same Monday-based week, including across months', () => {
  assert.equal(format(getStartOfWeek(parseISO('2026-09-06')), 'yyyy-MM-dd'), '2026-08-31');
  assert.equal(format(getStartOfWeek(parseISO('2026-09-07')), 'yyyy-MM-dd'), '2026-09-07');
});

test('an exam does not hide a recurring class on the same day', () => {
  const results = expand([event(10, 'exam')]);
  assert.equal(results.length, 2);
  assert.equal(results.find(item => item.source === 'subject').start_time, '2026-09-07T07:15:00');
});

test('saved class details remain editable and suppress only an identical generated occurrence', () => {
  const saved = { ...event(10, 'class'), title: 'เรียนเสริม', room: '305', description: 'รายละเอียด' };
  const results = expand([saved]);
  assert.deepEqual(results, [saved]);
  assert.equal(expand([event(11, 'class', '2026-09-07 13:00:00', '2026-09-07 14:00:00')]).length, 2);
});

test('study logs do not replace scheduled classes', () => {
  assert.equal(expand([{ ...event(10, 'class'), source: 'study_log', study_log_id: 3 }]).length, 2);
});

test('recurrence starts on the subject start date and includes cross-month days', () => {
  const results = expandRecurringSubjectSchedules([], [subject], parseISO('2026-08-24'), parseISO('2026-09-06'));
  assert.equal(results.length, 1);
  assert.equal(results[0].start_time, '2026-08-31T07:15:00');
  const allDay = expandRecurringSubjectSchedules([], [{ ...subject, start_time: null, end_time: null }], parseISO('2026-09-07'), parseISO('2026-09-13'));
  assert.equal(allDay[0].all_day, true);
  assert.equal(allDay[0].end_time, null);
});

test('time validation rejects invalid and reversed times', () => {
  assert.equal(getDurationHours('09:15', '10:45'), 1.5);
  assert.equal(getDurationHours('10:00', '09:00'), null);
  assert.equal(getDurationHours('10:00', '10:00'), null);
  assert.equal(getDurationHours('25:00', '26:00'), null);
});

test('overlapping classes and exams get separate columns; later items use full width', () => {
  const results = layoutTimedEvents([event(1, 'class'), event(2, 'exam'), event(3, 'exam', '2026-09-07 10:00:00', '2026-09-07 11:00:00')]);
  assert.deepEqual(results.map(({column, columns}) => [column, columns]), [[0, 2], [1, 2], [0, 1]]);
});
