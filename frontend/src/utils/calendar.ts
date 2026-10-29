import { format, parseISO } from 'date-fns';

export type SubjectOption = {
  id: number;
  name: string;
  semester_id?: number | null;
  semester?: number | null;
  academic_year?: number | null;
  start_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
};

export type CalendarEvent = {
  id: number;
  title: string;
  description?: string | null;
  room?: string | null;
  subject_id?: number | null;
  start_time: string;
  end_time?: string | null;
  status?: string | null;
  type?: 'class' | 'exam' | 'other' | null;
  event_type?: 'class' | 'exam' | 'other' | null;
  all_day?: boolean;
  source?: string | null;
  subject?: SubjectOption | null;
  study_log_id?: number | null;
  metadata?: Record<string, any>;
};

type NormalizedEventType = Exclude<CalendarEvent['type'], null | undefined>;
export const normalizeTimeValue = (value?: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const timeChunk = trimmed.includes('T')
    ? (trimmed.split('T')[1] ?? trimmed)
    : (trimmed.includes(' ') ? (trimmed.split(' ').pop() ?? trimmed) : trimmed);
  const match = timeChunk.replace(/\./g, ':').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || Number(match[3] ?? 0) > 59) return null;
  const hour = match[1].padStart(2, '0');
  const minute = match[2];
  const second = match[3] ?? '00';
  return `${hour}:${minute}:${second}`;
};
// Timetable values are wall-clock times, not instants.  Some API routes
// serialize the same MySQL DATETIME with a UTC offset, which makes parseISO
// add seven hours in Thailand (10:00 becomes 17:00).  Read the date/time
// fields directly so every route displays the time the user entered.
export const parseCalendarDateTime = (value: string) => {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    const [, year, month, day, hour, minute, second = '00'] = match;
    return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  }

  return parseISO(value);
};
export const getDurationHours = (startTime: string, endTime: string) => {
  const start = normalizeTimeValue(startTime);
  const end = normalizeTimeValue(endTime);
  if (!start || !end) return null;

  const toMinutes = (time: string) => {
    const [hour, minute] = time.split(':').map(Number);
    return (hour * 60) + minute;
  };
  const durationMinutes = toMinutes(end) - toMinutes(start);
  return durationMinutes > 0 ? durationMinutes / 60 : null;
};
export const buildSubjectDateTime = (date?: string | null, time?: string | null) => {
  if (!date) return null;
  const trimmedDate = date.trim();
  if (!trimmedDate) return null;

  const normalizedProvidedTime = normalizeTimeValue(time);
  const datePart = trimmedDate.includes('T')
    ? (trimmedDate.split('T')[0] ?? trimmedDate)
    : (trimmedDate.includes(' ') ? (trimmedDate.split(' ')[0] ?? trimmedDate) : trimmedDate);

  if (normalizedProvidedTime) {
    return `${datePart}T${normalizedProvidedTime}`;
  }

  if (trimmedDate.includes('T')) return trimmedDate;
  if (trimmedDate.includes(' ')) {
    return `${datePart}T${normalizeTimeValue(trimmedDate) ?? '00:00:00'}`;
  }

  return `${datePart}T00:00:00`;
};
const normalizeEventTypeValue = (value: unknown): NormalizedEventType | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'exam' || normalized === 'สอบ' || normalized === 'test' || normalized === 'quiz') {
    return 'exam';
  }
  if (normalized === 'class' || normalized === 'เรียน' || normalized === 'study') {
    return 'class';
  }
  return normalized === 'other' ? 'other' : null;
};

export const resolveEventType = (event: CalendarEvent) =>
  normalizeEventTypeValue(event.event_type)
  ?? normalizeEventTypeValue(event.type)
  ?? normalizeEventTypeValue(event.metadata?.type)
  ?? normalizeEventTypeValue(event.metadata?.event_type)
  ?? null;
export const getStartOfWeek = (date: Date) => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  // ตารางเรียนเริ่มวันจันทร์และสิ้นสุดวันอาทิตย์
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
};

