import test from 'node:test';
import assert from 'node:assert/strict';
import { taskBounds, taskProgress, tasksInPeriod, shiftDate } from '../src/utils/goalTasks.ts';

test('empty plans and checking/unchecking tasks update progress', () => {
  assert.deepEqual(taskProgress([]), { total: 0, completed: 0, percent: 0 });
  const tasks = Array.from({ length: 4 }, () => ({ completed: false }));
  tasks[0].completed = true;
  assert.equal(taskProgress(tasks).percent, 25);
  tasks.forEach(task => { task.completed = true; });
  assert.equal(taskProgress(tasks).percent, 100);
  tasks[0].completed = false;
  assert.equal(taskProgress(tasks).percent, 75);
});
test('weeks span months and years, beginning on Monday', () => {
  assert.deepEqual(taskBounds('2027-01-01', 'week'), { start: '2026-12-28', end: '2027-01-03' });
  assert.deepEqual(taskBounds('2026-09-27', 'week'), { start: '2026-09-21', end: '2026-09-27' });
  assert.deepEqual(taskBounds('2028-02-10', 'month'), { start: '2028-02-01', end: '2028-02-29' });
  assert.equal(shiftDate('2026-12-31', 1), '2027-01-01');
});
test('bars count tasks by planned date and exclude other periods', () => {
  const tasks = [
    { task_date: '2026-09-23', completed: true },
    { task_date: '2026-09-24', completed: false },
    { task_date: '2026-09-30', completed: true },
    { task_date: '2026-10-01', completed: false },
  ];
  assert.equal(taskProgress(tasksInPeriod(tasks, '2026-09-23', 'day')).percent, 100);
  assert.equal(taskProgress(tasksInPeriod(tasks, '2026-09-23', 'week')).percent, 50);
  assert.equal(taskProgress(tasksInPeriod(tasks, '2026-09-23', 'month')).percent, 67);
  assert.equal(taskProgress(tasksInPeriod(tasks, '2026-09-30', 'week')).percent, 50);
});
