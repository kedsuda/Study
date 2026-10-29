import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSemesterOptions, filterBySemester } from '../src/utils/semester.ts';

const subjects = [
  { id: 1, semester_id: 10, semester: 1, academic_year: 2569 },
  { id: 2, semester_id: 11, semester: 2, academic_year: 2569 },
  { id: 3, semester_id: 12, semester: 1, academic_year: 2568 },
];

test('year selection includes both terms without including other years', () => {
  assert.deepEqual(filterBySemester(subjects, 'year:2569').map(s => s.id), [1, 2]);
});

test('URL year/term and stored semester ID select the same subjects', () => {
  assert.deepEqual(filterBySemester(subjects, 'sy:1-2569'), filterBySemester(subjects, 'id:10'));
  assert.deepEqual(filterBySemester(subjects, 'sy:1-2569').map(s => s.id), [1]);
});

test('clearing filters restores all subjects; an empty year stays empty', () => {
  assert.deepEqual(filterBySemester(subjects, 'all'), subjects);
  assert.deepEqual(filterBySemester(subjects, 'year:2570'), []);
});

test('page selectors can display global all, year, and term selections', () => {
  const options = buildSemesterOptions(subjects);
  assert.equal(options[0].key, 'all');
  assert.equal(options.filter(option => option.key === 'year:2569').length, 1);
  assert.ok(options.some(option => option.key === 'id:10'));
});
