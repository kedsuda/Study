import { TimePicker } from '../../components/TimePicker';
// SubjectsPage.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useAppAlert } from '../../context/AppAlertContext';
import { useAuth } from '../../context/AuthContext';
import { api, apiFallbackClients } from '../../services/api';
import { emitSubjectsUpdated } from '../../utils/subjectSync';

type Subject = {
  id: number;
  semester_id?: number | null;
  semester?: number | null;
  academic_year?: number | null;
  name: string;
  description?: string | null;
  classroom?: string | null;
  room?: string | null;
  color?: string | null;
  target_hours?: number | null;
  start_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  study_log_count?: number;
};

type SubjectForm = {
  semester_id?: string;
  name: string;
  description?: string;
  classroom?: string;
  color?: string;
  target_hours?: number | undefined;
  start_date?: string;
  start_time?: string;
  end_time?: string;
  all_day?: boolean;
};

type SemesterCreateForm = {
  semester: string;
  academic_year: string;
};

type CalendarEventSummary = {
  id: number;
  source?: string | null;
  subject?: { id?: number | null } | null;
  start_time?: string | null;
  end_time?: string | null;
  all_day?: boolean;
  metadata?: Record<string, any>;
};

type SemesterOption = {
  semester_id: number;
  semester: number;
  academic_year: number;
};

const colorOptions = [
  { value: '#2563eb', label: 'ฟ้า' },
  { value: '#38bdf8', label: 'ฟ้าใส' },
  { value: '#f59e0b', label: 'ส้ม' },
  { value: '#f97316', label: 'เข้มอิฐมืด' },
  { value: '#ec4899', label: 'ชมพู' },
  { value: '#a855f7', label: 'ม่วง' }
] as const;
const greenPalette = new Set(['#10b981', '#22c55e', '#16a34a', '#34d399', '#86efac']);
const resolveSubjectColor = (color?: string | null) => {
  const trimmed = color?.trim();
  if (!trimmed) return colorOptions[0].value;
  return greenPalette.has(trimmed.toLowerCase()) ? '#f97316' : trimmed;
};

const timePattern = /^(?:[01]\d|2[0-3])[:.][0-5]\d(?:(?:[:.])[0-5]\d)?$/;

const normalizeTimeInput = (value?: string | null) => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\./g, ':');
  const segments = normalized.split(':');
  if (segments.length < 2) return normalized;
  const hour = (segments[0] ?? '00').padStart(2, '0');
  const minute = (segments[1] ?? '00').padStart(2, '0');
  const second = (segments[2] ?? '00').padStart(2, '0');
  return `${hour}:${minute}:${second}`;
};

const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const toIsoDate = (value?: string | null) => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (isIsoDate(trimmed)) return trimmed;
  const dateChunk = trimmed.includes('T') ? trimmed.split('T')[0] : trimmed.split(' ')[0];
  if (dateChunk && isIsoDate(dateChunk)) return dateChunk;

  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const rawYear = match[3];
  const parsedYear = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
  const year = parsedYear >= 2400 ? parsedYear - 543 : parsedYear;

  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const check = new Date(year, month - 1, day);
  if (Number.isNaN(check.getTime())) return null;
  if (check.getFullYear() !== year || check.getMonth() !== month - 1 || check.getDate() !== day) {
    return null;
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const toDisplayDate = (value?: string | null) => {
  const iso = toIsoDate(value);
  if (!iso) return null;
  const [year, month, day] = iso.split('-');
  const buddhistYear = Number(year) + 543;
  return `${day}/${month}/${String(buddhistYear).padStart(4, '0')}`;
};

const formatSubjectDate = (value?: string | null) => {
  if (!value) return null;
  return toDisplayDate(value) ?? value;
};

const formatSubjectTime = (value?: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  let timePart = trimmed;
  if (trimmed.includes('T')) timePart = trimmed.split('T')[1] ?? trimmed;
  else if (trimmed.includes(' ')) timePart = trimmed.split(' ')[1] ?? trimmed;

  const segments = timePart.replace(/\./g, ':').split(':');
  if (segments.length < 2) return null;
  const hour = segments[0]?.padStart(2, '0') ?? '00';
  const minute = segments[1]?.padStart(2, '0') ?? '00';
  return `${hour}:${minute}`;
};

const formatSubjectTimeRange = (start?: string | null, end?: string | null) => {
  const startLabel = formatSubjectTime(start);
  const endLabel = formatSubjectTime(end);
  if (!startLabel && !endLabel) return null;
  if (startLabel && endLabel) return `${startLabel} - ${endLabel}`;
  return startLabel ?? endLabel;
};

const thaiWeekdays = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const getThaiWeekday = (value?: string | null) => {
  const iso = toIsoDate(value);
  if (!iso) return null;
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return thaiWeekdays[date.getDay()] ?? null;
};

const formatSubjectDayLabel = (value?: string | null) => {
  const formattedDate = formatSubjectDate(value);
  if (!formattedDate) return null;
  const weekday = getThaiWeekday(value);
  return weekday ? `วัน${weekday} ${formattedDate}` : formattedDate;
};

const formatSemesterLabel = (semester?: number | null, academicYear?: number | null) => {
  if (!semester || !academicYear) return null;
  return `ภาคเรียนที่ ${semester} ปีการศึกษา ${academicYear}`;
};

const normalizeSubjectName = (value?: string | null) =>
  (value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('th-TH');

const normalizeDateInput = (value?: string | null) => {
  const iso = toIsoDate(value);
  if (!iso) return '';
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
};

const normalizeTimeSelect = (value?: string | null) => {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const timeChunk = trimmed.includes('T') ? trimmed.split('T')[1] : trimmed;
  const timeOnly = timeChunk.split(' ')[0] ?? '';
  const segments = timeOnly.replace(/\./g, ':').split(':');
  if (segments.length < 2) return '';
  const hour = segments[0]?.padStart(2, '0') ?? '00';
  const minute = segments[1]?.padStart(2, '0') ?? '00';
  const second = segments[2]?.padStart(2, '0') ?? '00';
  return `${hour}:${minute}:${second}`;
};

const extractDateFromDateTime = (value?: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const datePart = trimmed.split('T')[0]?.split(' ')[0] ?? trimmed;
  return datePart || null;
};

const extractTimeFromDateTime = (value?: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  let timePart = trimmed;
  if (trimmed.includes('T')) timePart = trimmed.split('T')[1] ?? trimmed;
  else if (trimmed.includes(' ')) timePart = trimmed.split(' ')[1] ?? trimmed;

  const cleaned = timePart.replace(/Z$/, '').split(/[+-]/)[0] ?? '';
  if (cleaned.length >= 8) return cleaned.slice(0, 8);
  return normalizeTimeInput(cleaned);
};

const unwrapCollection = (payload: any) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.data)) return payload.data.data;
  return [];
};

const buildDateTime = (date: string, time: string) => `${date} ${time}`;

const buildSchedulePayload = (startDate?: string | null, startTime?: string | null, endTime?: string | null) => {
  const trimmedDate = startDate?.trim() ?? '';
  const normalizedDate = trimmedDate ? toIsoDate(trimmedDate) : null;

  if (!normalizedDate) {
    return {
      startDate: null,
      startTime: null,
      endTime: null,
      allDay: false,
      startDateTime: null,
      endDateTime: null
    };
  }

  const normalizedStart = normalizeTimeInput(startTime);
  const normalizedEnd = normalizeTimeInput(endTime);
  const allDay = !normalizedStart;

  const startDateTime = buildDateTime(normalizedDate, allDay ? '00:00:00' : normalizedStart ?? '00:00:00');
  const endDateTime = !allDay && normalizedEnd ? buildDateTime(normalizedDate, normalizedEnd) : null;

  return {
    startDate: normalizedDate,
    startTime: allDay ? null : normalizedStart ?? null,
    endTime: allDay ? null : normalizedEnd ?? null,
    allDay,
    startDateTime,
    endDateTime
  };
};

const timeToMinutes = (value?: string | null) => {
  const normalized = normalizeTimeInput(value);
  if (!normalized) return null;
  const [hour, minute] = normalized.split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
};

