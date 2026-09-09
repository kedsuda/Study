const SUBJECTS_UPDATED_EVENT = 'subjects:updated';
const REVEAL_SCHEDULE_REQUEST_KEY = 'subjects:reveal-schedule-requested-at';

export const emitSubjectsUpdated = (options: { revealSchedule?: boolean } = {}) => {
  if (typeof window === 'undefined') return;
  if (options.revealSchedule) {
    window.sessionStorage.setItem(REVEAL_SCHEDULE_REQUEST_KEY, String(Date.now()));
  }
  window.dispatchEvent(new CustomEvent(SUBJECTS_UPDATED_EVENT, { detail: options }));
};

export const subscribeSubjectsUpdated = (listener: () => void) => {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(SUBJECTS_UPDATED_EVENT, listener);
  return () => window.removeEventListener(SUBJECTS_UPDATED_EVENT, listener);
};

export const consumeScheduleRevealRequest = () => {
  if (typeof window === 'undefined') return false;
  const requestedAt = window.sessionStorage.getItem(REVEAL_SCHEDULE_REQUEST_KEY);
  if (!requestedAt) return false;
  window.sessionStorage.removeItem(REVEAL_SCHEDULE_REQUEST_KEY);
  return true;
};
