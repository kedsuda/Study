import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeAcademicSelection, selectionFromSearch } from '../src/utils/academicSelection.ts';

const selected = { key: 'sy:1-2569', year: '2569', semester: '1', subject: '42' };

test('navigation without filters and reload preserve the selected subject', () => {
  const restored = JSON.parse(JSON.stringify(selected));
  assert.deepEqual(selectionFromSearch(new URLSearchParams('tab=files'), restored), selected);
});

test('a subject link replaces the subject while retaining the academic scope', () => {
  assert.deepEqual(selectionFromSearch(new URLSearchParams('subject=7'), selected), { ...selected, subject: '7' });
});

test('year-only links clear the previous semester and subject', () => {
  assert.deepEqual(selectionFromSearch(new URLSearchParams('academic_year=2569'), selected), {
    key: 'year:2569', year: '2569', semester: '', subject: '',
  });
});

test('changing semester clears the subject; selecting the same semester retains it', () => {
  const { subject, ...academic } = selected;
  assert.equal(mergeAcademicSelection(selected, academic).subject, '42');
  assert.equal(mergeAcademicSelection(selected, { ...academic, semester: '2' }).subject, '');
});

test('explicit all subjects selection clears persisted selection', () => {
  assert.equal(mergeAcademicSelection(selected, { ...selected, subject: '' }).subject, '');
});

test('a new user without stored selection does not inherit a subject', () => {
  assert.equal(selectionFromSearch(new URLSearchParams(), null), null);
});