const getWeekdayIndex = (value?: string | null) => {
  const iso = toIsoDate(value);
  if (!iso) return null;
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.getDay();
};

const buildScheduleConflictMessage = (subject: Subject) => {
  const timeRange = formatSubjectTimeRange(subject.start_time, subject.end_time);
  return `เวลานี้ซ้อนกับวิชา ${subject.name}${timeRange ? ` เวลา ${timeRange}` : ''} กรุณาเลือกเวลาอื่น เพราะซ้อนกับวิชาอื่น`;
};

const findLocalScheduleConflict = (
  subjects: Subject[],
  schedulePayload: ReturnType<typeof buildSchedulePayload>,
  semesterId?: number | null,
  ignoreSubjectId?: number | null
) => {
  if (!schedulePayload.startDate || !schedulePayload.startTime || !schedulePayload.endTime) return null;

  const newWeekday = getWeekdayIndex(schedulePayload.startDate);
  const newStart = timeToMinutes(schedulePayload.startTime);
  const newEnd = timeToMinutes(schedulePayload.endTime);
  if (newWeekday === null || newStart === null || newEnd === null || newEnd <= newStart) return null;

  return subjects.find(subject => {
    if (ignoreSubjectId && subject.id === ignoreSubjectId) return false;
    if (!subject.start_date || !subject.start_time || !subject.end_time) return false;
    if (semesterId && subject.semester_id && Number(subject.semester_id) !== Number(semesterId)) return false;

    const existingWeekday = getWeekdayIndex(subject.start_date);
    if (existingWeekday !== newWeekday) return false;

    const existingStart = timeToMinutes(subject.start_time);
    const existingEnd = timeToMinutes(subject.end_time);
    if (existingStart === null || existingEnd === null) return false;

    return newStart < existingEnd && existingStart < newEnd;
  }) ?? null;
};

const formatScheduleDateDisplay = normalizeDateInput;
const isValidDateInput = (value?: string | null) => Boolean(toIsoDate(value));

const extractRoomFromText = (text?: string | null): string | null => {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) return null;
  const match = raw.match(/(?:ห้อง(?:เรียน)?|room)\s*[:：]?\s*([A-Za-z0-9ก-๙\-\/]+)/iu);
  return match?.[1]?.trim() ?? null;
};

const mergeSubjectSchedules = (subjects: Subject[], events: CalendarEventSummary[]) => {
  if (!subjects.length || !events.length) return subjects;
  const eventMap = new Map<number, CalendarEventSummary>();

  events.forEach(event => {
    const subjectId = event?.subject?.id;
    if (!subjectId) return;

    const current = eventMap.get(subjectId);
    if (!current) {
      eventMap.set(subjectId, event);
      return;
    }

    const currentTime = Date.parse(current.start_time ?? '') || 0;
    const nextTime = Date.parse(event.start_time ?? '') || 0;
    if (nextTime > currentTime) eventMap.set(subjectId, event);
  });

  return subjects.map(subject => {
    const event = eventMap.get(subject.id);
    if (!event) return subject;

    const allDay = event.all_day ?? Boolean(event.metadata?.all_day);
    const nextDate = subject.start_date ?? extractDateFromDateTime(event.start_time);
    const nextStartTime = subject.start_time ?? (allDay ? null : extractTimeFromDateTime(event.start_time));
    const nextEndTime = subject.end_time ?? (allDay ? null : extractTimeFromDateTime(event.end_time));
    const eventRoomRaw = typeof (event as any)?.room === 'string' ? (event as any).room : event.metadata?.room;
    const nextRoom =
      (typeof eventRoomRaw === 'string' ? eventRoomRaw.trim() : '') ||
      extractRoomFromText((event as any)?.description) ||
      extractRoomFromText(event.metadata?.description) ||
      null;
    const currentRoom = subject.room ?? subject.classroom ?? null;

    if (
      nextDate === subject.start_date &&
      nextStartTime === subject.start_time &&
      nextEndTime === subject.end_time &&
      nextRoom === currentRoom
    ) {
      return subject;
    }

    return {
      ...subject,
      start_date: nextDate ?? null,
      start_time: nextStartTime ?? null,
      end_time: nextEndTime ?? null,
      room: nextRoom ?? currentRoom,
      classroom: nextRoom ?? currentRoom
    };
  });
};

// ✅ helper: fallback เฉพาะกรณี route ไม่เจอ/วิธีไม่ถูก (404/405) หรือ server error ชั่วคราว (500) หรือไม่รู้สถานะ
const isFallbackStatus = (status?: number) => !status || status === 404 || status === 405 || status === 500;

