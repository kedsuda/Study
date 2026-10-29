import { useCallback, useEffect, useMemo, useSyncExternalStore, type SetStateAction } from 'react';
import { createSearchParams, useLocation, useSearchParams, type NavigateOptions, type URLSearchParamsInit } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { SemesterOption } from '../utils/semester';

import { mergeAcademicSelection, selectionFromSearch, type AcademicSelection as Selection } from '../utils/academicSelection';
const cache = new Map<string, string>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => { listeners.delete(listener); window.removeEventListener('storage', listener); };
};
const read = (key: string) => {
  try { return localStorage.getItem(key) ?? ''; } catch { return cache.get(key) ?? ''; }
};
const decode = (raw: string): Selection | null => {
  try {
    const value = JSON.parse(raw);
    return typeof value.key === 'string' && typeof value.year === 'string' && typeof value.semester === 'string' ? value : null;
  } catch { return null; }
};

function useAcademicSelection() {
  const { user } = useAuth();
  const storageKey = `slt::academic-selection::${user?.id ?? 'guest'}`;
  const raw = useSyncExternalStore(subscribe, () => read(storageKey), () => '');
  const selection = useMemo(() => decode(raw), [raw]);
  const update = useCallback((value: Selection) => {
    const previous = decode(read(storageKey));
    const next = JSON.stringify(mergeAcademicSelection(previous, value));
    if (read(storageKey) === next) return;
    cache.set(storageKey, next);
    try { localStorage.setItem(storageKey, next); } catch { /* Keep working when storage is unavailable. */ }
    notify();
  }, [storageKey]);
  return [selection, update] as const;
}

export function useSharedSubjectSelection() {
  const [selection, update] = useAcademicSelection();
  const subject = selection?.subject ?? '';
  const setSubject = useCallback((value: string) => {
    update({ ...(selection ?? { key: 'all', year: '', semester: '' }), subject: value });
  }, [selection, update]);
  return [subject, setSubject] as const;
}

export function useSharedSemesterSelection(options: SemesterOption[]) {
  const [selection, update] = useAcademicSelection();
  const matching = options.find(option => selection?.year && selection?.semester
    ? String(option.academic_year) === selection.year && String(option.semester) === selection.semester
    : option.key === selection?.key);
  const key = matching?.key ?? selection?.key ?? 'all';
  const setKey = useCallback((action: SetStateAction<string>) => {
    const nextKey = typeof action === 'function' ? action(key) : action;
    const option = options.find(item => item.key === nextKey);
    update({ key: nextKey, year: option?.academic_year ? String(option.academic_year) : nextKey.startsWith('year:') ? nextKey.slice(5) : '', semester: option?.semester ? String(option.semester) : '' });
  }, [key, options, update]);
  return [key, setKey] as const;
}

// URL filters can be bookmarked; the shared selection survives navigation without a query.
export function useAcademicSearchParams() {
  const { user } = useAuth();
  const userId = user?.id ?? 'guest';
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const [selection, update] = useAcademicSelection();
  const fromParams = useCallback((next: URLSearchParams) => {
    const year = next.get('academic_year') ?? '';
    const semester = next.get('semester') ?? '';
    update({ key: year && semester ? `sy:${semester}-${year}` : year ? `year:${year}` : 'all', year, semester, subject: next.get('subject') ?? '' });
  }, [update]);
  useEffect(() => {
    const incoming = new URLSearchParams(location.search);
    const current = decode(read(`slt::academic-selection::${userId}`));
    const next = selectionFromSearch(incoming, current);
    if (next) update(next);
  }, [location.key, location.search, update, userId]);
  const effective = useMemo(() => {
    const next = new URLSearchParams(params);
    if (selection) {
      for (const [name, value] of [['academic_year', selection.year], ['semester', selection.semester]]) {
        if (value) next.set(name, value); else next.delete(name);
      }
      if (selection.subject) next.set('subject', selection.subject); else next.delete('subject');
    }
    return next;
  }, [params, selection]);
  const setEffective = useCallback((next: URLSearchParamsInit | ((previous: URLSearchParams) => URLSearchParamsInit), options?: NavigateOptions) => {
    const resolved = createSearchParams(typeof next === 'function' ? next(effective) : next);
    fromParams(resolved);
    setParams(resolved, options);
  }, [effective, fromParams, setParams]);
  return [effective, setEffective] as const;
}