export const expandRecurringSubjectSchedules = (
  events: CalendarEvent[],
  subjects: SubjectOption[],
  rangeStart: Date,
  rangeEnd: Date,
) => {
  if (!subjects.length) return events;

  const scheduledSubjectIds = new Set(
    subjects.filter(subject => subject.start_date).map(subject => subject.id)
  );
  const nonRecurringEvents = events.filter(event => {
    const subjectId = event.subject?.id ?? event.subject_id;
    if (!subjectId || !scheduledSubjectIds.has(subjectId)) return true;
    if (event.source === 'study_log' || event.study_log_id) return true;
    return event.source !== 'subject' || resolveEventType(event) !== 'class';
  });

  // A saved class at the same time replaces a generated occurrence. Exams are
  // separate appointments: they must remain visible alongside the timetable
  // even when they belong to the same subject and happen on the same day.
  const overriddenClassTimes = new Set(
    nonRecurringEvents
      .filter(event => {
        const subjectId = event.subject?.id ?? event.subject_id;
        const type = resolveEventType(event);
        return Boolean(subjectId && type === 'class' && event.source !== 'study_log' && !event.study_log_id && !Number.isNaN(parseCalendarDateTime(event.start_time).getTime()));
      })
      .map(event => {
        const subjectId = event.subject?.id ?? event.subject_id;
        return `${subjectId}:${format(parseCalendarDateTime(event.start_time), 'yyyy-MM-dd HH:mm')}`;
      })
  );

  const start = new Date(rangeStart);
  start.setHours(0, 0, 0, 0);
  const end = new Date(rangeEnd);
  end.setHours(23, 59, 59, 999);

  const recurringEvents = subjects.flatMap(subject => {
    if (!subject.start_date) return [];
    const baseDatePart = subject.start_date.split(/[T ]/)[0];
    const firstClassDate = parseISO(baseDatePart);
    if (Number.isNaN(firstClassDate.getTime())) return [];

    firstClassDate.setHours(0, 0, 0, 0);
    const occurrence = new Date(firstClassDate);
    while (occurrence < start) occurrence.setDate(occurrence.getDate() + 7);

    const result: CalendarEvent[] = [];
    while (occurrence <= end) {
      const date = format(occurrence, 'yyyy-MM-dd');
      const startTime = buildSubjectDateTime(date, subject.start_time);
      if (startTime && overriddenClassTimes.has(`${subject.id}:${format(parseCalendarDateTime(startTime), 'yyyy-MM-dd HH:mm')}`)) {
        occurrence.setDate(occurrence.getDate() + 7);
        continue;
      }
      if (startTime) {
        const allDay = !subject.start_time;
        result.push({
          id: -(subject.id * 100000000 + Number(date.replaceAll('-', ''))),
          title: subject.name,
          description: null,
          subject_id: subject.id,
          start_time: startTime,
          end_time: allDay || !subject.end_time ? null : buildSubjectDateTime(date, subject.end_time),
          status: 'planned',
          type: 'class',
          event_type: 'class',
          all_day: allDay,
          source: 'subject',
          subject: { id: subject.id, name: subject.name },
          metadata: { source: 'subject', type: 'class', all_day: allDay },
        });
      }
      occurrence.setDate(occurrence.getDate() + 7);
    }
    return result;
  });

  return [...nonRecurringEvents, ...recurringEvents];
};


export const dateInMonth = (selectedDate: string, year: number, month: number) => {
  const day = parseISO(selectedDate).getDate();
  const lastDay = new Date(year, month + 1, 0).getDate();
  return format(new Date(year, month, Math.min(day, lastDay)), 'yyyy-MM-dd');
};

// Divide overlapping appointments into columns so every item remains clickable.
export const layoutTimedEvents = (events: CalendarEvent[]) => {
  const sorted = events.map(event => {
    const start = parseCalendarDateTime(event.start_time).getTime();
    const end = event.end_time ? parseCalendarDateTime(event.end_time).getTime() : start + 3600000;
    return { event, start, end: Math.max(end, start + 30 * 60000), column: 0, columns: 1 };
  }).sort((a, b) => a.start - b.start || b.end - a.end);
  let group: typeof sorted = [];
  let columnEnds: number[] = [];
  let groupEnd = 0;
  const finishGroup = () => group.forEach(item => { item.columns = columnEnds.length; });
  for (const item of sorted) {
    if (item.start >= groupEnd) {
      finishGroup();
      group = [];
      columnEnds = [];
    }
    let column = columnEnds.findIndex(end => end <= item.start);
    if (column === -1) column = columnEnds.length;
    item.column = column;
    columnEnds[column] = item.end;
    group.push(item);
    groupEnd = Math.max(...columnEnds);
  }
  finishGroup();
  return sorted;
};