export const SubjectsPage = ({ variant = 'default' }: { variant?: 'default' | 'popup' }) => {
  const { user } = useAuth();
  const { success, error } = useAppAlert();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [semesterOptions, setSemesterOptions] = useState<SemesterOption[]>([]);
  const [semesterErrorMsg, setSemesterErrorMsg] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isLoadingSemesters, setIsLoadingSemesters] = useState<boolean>(false);
  const [isCreatingSemester, setIsCreatingSemester] = useState<boolean>(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);
  const [detailSubject, setDetailSubject] = useState<Subject | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSemesterFilter, setSelectedSemesterFilter] = useState<string>('');
  const [newSemester, setNewSemester] = useState<SemesterCreateForm>({ semester: '1', academic_year: '' });
  const [createSemesterError, setCreateSemesterError] = useState<string>('');
  const mountedRef = useRef(true);
  const createDatePickerRef = useRef<HTMLInputElement | null>(null);

  const todayIso = new Date().toISOString().slice(0, 10);
  const today = formatScheduleDateDisplay(todayIso) || todayIso;
  const currentAcademicYear = new Date().getFullYear() + 543;

  const defaultValues = useMemo<SubjectForm>(
    () => ({
      semester_id: '',
      name: '',
      description: '',
      classroom: '',
      color: colorOptions[0].value,
      target_hours: undefined,
      start_date: today,
      start_time: '',
      end_time: '',
      all_day: false
    }),
    [today]
  );

  const {
    register,
    control,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { isSubmitting, errors }
  } = useForm<SubjectForm>({
    defaultValues,
    mode: 'onSubmit'
  });

  const selectedColor = watch('color');
  const selectedSemesterId = watch('semester_id');
  const isAllDay = watch('all_day');
  const activeSemesterId = semesterOptions.some(option => String(option.semester_id) === selectedSemesterFilter)
    ? selectedSemesterFilter
    : (semesterOptions[0] ? String(semesterOptions[0].semester_id) : '');
  const filteredSubjects = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return subjects.filter(subject => {
      const semesterMatch =
        selectedSemesterFilter !== '' && String(subject.semester_id ?? '') === selectedSemesterFilter;

      if (!semesterMatch) return false;
      if (!query) return true;

      const haystacks = [
        subject.name,
        subject.description ?? '',
        formatSemesterLabel(subject.semester, subject.academic_year) ?? '',
        formatSubjectDayLabel(subject.start_date) ?? '',
        formatSubjectTimeRange(subject.start_time, subject.end_time) ?? ''
      ];

      return haystacks.some(value => value.toLowerCase().includes(query));
    });
  }, [searchQuery, selectedSemesterFilter, subjects]);
  const isAdmin = user?.role === 'admin';
  const adminSummary = useMemo(() => {
    const scheduledCount = filteredSubjects.filter(subject => Boolean(subject.start_date)).length;
    const targetHoursTotal = filteredSubjects.reduce((total, subject) => {
      if (typeof subject.target_hours !== 'number') return total;
      return total + subject.target_hours;
    }, 0);
    return { scheduledCount, targetHoursTotal };
  }, [filteredSubjects]);

  useEffect(() => {
    if (!isAllDay) return;
    setValue('start_time', '');
    setValue('end_time', '');
  }, [isAllDay, setValue]);

  useEffect(() => {
    setNewSemester(prev => ({
      ...prev,
      academic_year: prev.academic_year || String(currentAcademicYear)
    }));
  }, [currentAcademicYear]);

  const loadSemesters = useCallback(async () => {
    try {
      setIsLoadingSemesters(true);
      setSemesterErrorMsg('');
      let lastError: any = null;

      for (const client of apiFallbackClients) {
        try {
          const response = await client.get('/semesters');
          const rows = unwrapCollection(response.data);
          const nextOptions: SemesterOption[] = rows
            .map((row: any) => ({
              semester_id: Number(row?.semester_id),
              semester: Number(row?.semester),
              academic_year: Number(row?.academic_year),
            }))
            .filter((option: SemesterOption) =>
              Number.isFinite(option.semester_id) &&
              Number.isFinite(option.semester) &&
              Number.isFinite(option.academic_year)
            )
            .sort((a: SemesterOption, b: SemesterOption) => {
              if (a.semester !== b.semester) {
                return a.semester - b.semester;
              }
              return a.academic_year - b.academic_year;
            });

          setSemesterOptions(nextOptions);
          return;
        } catch (err: any) {
          lastError = err;
          const status = err?.response?.status;
          if (status && status !== 404 && status !== 405) break;
        }
      }

      setSemesterOptions([]);
      setSemesterErrorMsg(lastError?.response?.data?.message || lastError?.message || 'โหลดภาคเรียนไม่สำเร็จ');
    } finally {
      setIsLoadingSemesters(false);
    }
  }, []);

  const createSemester = async () => {
    const semester = Number(newSemester.semester);
    const academicYear = Number(newSemester.academic_year);

    if (!Number.isFinite(semester) || semester < 1 || semester > 3) {
      setCreateSemesterError('กรุณาเลือกเทอม 1, 2 หรือ 3');
      return;
    }

    if (!Number.isFinite(academicYear) || academicYear < 2000 || academicYear > 3000) {
      setCreateSemesterError('กรุณากรอกปีการศึกษา 4 หลัก');
      return;
    }

    setCreateSemesterError('');
    setIsCreatingSemester(true);

    try {
      const response = await api.post('/semesters', {
        semester,
        academic_year: academicYear,
      });

      const created = response.data?.data && typeof response.data.data === 'object'
        ? response.data.data
        : response.data;

      await loadSemesters();

      if (created?.semester_id) {
        setValue('semester_id', String(created.semester_id), { shouldDirty: true, shouldValidate: true });
        setSelectedSemesterFilter(String(created.semester_id));
      }

      success('เพิ่มภาคเรียนเรียบร้อยแล้ว');
    } catch (err: any) {
      setCreateSemesterError(err?.response?.data?.message || err?.message || 'เพิ่มภาคเรียนไม่สำเร็จ');
    } finally {
      setIsCreatingSemester(false);
    }
  };

  const persistSubjectSchedule = async (subject: Subject, schedulePayload: ReturnType<typeof buildSchedulePayload>) => {
    const subjectId = subject.id;
    const subjectName = subject.name;
    const subjectDescription = subject.description ?? '';
    const subjectClassroom = subject.classroom ?? subject.room ?? '';
    const subjectColor = subject.color ?? '';
    const subjectTargetHours =
      typeof subject.target_hours === 'number' ? String(subject.target_hours) : subject.target_hours ?? '';

    const schedulePatch = {
      start_date: schedulePayload.startDate,
      start_time: schedulePayload.startTime,
      end_time: schedulePayload.endTime
    };

    const form = new URLSearchParams();
    form.set('_method', 'PUT');
    form.set('name', subjectName);
    if (subjectDescription) form.set('description', subjectDescription);
    if (subjectClassroom) {
      form.set('classroom', subjectClassroom);
      form.set('room', subjectClassroom);
    }
    if (subjectColor) form.set('color', subjectColor);
    if (subjectTargetHours !== '') form.set('target_hours', subjectTargetHours);
    form.set('start_date', schedulePayload.startDate ?? '');
    form.set('start_time', schedulePayload.startDate ? schedulePayload.startTime ?? '' : '');
    form.set('end_time', schedulePayload.startDate ? schedulePayload.endTime ?? '' : '');

    const updateWithClient = async (client: typeof api) => {
      try {
        return await client.put<Subject>(`/subjects/${subjectId}`, form, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-HTTP-Method-Override': 'PUT' }
        });
      } catch (err: any) {
        const status = err?.response?.status;
        if (!isFallbackStatus(status)) throw err;
        return client.post<Subject>(`/subjects/${subjectId}`, form, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-HTTP-Method-Override': 'PUT' },
          params: { _method: 'PUT' }
        });
      }
    };

    const createCalendarEventFallback = async () => {
      if (!schedulePayload.startDate) {
        throw new Error('ไม่สามารถสร้างตารางเรียนได้');
      }

      const payload = {
        title: subjectName,
        subject_id: subjectId,
        type: 'class',
        room: subjectClassroom || null,
        all_day: schedulePayload.allDay,
        start_time: buildDateTime(
          schedulePayload.startDate,
          schedulePayload.allDay ? '00:00:00' : schedulePayload.startTime ?? '00:00:00'
        ),
        end_time:
          schedulePayload.allDay || !schedulePayload.endTime
            ? null
            : buildDateTime(schedulePayload.startDate, schedulePayload.endTime),
        status: 'planned'
      };

      let lastError: any = null;
      for (const client of apiFallbackClients) {
        try {
          await client.post('/calendar-events', payload);
          return schedulePatch;
        } catch (err: any) {
          lastError = err;
          const status = err?.response?.status;
          if (!isFallbackStatus(status)) throw err;
        }
      }

      throw lastError ?? new Error('ไม่สามารถสร้างตารางเรียนได้');
    };

    const clients = apiFallbackClients;
    let lastError: any = null;

    for (const client of clients) {
      try {
        const response = await updateWithClient(client);
        const data =
          (response.data as any)?.data && typeof (response.data as any)?.data === 'object'
            ? (response.data as any).data
            : (response.data as any);

        return {
          start_date: data?.start_date ?? schedulePatch.start_date,
          start_time: data?.start_time ?? schedulePatch.start_time,
          end_time: data?.end_time ?? schedulePatch.end_time
        };
      } catch (err: any) {
        lastError = err;
        const status = err?.response?.status;
        if (!isFallbackStatus(status)) throw err;
      }
    }

    try {
      return await createCalendarEventFallback();
    } catch (err: any) {
      lastError = err ?? lastError;
    }

    throw lastError ?? new Error('บันทึกวันเวลาไม่สำเร็จ');
  };

  const loadSubjects = useCallback(async (silent = false) => {
    try {
      if (!silent) setIsLoading(true);
      setErrorMsg('');

      const clients = apiFallbackClients;
      let lastError: any = null;

      for (const client of clients) {
        try {
          const subjectRequests =
            user?.role === 'admin'
              ? [client.get('/subjects'), client.get('/subjects', { params: { include_all: 1 } })]
              : [client.get('/subjects')];
          const [subjectsRes, allSubjectsRes, eventsRes] = await Promise.allSettled([
            ...subjectRequests,
            client.get('/calendar-events')
          ]);

          if (subjectsRes.status !== 'fulfilled') throw subjectsRes.reason;

          const ownSubjects = unwrapCollection(subjectsRes.value.data);
          const allSubjects =
            user?.role === 'admin' && allSubjectsRes?.status === 'fulfilled'
              ? unwrapCollection(allSubjectsRes.value.data)
              : [];
          const nextSubjects = ownSubjects.length > 0 ? ownSubjects : allSubjects;
          const eventResult = user?.role === 'admin' ? eventsRes : allSubjectsRes;
          const events = eventResult?.status === 'fulfilled' ? unwrapCollection(eventResult.value.data) : [];

          if (!mountedRef.current) return;

          setSubjects(prev => {
            if (prev.length > 0 && nextSubjects.length === 0) return prev;
            return mergeSubjectSchedules(nextSubjects, events);
          });

          return;
        } catch (err: any) {
          lastError = err;
          const status = err?.response?.status;
          if (status && status !== 404 && status !== 405) break;
        }
      }

      if (!mountedRef.current) return;
      setErrorMsg(
        lastError?.response?.data?.message ||
          lastError?.message ||
          'โหลดรายวิชาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
      );
    } finally {
      if (mountedRef.current && !silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    loadSubjects();
    loadSemesters();
    return () => {
      mountedRef.current = false;
    };
  }, [loadSubjects, loadSemesters]);

  useEffect(() => {
    if (!semesterOptions.length) return;
    if (selectedSemesterId) return;
    setValue('semester_id', String(semesterOptions[0].semester_id));
  }, [semesterOptions, selectedSemesterId, setValue]);

  useEffect(() => {
    if (!semesterOptions.length) return;
    if (semesterOptions.some(option => String(option.semester_id) === selectedSemesterFilter)) return;
    setSelectedSemesterFilter(String(semesterOptions[0].semester_id));
  }, [semesterOptions, selectedSemesterFilter]);

  const onSubmit = async (values: SubjectForm) => {
    try {
      setErrorMsg('');

      const name = values.name?.trim();
      if (!name) {
        setErrorMsg('กรุณากรอกชื่อวิชา');
        return;
      }

      const parsedSemesterId = Number(values.semester_id);
      const fallbackSemesterId = editingSubject?.semester_id ?? semesterOptions[0]?.semester_id ?? null;
      const semesterId =
        Number.isFinite(parsedSemesterId) && parsedSemesterId > 0
          ? parsedSemesterId
          : (fallbackSemesterId ?? NaN);

      if (!editingSubject && (!Number.isFinite(semesterId) || semesterId <= 0)) {
        setErrorMsg('กรุณาเลือกภาคเรียน');
        return;
      }

      const duplicateSubject = subjects.find(subject => {
        if (editingSubject && subject.id === editingSubject.id) return false;
        return Number(subject.semester_id ?? 0) === Number(semesterId) && normalizeSubjectName(subject.name) === normalizeSubjectName(name);
      });
      if (duplicateSubject) {
        const msg = 'วิชาซ้ำในภาคเรียนนี้ กรุณาใช้ชื่อวิชาอื่นหรือแก้ไขวิชาเดิม';
        setErrorMsg(msg);
        error(msg);
        return;
      }

      const schedulePayload = buildSchedulePayload(
        values.start_date ?? null,
        values.all_day ? null : (values.start_time ?? null),
        values.all_day ? null : (values.end_time ?? null)
      );

      const payload = {
        semester_id: semesterId,
        name,
        description: values.description?.trim() ? values.description.trim() : null,
        classroom: values.classroom?.trim() ? values.classroom.trim() : null,
        room: values.classroom?.trim() ? values.classroom.trim() : null,
        color: values.color || colorOptions[0].value,
        target_hours:
          typeof values.target_hours === 'number' && Number.isFinite(values.target_hours)
            ? values.target_hours
            : null,
        start_date: schedulePayload.startDate,
        start_time: schedulePayload.startTime,
        end_time: schedulePayload.endTime
      };
      const normalizedRoom = values.classroom?.trim() ? values.classroom.trim() : null;
      const scheduleConflict = findLocalScheduleConflict(subjects, schedulePayload, semesterId, editingSubject?.id);
      if (scheduleConflict) {
        const msg = buildScheduleConflictMessage(scheduleConflict);
        setErrorMsg(msg);
        error(msg);
        return;
      }

      if (editingSubject) {
        const form = new URLSearchParams();
        form.set('_method', 'PUT');
        if (Number.isFinite(semesterId) && semesterId > 0) {
          form.set('semester_id', String(semesterId));
        }
        form.set('name', name);
        form.set('description', values.description?.trim() ? values.description.trim() : '');
        form.set('classroom', values.classroom?.trim() ? values.classroom.trim() : '');
        form.set('room', values.classroom?.trim() ? values.classroom.trim() : '');
        form.set('color', values.color || colorOptions[0].value);
        form.set(
          'target_hours',
          typeof values.target_hours === 'number' && Number.isFinite(values.target_hours) ? String(values.target_hours) : ''
        );
        form.set('start_date', schedulePayload.startDate ?? '');
        form.set('start_time', schedulePayload.startTime ?? '');
        form.set('end_time', schedulePayload.endTime ?? '');

        let updatedResponse: any = null;
        let lastError: any = null;

        for (const client of apiFallbackClients) {
          try {
            updatedResponse = await client.put(`/subjects/${editingSubject.id}`, form, {
              headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-HTTP-Method-Override': 'PUT' },
            });
            break;
          } catch (err: any) {
            lastError = err;
            const status = err?.response?.status;
            if (status && status !== 404 && status !== 405 && status !== 500) throw err;
          }

          try {
            updatedResponse = await client.post(`/subjects/${editingSubject.id}`, form, {
              headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-HTTP-Method-Override': 'PUT' },
              params: { _method: 'PUT' },
            });
            break;
          } catch (err: any) {
            lastError = err;
            const status = err?.response?.status;
            if (status && status !== 404 && status !== 405 && status !== 500) throw err;
          }
        }

        if (!updatedResponse) throw lastError ?? new Error('แก้ไขวิชาไม่สำเร็จ');

        const updated: Subject =
          (updatedResponse.data as any)?.data && typeof (updatedResponse.data as any)?.data === 'object'
            ? (updatedResponse.data as any).data
            : (updatedResponse.data as any);
        const patchedUpdated: Subject = {
          ...updated,
          classroom: normalizedRoom,
          room: normalizedRoom,
          start_date: schedulePayload.startDate,
          start_time: schedulePayload.startTime,
          end_time: schedulePayload.endTime,
        };

        setSubjects(prev => prev.map(subject => (subject.id === editingSubject.id ? { ...subject, ...patchedUpdated } : subject)));
        emitSubjectsUpdated();
        success('อัปเดตรายวิชาเรียบร้อยแล้ว');
      } else {
        const response = await api.post<Subject>('/subjects', payload);

        const created: Subject =
          (response.data as any)?.data && typeof (response.data as any)?.data === 'object'
            ? (response.data as any).data
            : (response.data as any);

        let nextSubject: Subject = { ...created, classroom: normalizedRoom, room: normalizedRoom };
        if (schedulePayload.startDate || schedulePayload.startTime || schedulePayload.endTime) {
          try {
            const schedulePatch = await persistSubjectSchedule(created, schedulePayload);
            nextSubject = { ...created, ...schedulePatch };
          } catch {
            // ignore
          }
        }

        setSubjects(prev => [nextSubject, ...prev]);
        emitSubjectsUpdated();
        success('เพิ่มรายวิชาเรียบร้อยแล้ว');
      }

      loadSubjects(true);
      setIsCreateModalOpen(false);
      setEditingSubject(null);

      reset({
        semester_id: activeSemesterId,
        name: '',
        description: '',
        classroom: '',
        color: colorOptions[0].value,
        target_hours: undefined,
        start_date: today,
        start_time: '',
        end_time: '',
        all_day: false
      });

      setValue('color', colorOptions[0].value);
      setValue('semester_id', activeSemesterId);
      setValue('start_date', today);
      setValue('start_time', '');
      setValue('end_time', '');
      setValue('all_day', false);
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        `${editingSubject ? 'แก้ไข' : 'เพิ่ม'}วิชาไม่สำเร็จ (Server Error)`;
      setErrorMsg(msg);
      error(msg);
    }
  };

  const openCreateModal = () => {
    setEditingSubject(null);
    reset({
      semester_id: activeSemesterId,
      name: '',
      description: '',
      classroom: '',
      color: colorOptions[0].value,
      target_hours: undefined,
      start_date: today,
      start_time: '',
      end_time: '',
      all_day: false
    });
    setValue('color', colorOptions[0].value);
    setValue('semester_id', activeSemesterId);
    setValue('start_date', today);
    setValue('start_time', '');
    setValue('end_time', '');
    setValue('all_day', false);
    setErrorMsg('');
    setIsCreateModalOpen(true);
  };

  const closeCreateModal = () => {
    if (isSubmitting) return;
    setIsCreateModalOpen(false);
    setEditingSubject(null);
    setErrorMsg('');
  };

  const deleteSubject = async (subject: Subject) => {
    if (!window.confirm(`ต้องการลบวิชา "${subject.name}" ใช่หรือไม่?\n\nลบได้เฉพาะวิชาที่ไม่มีข้อมูลอื่นเชื่อมโยงอยู่`)) {
      return;
    }

    try {
      await api.delete(`/subjects/${subject.id}`);
      setSubjects(prev => prev.filter(item => item.id !== subject.id));
      if (detailSubject?.id === subject.id) setDetailSubject(null);
      if (editingSubject?.id === subject.id) closeCreateModal();
      emitSubjectsUpdated();
      success(`ลบวิชา ${subject.name} เรียบร้อยแล้ว`);
    } catch (requestError: any) {
      const message = requestError?.response?.data?.message ?? 'ลบวิชาไม่สำเร็จ';
      setErrorMsg(message);
      error(message);
    }
  };

  const openEditModal = (subject: Subject) => {
    setEditingSubject(subject);
    setErrorMsg('');
    const fallbackSemesterId = subject.semester_id ?? semesterOptions[0]?.semester_id;
    reset({
      semester_id: fallbackSemesterId ? String(fallbackSemesterId) : '',
      name: subject.name ?? '',
      description: subject.description ?? '',
      classroom: subject.classroom ?? subject.room ?? '',
      color: resolveSubjectColor(subject.color),
      target_hours: typeof subject.target_hours === 'number' ? subject.target_hours : undefined,
      start_date: normalizeDateInput(subject.start_date),
      start_time: normalizeTimeSelect(subject.start_time),
      end_time: normalizeTimeSelect(subject.end_time),
      all_day: !subject.start_time,
    });
    setValue('color', resolveSubjectColor(subject.color));
    setValue('semester_id', fallbackSemesterId ? String(fallbackSemesterId) : '');
    setIsCreateModalOpen(true);
  };


  const isPopupVariant = variant === 'popup';

  return (
    <div className={`subjects-page relative mx-auto w-full overflow-hidden pb-4 text-slate-900 ${isPopupVariant ? 'max-w-md space-y-4' : 'max-w-6xl space-y-5'}`}>
      <section
        className={`subjects-hero relative overflow-hidden border shadow-[0_18px_36px_rgba(15,23,42,0.08)] ${
          isPopupVariant ? 'rounded-[22px] p-4' : 'rounded-[24px] p-4 md:rounded-[28px] md:p-6'
        }`}
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <div className={`relative z-10 flex gap-4 ${isPopupVariant ? 'items-center justify-between' : 'flex-col lg:flex-row lg:items-start lg:justify-between'}`}>
          <div>
            <p
              className="subjects-hero-badge inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]"
              style={{
                border: '1px solid rgba(16, 185, 129, 0.18)',
                background: 'rgba(236, 253, 245, 0.95)',
                color: '#059669'
              }}
            >
              Smart Subjects
            </p>
            <h2 className={`subjects-hero-title font-black tracking-tight text-[color:var(--text)] ${isPopupVariant ? 'mt-2 text-lg' : 'mt-2.5 text-[1.35rem] md:mt-3 md:text-[2rem]'}`}>การจัดการรายวิชา</h2>
            <p className={`subjects-hero-subtitle max-w-xl font-medium text-[color:var(--muted)] ${isPopupVariant ? 'mt-1 text-xs' : 'mt-1 text-[13px] md:text-sm'}`}>
              เพิ่ม ลบ หรือแก้ไขข้อมูลรายวิชาพร้อมวันเวลาเรียนในหน้าจอเดียว
            </p>
          </div>
          <button
            type="button"
            onClick={openCreateModal}
            className={`inline-flex items-center justify-center bg-emerald-500 font-bold text-white shadow-[0_10px_22px_rgba(16,185,129,0.22)] transition hover:-translate-y-0.5 hover:bg-emerald-600 disabled:opacity-60 ${
              isPopupVariant ? 'h-11 w-11 rounded-full text-lg' : 'rounded-[16px] px-4 py-2.5 text-sm'
            }`}
            disabled={isLoadingSemesters || semesterOptions.length === 0}
          >
            {isPopupVariant ? '+' : '+ เพิ่มวิชาใหม่'}
          </button>
        </div>

        <div className={`mt-4 grid grid-cols-2 gap-2.5 ${isPopupVariant ? '' : 'xl:grid-cols-3'}`}>
          <div className="subjects-stat rounded-[18px] border px-3.5 py-3.5 shadow-sm md:rounded-[22px] md:px-4 md:py-4" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
            <p className="subjects-stat-label text-[11px] font-bold uppercase tracking-[0.16em] text-[color:var(--muted)]">วิชาที่แสดง</p>
            <p className="subjects-stat-value mt-1.5 text-xl font-black text-[color:var(--text)] md:mt-2 md:text-2xl">{filteredSubjects.length}</p>
          </div>
          <div className="subjects-stat rounded-[18px] border px-3.5 py-3.5 shadow-sm md:rounded-[22px] md:px-4 md:py-4" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
            <p className="subjects-stat-label text-[11px] font-bold uppercase tracking-[0.16em] text-[color:var(--muted)]">ตั้งเวลาแล้ว</p>
            <p className="subjects-stat-value mt-1.5 text-xl font-black text-[color:var(--text)] md:mt-2 md:text-2xl">{adminSummary.scheduledCount}</p>
          </div>
          <div className="subjects-stat rounded-[18px] border px-3.5 py-3.5 shadow-sm md:rounded-[22px] md:px-4 md:py-4" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
            <p className="subjects-stat-label text-[11px] font-bold uppercase tracking-[0.16em] text-[color:var(--muted)]">เป้าหมายรวม</p>
            <div className="mt-1.5 flex items-baseline gap-1 md:mt-2">
              <p className="subjects-stat-value text-xl font-black text-[color:var(--text)] md:text-2xl">{adminSummary.targetHoursTotal}</p>
              <p className="subjects-stat-label text-[11px] font-semibold text-[color:var(--muted)]">ชม./เดือน</p>
            </div>
          </div>
        </div>
      </section>

      {errorMsg && !isCreateModalOpen && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {errorMsg}
        </div>
      )}
      {semesterErrorMsg && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {semesterErrorMsg}
        </div>
      )}

      <section
        className={`subjects-board overflow-hidden border shadow-[0_16px_36px_rgba(15,23,42,0.08)] ${
          isPopupVariant ? 'rounded-[22px]' : 'rounded-[26px]'
        }`}
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <div
          className="flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between md:p-4"
          style={{
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface)'
          }}
        >
          <div className="relative w-full md:max-w-md">
            <input
              type="text"
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder="ค้นหาชื่อวิชา หรือรายละเอียด..."
              className="w-full rounded-xl border px-4 py-3 text-sm font-semibold outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              style={{ color: 'var(--text)', backgroundColor: 'var(--surface-2)', borderColor: 'var(--border)' }}
            />
          </div>

          <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
            <select
              value={selectedSemesterFilter}
              onChange={event => setSelectedSemesterFilter(event.target.value)}
              className="flex-1 rounded-xl border px-4 py-3 text-sm font-semibold outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 md:w-[180px] md:flex-none"
              style={{ color: 'var(--text)', backgroundColor: 'var(--surface-2)', borderColor: 'var(--border)' }}
            >
              {semesterOptions.map(option => (
                <option key={`filter-${option.semester_id}`} value={option.semester_id}>
                  {formatSemesterLabel(option.semester, option.academic_year)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="rounded-xl bg-emerald-500 px-6 py-3 text-sm font-bold text-white shadow-[0_8px_18px_rgba(16,185,129,0.18)] transition hover:bg-emerald-600"
            >
              ค้นหา
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="p-10 text-center text-sm text-slate-500">กำลังโหลดรายวิชา...</div>
        ) : filteredSubjects.length === 0 ? (
          <div className="p-10 text-center text-sm text-[color:var(--muted)]">
            {subjects.length === 0 ? 'ยังไม่มีวิชา เริ่มเพิ่มวิชาแรกเพื่อจัดตารางเรียนของคุณ' : 'ไม่พบวิชาที่ตรงกับเงื่อนไขค้นหา'}
          </div>
        ) : (
          <div className={`subjects-list subject-scroll overflow-y-auto bg-transparent ${isPopupVariant ? 'max-h-[52dvh] p-3' : 'max-h-[calc(100vh-330px)] p-3 md:p-5'}`}>
            <div className="mb-4 flex items-end justify-between px-1">
              <h3 className="text-base font-bold text-slate-800 md:text-lg">รายวิชาของคุณ</h3>
              <span className="text-xs text-slate-500 md:text-sm">ทั้งหมด {filteredSubjects.length} วิชา</span>
            </div>
            <div className="grid grid-cols-2 gap-2.5 md:gap-5">
              {filteredSubjects.map(subject => {
                const semesterLabel = formatSemesterLabel(subject.semester, subject.academic_year);
                return (
                  <article
                    key={subject.id}
                    className="subjects-item group flex h-full flex-col overflow-hidden rounded-[18px] border border-slate-100 bg-white shadow-[0_8px_20px_rgba(15,23,42,0.07)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_26px_rgba(15,23,42,0.12)] md:rounded-[22px]"
                  >
                    <div className="flex flex-1 flex-col p-3 md:p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start gap-2.5">
                          <span
                            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-sm md:mt-1 md:h-10 md:w-10"
                            style={{
                              background: `linear-gradient(135deg, ${resolveSubjectColor(subject.color)}, rgba(255,255,255,0.82))`
                            }}
                          >
                            <span className="text-base font-bold text-white md:text-lg">{subject.name.charAt(0)}</span>
                          </span>
                          <div className="min-w-0">
                            <p className="subjects-item-title truncate text-[15px] font-bold leading-5 text-slate-800 md:text-base">{subject.name}</p>
                            <p className="subjects-item-desc mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500 md:text-sm">
                              {subject.description ?? 'ยังไม่มีคำอธิบาย เพิ่มข้อมูลในภายหลังได้'}
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              <span className="rounded-lg bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-600">
                                {semesterLabel ?? 'ไม่ระบุภาคเรียน'}
                              </span>
                              {typeof subject.target_hours === 'number' ? (
                                <span
                                  className="rounded-lg px-2 py-1 text-[10px] font-bold"
                                  style={{
                                    background: 'rgba(var(--accent-rgb),0.10)',
                                    color: 'var(--accent)'
                                  }}
                                >
                                  {subject.target_hours} ชม.
                                </span>
                              ) : null}
                            </div>
                          </div>
                          </div>
                        </div>

                        <button type="button" className="text-slate-400 transition hover:text-slate-600">
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <circle cx="12" cy="5" r="1" />
                            <circle cx="12" cy="12" r="1" />
                            <circle cx="12" cy="19" r="1" />
                          </svg>
                        </button>
                      </div>

                      <div className="mt-3 space-y-1.5">
                        <div className="flex items-center text-[11px] text-slate-600 md:text-xs">
                          <svg viewBox="0 0 24 24" className="mr-1.5 h-[13px] w-[13px] text-slate-400 md:mr-2 md:h-[14px] md:w-[14px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" />
                            <circle cx="12" cy="10" r="2.5" />
                          </svg>
                          {subject.classroom?.trim() || subject.room?.trim() || 'ยังไม่ระบุห้อง'}
                        </div>
                        <div className="flex items-center text-[11px] text-slate-600 md:text-xs">
                          <svg viewBox="0 0 24 24" className="mr-1.5 h-[13px] w-[13px] text-slate-400 md:mr-2 md:h-[14px] md:w-[14px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <rect x="3" y="4" width="18" height="18" rx="2" />
                            <path d="M16 2v4M8 2v4M3 10h18" />
                          </svg>
                          {formatSubjectDayLabel(subject.start_date) ?? 'ยังไม่ระบุวันเรียน'}
                        </div>
                        <div className="flex items-center text-[11px] text-slate-600 md:text-xs">
                          <svg viewBox="0 0 24 24" className="mr-1.5 h-[13px] w-[13px] text-slate-400 md:mr-2 md:h-[14px] md:w-[14px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <circle cx="12" cy="12" r="9" />
                            <path d="M12 7v5l3 3" />
                          </svg>
                          {subject.start_date ? (
                            formatSubjectTimeRange(subject.start_time, subject.end_time) ?? (
                              <span className="rounded bg-emerald-50 px-2 py-0.5 font-medium text-emerald-600">ทั้งวัน</span>
                            )
                          ) : (
                            'ยังไม่ระบุเวลา'
                          )}
                        </div>
                      </div>

                      <div className="mt-3 flex items-center gap-1.5 border-t border-[color:var(--border)] bg-[color:var(--surface-2)] px-0 pt-2.5 md:mt-4 md:gap-2 md:pt-3">
                        <button
                          type="button"
                          onClick={() => openEditModal(subject)}
                          className="flex-1 rounded-lg px-2 py-2 text-[11px] font-medium text-[color:var(--muted)] transition hover:bg-[color:var(--surface)] hover:text-[color:var(--text)] md:px-3 md:text-xs"
                        >
                          แก้ไข
                        </button>
                        <button
                          type="button"
                          onClick={() => setDetailSubject(subject)}
                          className="flex-[1.3] rounded-lg px-2 py-2 text-[11px] font-semibold transition md:px-4 md:text-xs"
                          style={{ background: 'rgba(var(--accent-rgb),0.18)', color: 'var(--text)' }}
                        >
                          รายละเอียด
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteSubject(subject)}
                          className="rounded-lg px-2 py-2 text-[11px] font-semibold text-rose-600 transition hover:bg-rose-50 md:px-3 md:text-xs"
                          title="ลบได้เมื่อไม่มีข้อมูลที่เชื่อมโยง"
                        >
                          ลบ
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <style>{`
        .theme-light .subjects-page {
          color: #0f172a !important;
        }
        .theme-light .subjects-page .subjects-hero {
          background: #ffffff !important;
          border-color: #e2e8f0 !important;
          box-shadow: 0 18px 36px rgba(15, 23, 42, 0.12) !important;
        }
        .theme-light .subjects-page .subjects-hero-badge {
          border-color: rgba(251, 146, 60, 0.45) !important;
          background: rgba(255, 237, 213, 0.9) !important;
          color: #ea580c !important;
        }
        .theme-light .subjects-page .subjects-hero-title {
          color: #0f172a !important;
        }
        .theme-light .subjects-page .subjects-hero-subtitle {
          color: #475569 !important;
        }
        .theme-light .subjects-page .subjects-stat {
          background: #ffffff !important;
          border-color: #e2e8f0 !important;
        }
        .theme-light .subjects-page .subjects-stat-label {
          color: #64748b !important;
        }
        .theme-light .subjects-page .subjects-stat-value {
          color: #0f172a !important;
        }
        .theme-light .subjects-page .subjects-board {
          background: #ffffff !important;
          border-color: #e2e8f0 !important;
          box-shadow: 0 16px 36px rgba(15, 23, 42, 0.14) !important;
        }
        .theme-light .subjects-page .subjects-list {
          background: rgba(248, 250, 252, 0.55) !important;
        }
        .theme-light .subjects-page .subjects-item {
          background: #ffffff !important;
          border-color: #e2e8f0 !important;
          box-shadow: 0 8px 22px rgba(15, 23, 42, 0.1) !important;
        }
        .theme-light .subjects-page .subjects-item-title {
          color: #0f172a !important;
        }
        .theme-light .subjects-page .subjects-item-desc {
          color: #475569 !important;
        }
        .theme-light .subjects-page .subjects-item-meta {
          color: #64748b !important;
        }
        .theme-light .subjects-page .subjects-item-date {
          color: #1f2937 !important;
        }

        .theme-dark .subjects-page .subjects-hero {
          background: linear-gradient(135deg, #091833 0%, #0b1f42 55%, #0d234b 100%) !important;
        }
        .theme-dark .subjects-page .subjects-board {
          background: linear-gradient(180deg, #10223f 0%, #0b1931 100%) !important;
        }

        .subject-scroll::-webkit-scrollbar {
          width: 8px;
        }
        .subject-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .subject-scroll::-webkit-scrollbar-thumb {
          background: rgba(148, 163, 184, 0.35);
          border-radius: 999px;
        }
        .subject-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(148, 163, 184, 0.52);
        }
      `}</style>

      {isCreateModalOpen && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 px-4 py-6 backdrop-blur-sm sm:px-5 sm:py-8"
          onClick={closeCreateModal}
        >
          <div
            className={`mx-auto flex w-full flex-col overflow-hidden border border-[color:var(--border)] bg-[color:var(--surface)] shadow-[0_24px_80px_rgba(15,23,42,0.35)] ${
              isPopupVariant ? 'max-w-lg rounded-3xl' : 'max-w-3xl rounded-[22px] sm:rounded-[26px]'
            }`}
            onClick={event => event.stopPropagation()}
            style={{
              maxHeight: isPopupVariant
                ? 'calc(100dvh - 11rem - env(safe-area-inset-bottom, 0px))'
                : 'calc(100dvh - 2.5rem - env(safe-area-inset-bottom, 0px))'
            }}
          >
            <div className={`flex items-start justify-between gap-3 border-b border-[color:var(--border)] ${isPopupVariant ? 'bg-[color:var(--surface)] px-5 py-4' : 'bg-[color:var(--surface-2)]/60 px-4 py-3.5 sm:px-6 sm:py-4.5'}`}>
              <div>
                <h3 className="text-lg font-semibold text-[color:var(--text)]">{editingSubject ? 'แก้ไขรายวิชา' : 'เพิ่มรายวิชาใหม่'}</h3>
                <p className="mt-1 text-sm text-muted">
                  {editingSubject ? 'อัปเดตรายละเอียด วันเวลา และข้อมูลวิชาใน modal นี้' : 'ระบุข้อมูลรายวิชา วันเวลา และรายละเอียดเพื่อใช้ในตารางเรียน'}
                </p>
              </div>
            </div>

            <div
              className={isPopupVariant ? 'overflow-y-auto px-5 py-3' : 'overflow-y-auto px-4 py-3.5 sm:px-6 sm:py-5'}
              style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
            >
              {errorMsg && (
                <div className="mb-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {errorMsg}
                </div>
              )}

              <form
                id="subject-form"
                onSubmit={handleSubmit(onSubmit)}
                className={`grid ${isPopupVariant ? 'gap-3' : 'gap-4 md:grid-cols-2'}`}
              >
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs uppercase tracking-widest text-muted">ภาคเรียน</label>
                  <select
                    disabled={isLoadingSemesters || semesterOptions.length === 0}
                    className={`w-full rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-2)] px-3 py-3 text-[color:var(--text)] shadow-sm outline-none transition focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:var(--accent)]/30 disabled:opacity-60 ${isPopupVariant ? '' : 'max-w-xl'}`}
                    {...register('semester_id', {
                      validate: value => (editingSubject ? true : value ? true : 'กรุณาเลือกภาคเรียน')
                    })}
                  >
                    <option value="">เลือกภาคเรียน</option>
                    {semesterOptions.map(option => (
                      <option key={option.semester_id} value={option.semester_id}>
                        {formatSemesterLabel(option.semester, option.academic_year)}
                      </option>
                    ))}
                  </select>
                  {errors.semester_id?.message && <p className="mt-1 text-xs text-red-200">{errors.semester_id.message}</p>}
                  {!isLoadingSemesters && semesterOptions.length === 0 && (
                    <p className="mt-1 text-xs text-amber-200">ยังไม่พบข้อมูลภาคเรียนในฐานข้อมูล</p>
                  )}
                  {!isPopupVariant && (
                    <div className="mt-4 w-full min-w-0 rounded-[24px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4 sm:p-5">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">เพิ่มภาคเรียนเอง</p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-[160px,minmax(220px,1fr),160px]">
                        <select
                          value={newSemester.semester}
                          onChange={event => setNewSemester(prev => ({ ...prev, semester: event.target.value }))}
                          className="w-full rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-2)] px-4 py-3.5 text-base text-[color:var(--text)] shadow-sm outline-none transition focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:var(--accent)]/30"
                        >
                          <option value="1">เทอม 1</option>
                          <option value="2">เทอม 2</option>
                          <option value="3">เทอม 3</option>
                        </select>
                        <input
                          value={newSemester.academic_year}
                          onChange={event => setNewSemester(prev => ({ ...prev, academic_year: event.target.value }))}
                          inputMode="numeric"
                          placeholder="ปีการศึกษา เช่น 2569"
                          className="w-full rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-2)] px-4 py-3.5 text-base text-[color:var(--text)] shadow-sm outline-none transition focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:var(--accent)]/30"
                        />
                        <button
                          type="button"
                          onClick={createSemester}
                          disabled={isCreatingSemester}
                          className="w-full rounded-2xl border border-[color:var(--accent)]/20 bg-[color:rgba(var(--accent-rgb),0.08)] px-5 py-3.5 text-base font-semibold text-[color:var(--accent)] transition hover:bg-[color:rgba(var(--accent-rgb),0.14)] disabled:opacity-60"
                        >
                          {isCreatingSemester ? 'กำลังเพิ่ม...' : 'เพิ่มเทอม'}
                        </button>
                      </div>
                      {createSemesterError ? (
                        <p className="mt-2 text-xs text-red-200">{createSemesterError}</p>
                      ) : (
                        <p className="mt-2 text-xs text-muted">สร้างเทอมใหม่แล้วระบบจะเลือกให้ทันที</p>
                      )}
                    </div>
                  )}
                </div>

                <div className="md:col-span-1">
                  <label className="mb-1 block text-xs uppercase tracking-widest text-muted">ชื่อวิชา</label>
                  <input
                    className="w-full rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-2)] px-3 py-3 text-[color:var(--text)] shadow-sm outline-none transition focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:var(--accent)]/30"
                    {...register('name', { required: 'กรุณากรอกชื่อวิชา' })}
                  />
                  {errors.name?.message && <p className="mt-1 text-xs text-red-200">{errors.name.message}</p>}
                </div>

                <div className="md:col-span-1">
                  <label className="mb-1 block text-xs uppercase tracking-widest text-muted">ห้องเรียน</label>
                  <input
                    className="w-full rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-2)] px-3 py-3 text-[color:var(--text)] shadow-sm outline-none transition focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:var(--accent)]/30"
                    placeholder="เช่น SCB 2401"
                    {...register('classroom')}
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs uppercase tracking-widest text-muted">สีประจำวิชา</label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {colorOptions.map(option => (
                      <button
                        type="button"
                        key={option.value}
                        onClick={() => setValue('color', option.value, { shouldDirty: true })}
                        className={`inline-flex h-11 items-center gap-2 rounded-2xl border px-3 text-sm font-semibold transition ${
                          selectedColor === option.value
                            ? 'border-[color:var(--accent)] bg-[color:var(--accent)]/15 text-[color:var(--text)]'
                            : 'border-[color:var(--border)] bg-[color:var(--surface-2)] text-muted hover:text-[color:var(--text)]'
                        }`}
                        aria-label={`เลือกสี ${option.label}`}
                      >
                        <span
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: option.value }}
                          aria-hidden="true"
                        />
                        <span>{option.label}</span>
                      </button>
                    ))}
                    <input type="hidden" {...register('color')} />
                  </div>
                  <div className="mt-3 flex flex-wrap justify-end gap-3">
                    <button
                      type="button"
                      onClick={closeCreateModal}
                      className="min-w-[120px] flex-1 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] px-5 py-2.5 text-sm font-semibold text-muted transition hover:text-[color:var(--text)] sm:flex-none"
                    >
                      ยกเลิก
                    </button>
                    <button
                      type="submit"
                      form="subject-form"
                      className="btn-primary min-w-[140px] flex-1 px-6 py-2.5 text-sm disabled:opacity-60 sm:flex-none"
                      disabled={isSubmitting || isLoadingSemesters || semesterOptions.length === 0}
                    >
                      {isSubmitting ? (editingSubject ? 'กำลังบันทึก...' : 'กำลังเพิ่ม...') : (editingSubject ? 'บันทึกการแก้ไข' : 'บันทึกรายวิชา')}
                    </button>
                  </div>
                </div>

                <div className="md:col-span-2">
                    <div className={`grid gap-3 ${isPopupVariant ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3'}`}>
                    <div>
                      <label className="mb-1 block text-xs uppercase tracking-widest text-muted">วันที่จะเริ่มบันทึก</label>
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="dd/mm/yyyy"
                          inputMode="numeric"
                          className="w-full rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-2)] px-3 py-3 text-[color:var(--text)] shadow-sm outline-none transition focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:var(--accent)]/30 pr-10"
                          {...register('start_date', {
                            validate: value => {
                              const startTime = watch('start_time');
                              const endTime = watch('end_time');
                              const allDay = watch('all_day');
                              if (!value && !startTime && !endTime && !allDay) return true;
                              if (!value) return 'กรุณาเลือกวันที่ก่อนตั้งเวลา';
                              return isValidDateInput(value) ? true : 'รูปแบบวันที่ dd/mm/yyyy';
                            }
                          })}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const picker = createDatePickerRef.current;
                            if (!picker) return;
                            if (typeof (picker as any).showPicker === 'function') (picker as any).showPicker();
                            else picker.click();
                          }}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-[color:var(--text)]"
                          aria-label="Open calendar"
                        >
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
                            <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
                            <path d="M8 3v4M16 3v4M3 9h18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                          </svg>
                        </button>
                        <input
                          ref={createDatePickerRef}
                          type="date"
                          value={toIsoDate(watch('start_date')) ?? ''}
                          onChange={event => {
                            const display = formatScheduleDateDisplay(event.target.value);
                            if (display) setValue('start_date', display, { shouldDirty: true, shouldValidate: true });
                          }}
                          className="absolute inset-0 opacity-0 pointer-events-none"
                          tabIndex={-1}
                          aria-hidden="true"
                        />
                      </div>
                      {errors.start_date?.message && <p className="mt-1 text-xs text-red-200">{errors.start_date.message}</p>}
                    </div>

                    <div className={isPopupVariant ? 'sm:col-span-2' : 'sm:col-span-2 lg:col-span-3'}>
                      <label className="mb-1 block text-xs uppercase tracking-widest text-muted">ทั้งวัน</label>
                      <div className="flex items-center gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-2)] px-3 py-3 text-sm text-muted">
                        <input type="checkbox" {...register('all_day')} />
                        <span>ทั้งวัน</span>
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs uppercase tracking-widest text-muted">เวลาเริ่ม</label>
                      <Controller
                        name="start_time"
                        control={control}
                        rules={{
                          validate: value => {
                            const allDay = watch('all_day');
                            if (allDay) return true;
                            return !value || timePattern.test(value) ? true : 'รูปแบบเวลา 00:00-23:59';
                          }
                        }}
                        render={({ field }) => (
                          <TimePicker
                            value={field.value}
                            onChange={value => field.onChange(value ? value + ':00' : '')}
                            onBlur={field.onBlur}
                            inputRef={field.ref}
                            disabled={isAllDay}
                            allowEmpty
                            label="เวลาเริ่ม"
                            className="w-full"
                          />
                        )}
                      />
                      {errors.start_time?.message && <p className="mt-1 text-xs text-red-200">{errors.start_time.message}</p>}
                    </div>

                    <div>
                      <label className="mb-1 block text-xs uppercase tracking-widest text-muted">เวลาเลิก</label>
                      <Controller
                        name="end_time"
                        control={control}
                        rules={{
                          validate: value => {
                            const allDay = watch('all_day');
                            if (allDay) return true;
                            if (!value) return true;
                            if (!timePattern.test(value)) return 'รูปแบบเวลา 00:00-23:59';
                            const startTime = watch('start_time');
                            return startTime ? true : 'ต้องระบุเวลาเริ่มก่อนเวลาเลิก';
                          }
                        }}
                        render={({ field }) => (
                          <TimePicker
                            value={field.value}
                            onChange={value => field.onChange(value ? value + ':00' : '')}
                            onBlur={field.onBlur}
                            inputRef={field.ref}
                            disabled={isAllDay}
                            allowEmpty
                            label="เวลาเลิก"
                            className="w-full"
                          />
                        )}
                      />
                      {errors.end_time?.message && <p className="mt-1 text-xs text-red-200">{errors.end_time.message}</p>}
                    </div>

                    <div className={isPopupVariant ? 'sm:col-span-2' : 'sm:col-span-2 lg:col-span-3'}>
                      <p className="text-xs text-muted">รูปแบบเวลา 00:00 ถึง 23:59</p>
                    </div>
                  </div>
                </div>

                {!isPopupVariant && (
                  <>
                    <div className="md:col-span-2">
                      <label className="mb-1 block text-xs uppercase tracking-widest text-muted">คำอธิบาย</label>
                      <textarea
                        className="h-28 w-full rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-2)] px-3 py-3 text-[color:var(--text)] shadow-sm outline-none transition focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:var(--accent)]/30"
                        {...register('description')}
                      />
                    </div>

                    <p className="md:col-span-2 text-xs text-muted">
                      * สามารถเพิ่มหัวข้อย่อยและบันทึกการเรียนหลังจากสร้างวิชาแล้วในหน้ารายละเอียด
                    </p>
                  </>
                )}
              </form>
            </div>

          </div>
        </div>
      )}

      {detailSubject ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-[32px] border border-[color:var(--border)] bg-[color:var(--surface)] shadow-[0_24px_80px_rgba(15,23,42,0.35)]">
            <div className="flex items-start justify-between gap-3 border-b border-[color:var(--border)] bg-[color:var(--surface-2)]/60 px-6 py-5">
              <div>
                <h3 className="text-lg font-semibold text-[color:var(--text)]">รายละเอียดรายวิชา</h3>
                <p className="mt-1 text-sm text-muted">{detailSubject.name}</p>
              </div>
              <button type="button" onClick={() => setDetailSubject(null)} className="flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface)] text-muted transition hover:text-[color:var(--text)]">x</button>
            </div>
            <div className="space-y-4 px-6 py-6 text-sm text-muted">
              <div className="flex items-center gap-3">
                <span className="h-4 w-4 rounded-full" style={{ backgroundColor: resolveSubjectColor(detailSubject.color) }} />
                <span className="font-semibold text-[color:var(--text)]">{detailSubject.name}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-2)] px-4 py-3">
                  <p className="text-xs uppercase tracking-widest text-muted">ภาคเรียน</p>
                  <p className="mt-2 text-[color:var(--text)]">{formatSemesterLabel(detailSubject.semester, detailSubject.academic_year) ?? 'ไม่ระบุภาคเรียน'}</p>
                </div>
                <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-2)] px-4 py-3">
                  <p className="text-xs uppercase tracking-widest text-muted">วันและเวลา</p>
                  <p className="mt-2 text-[color:var(--text)]">{formatSubjectDayLabel(detailSubject.start_date) ?? 'ยังไม่ระบุวันเรียน'}</p>
                  <p className="mt-1 font-mono text-xs text-accent">{formatSubjectTimeRange(detailSubject.start_time, detailSubject.end_time) ?? (detailSubject.start_date ? 'ทั้งวัน' : 'ยังไม่ระบุเวลา')}</p>
                </div>
                <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-2)] px-4 py-3">
                  <p className="text-xs uppercase tracking-widest text-muted">เป้าหมาย</p>
                  <p className="mt-2 text-[color:var(--text)]">{typeof detailSubject.target_hours === 'number' ? `${detailSubject.target_hours} ชั่วโมง/เดือน` : 'ไม่ระบุ'}</p>
                </div>
                <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-2)] px-4 py-3">
                  <p className="text-xs uppercase tracking-widest text-muted">บันทึก</p>
                  <p className="mt-2 text-[color:var(--text)]">{detailSubject.study_log_count ?? 0} รายการ</p>
                </div>
                <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-2)] px-4 py-3 sm:col-span-2">
                  <p className="text-xs uppercase tracking-widest text-muted">ห้องเรียน</p>
                  <p className="mt-2 text-[color:var(--text)]">
                    {detailSubject.classroom?.trim() || detailSubject.room?.trim() ? (detailSubject.classroom?.trim() || detailSubject.room) : 'ไม่ระบุ'}
                  </p>
                </div>
              </div>
              <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-2)] px-4 py-3">
                <p className="text-xs uppercase tracking-widest text-muted">คำอธิบาย</p>
                <p className="mt-2 whitespace-pre-wrap text-[color:var(--text)]">{detailSubject.description ?? 'ยังไม่มีคำอธิบาย เพิ่มข้อมูลในภายหลังได้'}</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
};
