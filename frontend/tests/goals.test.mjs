import test from 'node:test';
import assert from 'node:assert/strict';
import { describeGoal } from '../src/utils/goals.ts';

const base = {
  goal_type: 'study_sessions', target_sessions: 0, target_minutes: 0, target_questions: 0, target_quiz_sets: 0,
  current_activities: 8, current_minutes: 90, current_questions: 30, current_quiz_sets: 3,
  progress_percent: 0, status: 'not_set',
};
test('activity history without a target is neither failed nor achieved', () => {
  const goal = describeGoal(base);
  assert.equal(goal.hasTarget, false);
  assert.equal(goal.completed, false);
  assert.equal(goal.statusLabel, 'ยังไม่ได้ตั้งเป้า');
});
test('time goals compare minutes, not the number of activities', () => {
  const goal = describeGoal({ ...base, goal_type: 'study_minutes', target_minutes: 120, progress_percent: 75, status: 'not_achieved' });
  assert.deepEqual(goal.metrics, [{ current: 90, target: 120, unit: 'นาที' }]);
  assert.equal(goal.percent, 75);
  assert.equal(goal.statusLabel, 'กำลังสะสมความคืบหน้า');
});
test('quiz goals exclude unrelated learning activities', () => {
  const goal = describeGoal({ ...base, goal_type: 'quiz_mastery', target_quiz_sets: 5, progress_percent: 60, status: 'not_achieved' });
  assert.deepEqual(goal.metrics, [{ current: 3, target: 5, unit: 'ชุด' }]);
  assert.equal(goal.completed, false);
});
test('legacy question and quiz alternatives respect server achievement status', () => {
  const goal = describeGoal({ ...base, goal_type: 'quiz_mastery', target_questions: 20, target_quiz_sets: 5, progress_percent: 100, status: 'achieved' });
  assert.equal(goal.metrics.length, 2);
  assert.equal(goal.completed, true);
  assert.equal(goal.percent, 100);
});
test('a rounded 100 percent does not imply achievement', () => {
  const goal = describeGoal({ ...base, target_sessions: 999, current_activities: 998, progress_percent: 100, status: 'not_achieved' });
  assert.equal(goal.completed, false);
});
test('exceeding a target keeps the real count and caps the progress bar', () => {
  const goal = describeGoal({ ...base, target_sessions: 5, status: 'achieved', progress_percent: 160 });
  assert.deepEqual(goal.metrics, [{ current: 8, target: 5, unit: 'กิจกรรม' }]);
  assert.equal(goal.percent, 100);
});
