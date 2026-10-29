import { useSharedSemesterSelection } from '../../hooks/useAcademicSelection';
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { TimePicker } from "../../components/TimePicker";
import { format, parseISO } from "date-fns";
import { th } from "date-fns/locale";
import { apiFallbackClients } from "../../services/api";
import {
  useSemesterOptions,
} from "../../hooks/useSemesterOptions";
import { filterBySemester, toNumberOrNull } from "../../utils/semester";
import { subscribeSubjectsUpdated } from "../../utils/subjectSync";
import {
  normalizeTimeValue,
  parseCalendarDateTime,
  getDurationHours,
  resolveEventType,
  getStartOfWeek,
  expandRecurringSubjectSchedules,
  dateInMonth,
  layoutTimedEvents,
} from "../../utils/calendar";
import type { CalendarEvent, SubjectOption } from "../../utils/calendar";

type EventTypeKey = "class" | "exam" | "other" | "log";

const eventTypeConfig: Record<
  EventTypeKey,
  { label: string; className: string }
> = {
  class: {
    label: "เรียน",
    className:
      "border border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
  },
  exam: {
    label: "สอบ",
    className: "border border-rose-500/30 bg-rose-500/10 text-rose-600",
  },
  other: {
    label: "กิจกรรม",
    className: "border border-muted surface-2 text-muted",
  },
  log: {
    label: "บันทึกการเรียน",
    className: "border border-sky-500/30 bg-sky-500/15 text-sky-200",
  },
};

const calendarChipClassByType = {
  class: "bg-emerald-500 text-white",
  exam: "bg-rose-500 text-white",
  other: "bg-amber-400 text-white",
  log: "bg-sky-500 text-white",
};

const timetableDayLabels = [
  "อาทิตย์",
  "จันทร์",
  "อังคาร",
  "พุธ",
  "พฤหัสบดี",
  "ศุกร์",
  "เสาร์",
];

// The week and day views intentionally follow the familiar calendar layout:
// one column per date and a full 24-hour timeline.
const calendarStartHour = 0;
const calendarEndHour = 24;
const calendarSlotHeight = 24;
const calendarTimeSlots = (calendarEndHour - calendarStartHour) * 2;

// ตารางเรียนใน OverviewPage ใช้คาบเรียน โดยคาบ 1 เริ่ม 08:30 และแต่ละคาบยาว 60 นาที
// ข้อมูลเก่าบางรายการถูกบันทึกเป็น 01:00-03:00 เพื่อหมายถึง "คาบ 1-3"
// จึงต้องแปลงเป็นเวลาจริงก่อนส่งให้ปฏิทิน เช่น 01:00-03:00 => 08:30-11:30
const timetableStartMinutes = 8 * 60 + 30;
const timetablePeriodDuration = 60;
const timetablePeriodCount = 13;

const parseTimeToMinutes = (value?: string | null) => {
  if (!value) return Number.NaN;
  const normalized = normalizeTimeValue(value);
  if (!normalized) return Number.NaN;
  const [hourValue, minuteValue] = normalized.split(":");
  const hour = Number(hourValue);
  const minute = Number(minuteValue);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return Number.NaN;
  return hour * 60 + minute;
};

const formatMinutesAsTime = (minutes: number) => {
  const bounded = Math.min(Math.max(minutes, 0), 23 * 60 + 59);
  const hour = Math.floor(bounded / 60);
  const minute = bounded % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
};

const periodToStartTime = (period: number) =>
  formatMinutesAsTime(
    timetableStartMinutes + Math.max(period - 1, 0) * timetablePeriodDuration,
  );

const periodToEndTime = (period: number) =>
  formatMinutesAsTime(
    timetableStartMinutes + Math.max(period, 0) * timetablePeriodDuration,
  );

const normalizeTimetablePeriodRange = (
  startValue?: string | null,
  endValue?: string | null,
) => {
  const start = normalizeTimeValue(startValue);
  const end = normalizeTimeValue(endValue);
  if (!start) return { startTime: start, endTime: end };

  const startParts = start.split(":");
  const endParts = end?.split(":") ?? [];
  const startHour = Number(startParts[0]);
  const startMinute = Number(startParts[1] ?? 0);
  const endHour = Number(endParts[0]);
  const endMinute = Number(endParts[1] ?? 0);

  const looksLikePeriodNumber =
    Number.isInteger(startHour) &&
    startHour >= 1 &&
    startHour <= timetablePeriodCount &&
    startMinute === 0 &&
    parseTimeToMinutes(start) < timetableStartMinutes &&
    (!end ||
      (Number.isInteger(endHour) &&
        endHour >= startHour &&
        endHour <= timetablePeriodCount &&
        endMinute === 0));

  if (!looksLikePeriodNumber) {
    return { startTime: start, endTime: end };
  }

  const startPeriod = startHour;
  const endPeriod = end ? endHour : startPeriod;
  return {
    startTime: periodToStartTime(startPeriod),
    endTime: periodToEndTime(endPeriod),
  };
};

const Icon = ({
  children,
  size = 20,
  className,
}: {
  children: ReactNode;
  size?: number;
  className?: string;
}) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const PlusIcon = ({
  size = 20,
  className,
}: {
  size?: number;
  className?: string;
}) => (
  <Icon size={size} className={className}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </Icon>
);

const ChevronLeftIcon = ({
  size = 18,
  className,
}: {
  size?: number;
  className?: string;
}) => (
  <Icon size={size} className={className}>
    <path d="M15 18l-6-6 6-6" />
  </Icon>
);

const ChevronRightIcon = ({
  size = 18,
  className,
}: {
  size?: number;
  className?: string;
}) => (
  <Icon size={size} className={className}>
    <path d="M9 18l6-6-6-6" />
  </Icon>
);

const BookOpenIcon = ({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) => (
  <Icon size={size} className={className}>
    <path d="M2.5 6.5A2.5 2.5 0 0 1 5 4h6v16H5a2.5 2.5 0 0 0-2.5 2.5V6.5Z" />
    <path d="M21.5 6.5A2.5 2.5 0 0 0 19 4h-6v16h6a2.5 2.5 0 0 1 2.5 2.5V6.5Z" />
    <path d="M12 4v16" />
  </Icon>
);

const ClockIcon = ({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) => (
  <Icon size={size} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
);

const unwrapCollection = (payload: any) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

const isFallbackStatus = (status?: number) =>
  !status || status === 404 || status === 405 || status === 500;

const fetchCollectionWithFallback = async (path: string) => {
  let lastError: any = null;
  for (const client of apiFallbackClients) {
    try {
      const res = await client.get(path);
      return { ok: true, data: unwrapCollection(res.data) };
    } catch (err: any) {
      lastError = err;
      const status = err?.response?.status;
      if (!isFallbackStatus(status)) throw err;
    }
  }
  return { ok: false, data: [], error: lastError };
};

// Calendar is served through both the Laravel API and the compatibility API
// in existing installs.  Some web servers do not forward PATCH requests to
// the compatibility endpoint. Try alternate routes only for unsupported methods
// or paths; retrying a network/server failure could duplicate a successful write.
const createCalendarEventWithFallback = async (
  payload: Record<string, unknown>,
) => {
  for (const [index, client] of apiFallbackClients.entries()) {
    try {
      const response = await client.post("/calendar-events", payload);
      if (!(response.data?.id ?? response.data?.data?.id))
        throw new Error("ไม่พบรายการที่บันทึก กรุณาลองโหลดข้อมูลใหม่");
      return response;
    } catch (err: any) {
      if (
        ![404, 405].includes(err.response?.status) ||
        index === apiFallbackClients.length - 1
      )
        throw err;
    }
  }
};

const deleteCalendarEventWithFallback = async (eventId: number) => {
  let lastError: unknown;
  for (const client of apiFallbackClients) {
    for (const remove of [
      () => client.delete(`/calendar-events/${eventId}`),
      () => client.post(`/calendar-events/${eventId}/delete`),
    ]) {
      try {
        await remove();
        return;
      } catch (err: any) {
        lastError = err;
        if (![404, 405].includes(err.response?.status)) throw err;
      }
    }
  }
  throw lastError;
};

const updateCalendarEventWithFallback = async (
  eventId: number,
  payload: Record<string, unknown>,
) => {
  let lastError: any = null;

  for (const client of apiFallbackClients) {
    try {
      return await client.patch(`/calendar-events/${eventId}`, payload);
    } catch (err: any) {
      lastError = err;
      if (![404, 405].includes(err?.response?.status)) throw err;
    }

    try {
      return await client.put(`/calendar-events/${eventId}`, payload);
    } catch (err: any) {
      lastError = err;
      if (![404, 405].includes(err?.response?.status)) throw err;
    }
  }

  throw lastError ?? new Error("บันทึกการแก้ไขตารางไม่สำเร็จ");
};

const buildDateTime = (date: string, time: string) =>
  `${date} ${normalizeTimeValue(time) ?? "00:00:00"}`;

const parseExamDescription = (description?: string | null) => {
  const raw = (description ?? "").trim();
  if (!raw) {
    return {
      examTopic: "",
      examScope: "",
      examMethod: "",
      preparationNotes: "",
      generalNotes: "",
    };
  }

  const examScope = raw.match(/ขอบเขตสอบ:\s*(.+)/u)?.[1]?.trim() ?? "";
  const examMethod = raw.match(/รูปแบบการสอบ:\s*(.+)/u)?.[1]?.trim() ?? "";
  const preparationNotes =
    raw
      .match(/แผนเตรียมสอบ:\s*([\s\S]+?)(?:\n\nหมายเหตุเพิ่มเติม:|$)/u)?.[1]
      ?.trim() ?? "";
  const generalNotes =
    raw.match(/หมายเหตุเพิ่มเติม:\s*([\s\S]+)$/u)?.[1]?.trim() ?? "";
  const examTopic = examScope;

  return {
    examTopic,
    examScope,
    examMethod,
    preparationNotes,
    generalNotes,
  };
};

const buildExamDescription = ({
  examScope,
  examHours,
  isAllDay,
  examMethod,
  preparationNotes,
  generalNotes,
}: {
  examScope: string;
  examHours: number;
  isAllDay: boolean;
  examMethod: string;
  preparationNotes: string;
  generalNotes: string;
}) =>
  [
    examScope ? `ขอบเขตสอบ: ${examScope}` : "",
    !isAllDay ? `ระยะเวลาสอบ: ${examHours} ชั่วโมง` : "",
    examMethod ? `รูปแบบการสอบ: ${examMethod}` : "",
    preparationNotes ? `แผนเตรียมสอบ:\n${preparationNotes}` : "",
    generalNotes ? `หมายเหตุเพิ่มเติม:\n${generalNotes}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

const filterEventsBySubjects = (
  events: CalendarEvent[],
  subjects: SubjectOption[],
) => {
  if (!events.length) return events;
  if (!subjects.length) {
    return events.filter((event) => !event.subject?.id && !event.subject_id);
  }
  const subjectIds = new Set(subjects.map((subject) => subject.id));
  return events.filter((event) => {
    const subjectId = event.subject?.id ?? event.subject_id;
    if (!subjectId) return true;
    return subjectIds.has(subjectId);
  });
};

const thaiMonthOptions = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];

const MobileSemesterSelect = ({
  value,
  options,
  onChange,
  label = "เลือกภาคเรียน",
  compact = false,
  menuClassName = "inset-x-0",
}: {
  value: string;
  options: Array<{ key: string; label: string }>;
  onChange: (value: string) => void;
  label?: string;
  compact?: boolean;
  menuClassName?: string;
}) => {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const choices = options.length ? options : [{ key: "all", label: "ทุกปีการศึกษา" }];

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  return (
    <div
      ref={container}
      className="relative w-full min-w-0 sm:hidden"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={`flex w-full min-w-0 items-center justify-between gap-2 text-left text-[color:var(--text)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)] ${compact ? "rounded-lg bg-transparent px-1 py-1 text-sm font-bold" : "rounded-2xl border border-muted surface-2 px-4 py-2.5 text-sm"}`}
      >
        <span className="min-w-0 truncate">
          {choices.find((option) => option.key === value)?.label ?? "ทุกปีการศึกษา"}
        </span>
        <Icon size={14} className="shrink-0"><path d="m6 9 6 6 6-6" /></Icon>
      </button>
      {open && (
        <div role="group" aria-label={label} className={`absolute ${menuClassName} top-full z-30 mt-1 max-h-60 overflow-y-auto overflow-x-hidden rounded-xl border border-muted bg-[color:var(--panel-bg)] p-1 shadow-lg`}>
          {choices.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={value === option.key}
              onClick={() => {
                onChange(option.key);
                setOpen(false);
                trigger.current?.focus();
              }}
              className={`block min-h-11 w-full whitespace-normal break-words rounded-lg px-3 py-2 text-left ${compact ? "text-xs" : "text-sm"} focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--accent)] ${value === option.key ? "bg-primary text-[color:var(--on-accent)]" : "text-[color:var(--text)] hover:surface-2"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const CalendarDateInput = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) => {
  const displayDate = (date: string) =>
    date ? date.split("-").reverse().join("/") : "";
  const [draft, setDraft] = useState(() => displayDate(value));
  const textInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(displayDate(value));
    textInput.current?.setCustomValidity("");
  }, [value]);

  return (
    <span className="relative mt-1 block">
      <input
        ref={textInput}
        required
        type="text"
        inputMode="numeric"
        placeholder="วว/ดด/ปปปป"
        aria-label="วันที่ (วัน/เดือน/ปี)"
        value={draft}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          const match = next.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
          const iso = match ? `${match[3]}-${match[2]}-${match[1]}` : "";
          const parsed = parseISO(iso);
          const valid =
            !!match &&
            Number(match[3]) > 0 &&
            !Number.isNaN(parsed.getTime()) &&
            format(parsed, "yyyy-MM-dd") === iso;
          event.target.setCustomValidity(
            valid ? "" : "กรุณาระบุวันที่เป็น วัน/เดือน/ปี เช่น 28/09/2026",
          );
          if (valid) onChange(iso);
        }}
        className="w-full rounded-xl border border-muted surface-2 py-2 pl-3 pr-11 text-sm"
      />
      <span className="absolute inset-y-0 right-2 flex w-8 items-center justify-center">
        <Icon size={16}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M16 3v4M8 3v4M3 11h18" />
        </Icon>
        <input
          type="date"
          aria-label="เลือกวันที่จากปฏิทิน"
          value={value}
          onChange={(event) => {
            if (!event.target.value) return;
            setDraft(displayDate(event.target.value));
            textInput.current?.setCustomValidity("");
            onChange(event.target.value);
          }}
          onClick={(event) => event.currentTarget.showPicker?.()}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </span>
    </span>
  );
};

export const CalendarPage = ({
  embedded = false,
}: { embedded?: boolean } = {}) => {
  const loadRequestId = useRef(0);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    format(new Date(), "yyyy-MM-dd"),
  );
  const [currentMonthDate, setCurrentMonthDate] = useState<Date>(
    () => new Date(),
  );
  const [calendarView, setCalendarView] = useState<"week" | "day" | "month">(
    "week",
  );
  const [isAddingEvent, setIsAddingEvent] = useState(false);
  const [subjectSearch] = useState("");
  const [form, setForm] = useState({
    title: "",
    examTopic: "",
    examMethod: "",
    examNotes: "",
    room: "",
    type: "class",
    date: format(new Date(), "yyyy-MM-dd"),
    startTime: "09:00:00",
    endTime: "10:00:00",
    examHours: "1",
    allDay: false,
    subjectId: "",
    description: "",
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [editingEventId, setEditingEventId] = useState<number | null>(null);
  const semesterOptions = useSemesterOptions();
  const [selectedSemesterKey, setSelectedSemesterKey] = useSharedSemesterSelection(semesterOptions);

  const openAddForm = () => {
    setEditingEventId(null);
    setError(null);
    setForm({
      title: "",
      examTopic: "",
      examMethod: "",
      examNotes: "",
      room: "",
      type: "class",
      date: selectedDate,
      startTime: "09:00:00",
      endTime: "10:00:00",
      examHours: "1",
      allDay: false,
      subjectId: "",
      description: "",
    });
    setIsAddingEvent(true);
  };

  useEffect(() => {
    if (isAddingEvent)
      document
        .getElementById("calendar-form")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [isAddingEvent]);

  const loadData = async () => {
    const requestId = ++loadRequestId.current;
    setLoading(true);
    setError(null);
    try {
      const [eventsRes, subjectsRes] = await Promise.all([
        fetchCollectionWithFallback("/calendar-events"),
        fetchCollectionWithFallback("/subjects"),
      ]);

      if (requestId !== loadRequestId.current) return;
      let nextEvents: CalendarEvent[] = [];
      let nextSubjects: SubjectOption[] = [];
      const subjectsLoaded = subjectsRes.ok;

      if (subjectsRes.ok) {
        nextSubjects = (subjectsRes.data as any[]).map((subject) => {
          // ใช้เวลาเดียวกับหน้าตารางเรียน (OverviewPage) เป็น source of truth
          // เพื่อไม่ให้ปฏิทินนำค่า 01:00-03:00 ไปแสดงเป็นเวลาจริง ทั้งที่หมายถึงคาบ 1-3
          const timetableTime = normalizeTimetablePeriodRange(
            subject.start_time,
            subject.end_time,
          );

          return {
            id: Number(subject.id),
            name: subject.name,
            semester_id: toNumberOrNull(subject.semester_id),
            semester: toNumberOrNull(subject.semester),
            academic_year: toNumberOrNull(subject.academic_year),
            start_date: subject.start_date ?? null,
            start_time: timetableTime.startTime ?? subject.start_time ?? null,
            end_time: timetableTime.endTime ?? subject.end_time ?? null,
          };
        });
      } else {
        setError(
          subjectsRes.error?.response?.data?.message ?? "โหลดรายวิชาไม่สำเร็จ",
        );
      }

      if (eventsRes.ok) {
        const scheduledSubjectIds = new Set(
          nextSubjects
            .filter((subject) => subject.start_date && subject.start_time)
            .map((subject) => subject.id),
        );

        nextEvents = (eventsRes.data as CalendarEvent[])
          .map((event) => ({
            ...event,
            id: Number(event.id),
            subject_id: event.subject_id ? Number(event.subject_id) : null,
            subject: event.subject?.id
              ? { ...event.subject, id: Number(event.subject.id) }
              : null,
          }))
          .filter((event) => {
            const subjectId = event.subject?.id ?? event.subject_id;
            if (!subjectId || !scheduledSubjectIds.has(subjectId)) return true;

            // วิชาที่มีตารางเรียนอยู่แล้ว ให้ตารางเรียน (subjects) เป็น source of truth
            // สำหรับเวลาเรียนประจำสัปดาห์ทั้งหมด ไม่ใช้ calendar-event เดิมซ้ำอีก
            // เพราะข้อมูลเก่าบางรายการเก็บ "คาบ 1-3" เป็น 01:00-03:00
            // ทำให้ปฏิทินแสดงทั้ง 01:00-03:00 และ 08:30-11:30 พร้อมกัน
            const eventType = resolveEventType(event);
            return eventType !== "class";
          });
      } else {
        const message =
          eventsRes.error?.response?.data?.message ??
          "โหลดข้อมูลปฏิทินไม่สำเร็จ";
        setError(message);
      }

      setSubjects(nextSubjects);
      const filteredEvents = subjectsLoaded
        ? filterEventsBySubjects(nextEvents, nextSubjects)
        : nextEvents;
      // Keep API events intact here. Recurring class occurrences are derived
      // for the displayed dates below, using the subject timetable as truth.
      setEvents(filteredEvents);
    } catch (err: any) {
      if (requestId === loadRequestId.current)
        setError(err.response?.data?.message ?? "โหลดข้อมูลปฏิทินไม่สำเร็จ");
    } finally {
      if (requestId === loadRequestId.current) setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(
    () =>
      subscribeSubjectsUpdated(() => {
        void loadData();
      }),
    [],
  );

  useEffect(() => {
    const parsed = parseISO(selectedDate);
    if (Number.isNaN(parsed.getTime())) return;
    setCurrentMonthDate((prev) => {
      if (
        prev.getFullYear() === parsed.getFullYear() &&
        prev.getMonth() === parsed.getMonth()
      ) {
        return prev;
      }
      return new Date(parsed.getFullYear(), parsed.getMonth(), 1);
    });
  }, [selectedDate]);

  const filteredSubjects = useMemo(
    () => filterBySemester(subjects, selectedSemesterKey),
    [subjects, selectedSemesterKey],
  );
  const filteredSubjectIdSet = useMemo(
    () => new Set(filteredSubjects.map((subject) => subject.id)),
    [filteredSubjects],
  );
  const filteredEvents = useMemo(
    () =>
      selectedSemesterKey === "all"
        ? events
        : events.filter((event) => {
            const subjectId = event.subject?.id ?? event.subject_id;
            if (!subjectId) return true;
            return filteredSubjectIdSet.has(subjectId);
          }),
    [events, filteredSubjectIdSet, selectedSemesterKey],
  );
  const calendarEvents = useMemo(() => {
    const monthStart = new Date(
      currentMonthDate.getFullYear(),
      currentMonthDate.getMonth(),
      1,
    );
    const monthEnd = new Date(
      currentMonthDate.getFullYear(),
      currentMonthDate.getMonth() + 1,
      0,
    );
    const selected = parseISO(selectedDate);
    const selectedWeekStart = Number.isNaN(selected.getTime())
      ? monthStart
      : getStartOfWeek(selected);
    const selectedWeekEnd = new Date(selectedWeekStart);
    selectedWeekEnd.setDate(selectedWeekEnd.getDate() + 6);
    const rangeStart =
      monthStart < selectedWeekStart ? monthStart : selectedWeekStart;
    const rangeEnd = monthEnd > selectedWeekEnd ? monthEnd : selectedWeekEnd;

    return expandRecurringSubjectSchedules(
      filteredEvents,
      filteredSubjects,
      rangeStart,
      rangeEnd,
    );
  }, [currentMonthDate, filteredEvents, filteredSubjects, selectedDate]);
  const visibleEvents = useMemo(
    () =>
      calendarEvents
        .filter(
          (event) =>
            !Number.isNaN(parseCalendarDateTime(event.start_time).getTime()),
        )
        .sort(
          (a, b) =>
            parseCalendarDateTime(a.start_time).getTime() -
            parseCalendarDateTime(b.start_time).getTime(),
        ),
    [calendarEvents],
  );

  useEffect(() => {
    if (
      form.subjectId &&
      !filteredSubjects.some((subject) => String(subject.id) === form.subjectId)
    ) {
      setForm((prev) => ({ ...prev, subjectId: "" }));
    }
  }, [filteredSubjects, form.subjectId]);

  const selectedEvents = useMemo(
    () =>
      visibleEvents.filter(
        (event) =>
          format(parseCalendarDateTime(event.start_time), "yyyy-MM-dd") ===
          selectedDate,
      ),
    [selectedDate, visibleEvents],
  );
  const currentYear = currentMonthDate.getFullYear();
  const currentMonth = currentMonthDate.getMonth();
  const weekDays = useMemo(() => {
    const weekStart = getStartOfWeek(parseISO(selectedDate));
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + index);
      return date;
    });
  }, [selectedDate]);
  const weekLabel = `${format(weekDays[0], "d MMM", { locale: th })} – ${format(weekDays[6], "d MMM yyyy", { locale: th })}`;
  const yearOptions = useMemo(() => {
    const selectedYear = parseISO(selectedDate).getFullYear();
    const startYear = Math.min(currentYear, selectedYear) - 3;
    const endYear = Math.max(currentYear, selectedYear) + 3;
    return Array.from(
      { length: endYear - startYear + 1 },
      (_, index) => startYear + index,
    );
  }, [currentYear, selectedDate]);
  const firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const blankDays = Array.from(
    { length: firstDayOfMonth },
    (_, index) => `blank-${index}`,
  );
  const monthDays = Array.from(
    { length: daysInMonth },
    (_, index) => index + 1,
  );
  const dayHeaders = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
  const subjectStatuses = useMemo(() => {
    if (!filteredSubjects.length) return [];
    const bySubject = new Map<number, CalendarEvent[]>();
    visibleEvents.forEach((event) => {
      const eventDate = format(
        parseCalendarDateTime(event.start_time),
        "yyyy-MM-dd",
      );
      if (eventDate !== selectedDate) return;
      const subjectId = event.subject?.id ?? event.subject_id;
      if (!subjectId) return;
      const list = bySubject.get(subjectId) ?? [];
      list.push(event);
      bySubject.set(subjectId, list);
    });

    return filteredSubjects.map((subject) => {
      const subjectEvents = bySubject.get(subject.id) ?? [];
      const hasLog = subjectEvents.some(
        (event) => event.source === "study_log" || event.study_log_id,
      );
      const hasExam = subjectEvents.some(
        (event) => resolveEventType(event) === "exam",
      );
      const hasClass = subjectEvents.some(
        (event) => resolveEventType(event) === "class",
      );
      let activity: "exam" | "class" | "other" | "none" = "none";
      if (hasExam) activity = "exam";
      else if (hasClass) activity = "class";
      else if (subjectEvents.length) activity = "other";

      return {
        id: subject.id,
        name: subject.name,
        start_time: subject.start_time ?? null,
        end_time: subject.end_time ?? null,
        studied: hasLog,
        hasClass,
        hasExam,
        activity,
      };
    });
  }, [filteredSubjects, selectedDate, visibleEvents]);

  const filteredSubjectStatuses = useMemo(() => {
    const needle = subjectSearch.trim().toLowerCase();
    if (!needle) return subjectStatuses;
    return subjectStatuses.filter((subject) =>
      subject.name.toLowerCase().includes(needle),
    );
  }, [subjectSearch, subjectStatuses]);

  const weeklySummary = useMemo(() => {
    const values = weekDays.map(
      (day) =>
        visibleEvents.filter(
          (event) =>
            format(parseCalendarDateTime(event.start_time), "yyyy-MM-dd") ===
            format(day, "yyyy-MM-dd"),
        ).length,
    );
    return { values, max: Math.max(1, ...values) };
  }, [weekDays, visibleEvents]);

  const resolveEventBadge = (event: CalendarEvent) => {
    if (event.source === "study_log") {
      return eventTypeConfig.log;
    }
    const resolvedType = resolveEventType(event);
    const config = resolvedType ? eventTypeConfig[resolvedType] : null;
    return config ?? eventTypeConfig.other;
  };

  const formatEventTime = (event: CalendarEvent) => {
    if (event.all_day) return "ทั้งวัน";
    const start = format(parseCalendarDateTime(event.start_time), "HH:mm");
    if (event.end_time) {
      const end = format(parseCalendarDateTime(event.end_time), "HH:mm");
      return `${start} - ${end}`;
    }
    return start;
  };

  const startEditEvent = (event: CalendarEvent) => {
    if (event.id <= 0 || event.source === "study_log") return;
    setError(null);
    const resolvedType = resolveEventType(event) ?? "other";
    const startAt = parseCalendarDateTime(event.start_time);
    const endAt = event.end_time ? parseCalendarDateTime(event.end_time) : null;
    const examTopicFromTitle = (event.title ?? "")
      .replace(/^สอบ:\s*/u, "")
      .trim();
    const descriptionRaw = (event.description ?? "").trim();
    const parsedExam = parseExamDescription(descriptionRaw);
    const examHours =
      endAt && !Number.isNaN(endAt.getTime())
        ? Math.max(
            0.5,
            Math.round(
              ((endAt.getTime() - startAt.getTime()) / 3600000 || 1) * 2,
            ) / 2,
          ).toString()
        : "1";

    const nextDate = format(startAt, "yyyy-MM-dd");
    setSelectedDate(nextDate);
    setForm({
      title: event.title ?? "",
      examTopic:
        resolvedType === "exam"
          ? parsedExam.examTopic || examTopicFromTitle || ""
          : "",
      examMethod: resolvedType === "exam" ? parsedExam.examMethod : "",
      examNotes: resolvedType === "exam" ? parsedExam.preparationNotes : "",
      room: String(event.room ?? event.metadata?.room ?? ""),
      type: resolvedType,
      date: nextDate,
      startTime: format(startAt, "HH:mm:ss"),
      endTime:
        endAt && !Number.isNaN(endAt.getTime())
          ? format(endAt, "HH:mm:ss")
          : "10:00:00",
      examHours,
      allDay: Boolean(event.all_day),
      subjectId: String(event.subject?.id ?? event.subject_id ?? ""),
      description:
        resolvedType === "exam"
          ? parsedExam.generalNotes ||
            (!parsedExam.examScope &&
            !parsedExam.examMethod &&
            !parsedExam.preparationNotes
              ? descriptionRaw
              : "")
          : descriptionRaw,
    });
    setEditingEventId(event.id);
    setIsAddingEvent(true);
    document
      .getElementById("calendar-form")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const createEvent = async () => {
    if (saving) return;
    if (!form.title.trim()) {
      setError("กรุณากรอกชื่อกิจกรรม");
      return;
    }
    if (!form.subjectId) {
      setError("กรุณาเลือกรายวิชา");
      return;
    }
    if (Number.isNaN(parseISO(form.date).getTime())) {
      setError("กรุณาเลือกวันที่ที่ถูกต้อง");
      return;
    }
    if (!form.date) {
      setError("กรุณาเลือกวันที่");
      return;
    }
    if (!form.allDay && (!form.startTime || !form.endTime)) {
      setError("กรุณาระบุเวลาเริ่มและเวลาเลิก");
      return;
    }

    const examHours =
      form.type === "exam" && !form.allDay
        ? getDurationHours(form.startTime, form.endTime)
        : Number(form.examHours);
    if (!form.allDay && !getDurationHours(form.startTime, form.endTime)) {
      setError("เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม");
      return;
    }

    const isAllDay = form.allDay || !form.startTime;
    const normalizedType =
      form.type === "class" || form.type === "exam" ? form.type : null;
    const trimmedDescription = form.description.trim();
    const examTopic = form.examTopic.trim();
    const examMethod = form.examMethod.trim();
    const examNotes = form.examNotes.trim();
    const room = form.room.trim();
    const title = form.title.trim();
    const description =
      form.type === "exam"
        ? buildExamDescription({
            examScope: examTopic,
            examHours: examHours ?? 0,
            isAllDay,
            examMethod,
            preparationNotes: examNotes,
            generalNotes: trimmedDescription,
          })
        : trimmedDescription;
    const payload = {
      title,
      description: description || null,
      room: room || null,
      subject_id: form.subjectId ? Number(form.subjectId) : null,
      type: form.type,
      ...(normalizedType ? { event_type: normalizedType } : {}),
      all_day: isAllDay,
      start_time: buildDateTime(
        form.date,
        isAllDay ? "00:00:00" : form.startTime || "00:00:00",
      ),
      end_time:
        isAllDay || !form.endTime
          ? null
          : buildDateTime(form.date, form.endTime),
      status: "planned",
      source: "manual",
    };

    setSaving(true);
    setError(null);
    try {
      if (editingEventId) {
        await updateCalendarEventWithFallback(editingEventId, payload);
      } else {
        await createCalendarEventWithFallback(payload);
      }
      setForm((prev) => ({
        ...prev,
        title: "",
        examTopic: "",
        examMethod: "",
        examNotes: "",
        room: "",
        description: "",
      }));
      setEditingEventId(null);
      setIsAddingEvent(false);
      setSelectedDate(form.date);
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.message ?? "บันทึกตารางไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  const addClassFromTimetable = (subjectId: number) => {
    const subject = subjects.find((item) => item.id === subjectId);
    openAddForm();
    setForm((prev) => ({
      ...prev,
      subjectId: String(subjectId),
      title: subject?.name ?? "",
      startTime: normalizeTimeValue(subject?.start_time) ?? "09:00:00",
      endTime: normalizeTimeValue(subject?.end_time) ?? "10:00:00",
    }));
  };

  const openExamFormForSubject = (subjectId: number) => {
    setEditingEventId(null);
    setError(null);
    setForm((prev) => ({
      ...prev,
      title: `สอบ: ${subjects.find((subject) => subject.id === subjectId)?.name ?? ""}`,
      examTopic: "",
      examMethod: "",
      examNotes: "",
      room: "",
      type: "exam",
      date: selectedDate,
      startTime: "",
      endTime: "",
      examHours: "1",
      allDay: false,
      subjectId: String(subjectId),
      description: "",
    }));
    setIsAddingEvent(true);
    document
      .getElementById("calendar-form")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const deleteEvent = async (event: CalendarEvent) => {
    if (
      deletingId !== null ||
      !window.confirm(`ลบรายการ “${event.title}” หรือไม่?`)
    )
      return;
    const eventId = event.id;
    setDeletingId(eventId);
    setError(null);
    try {
      await deleteCalendarEventWithFallback(eventId);
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.message ?? "ลบรายการไม่สำเร็จ");
    } finally {
      setDeletingId(null);
    }
  };

  const getEventsForDay = (day: number) => {
    const dateKey = format(
      new Date(currentYear, currentMonth, day),
      "yyyy-MM-dd",
    );
    return visibleEvents.filter(
      (event) =>
        format(parseCalendarDateTime(event.start_time), "yyyy-MM-dd") ===
        dateKey,
    );
  };

  const goToToday = () => {
    const today = new Date();
    const todayKey = format(today, "yyyy-MM-dd");
    setCurrentMonthDate(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(todayKey);
    setIsAddingEvent(false);
  };
  const changeCalendarPeriod = (direction: -1 | 1) => {
    if (calendarView !== "month") {
      const nextDate = parseISO(selectedDate);
      nextDate.setDate(
        nextDate.getDate() + direction * (calendarView === "week" ? 7 : 1),
      );
      setSelectedDate(format(nextDate, "yyyy-MM-dd"));
      return;
    }
    setSelectedDate(
      dateInMonth(selectedDate, currentYear, currentMonth + direction),
    );
  };
  const todayDate = new Date();
  const todayDateKey = format(todayDate, "yyyy-MM-dd");
  const navigationPeriodLabel =
    calendarView === "month"
      ? `${thaiMonthOptions[currentMonth]} ${currentYear}`
      : calendarView === "week"
        ? weekLabel
        : format(parseISO(selectedDate), "dd/MM/yyyy");
  const periodEventCount = visibleEvents.filter((event) => {
    const date = format(parseCalendarDateTime(event.start_time), "yyyy-MM-dd");
    if (calendarView === "day") return date === selectedDate;
    if (calendarView === "week")
      return (
        date >= format(weekDays[0], "yyyy-MM-dd") &&
        date <= format(weekDays[6], "yyyy-MM-dd")
      );
    return date.startsWith(format(currentMonthDate, "yyyy-MM"));
  }).length;
  const selectedExamCount = selectedEvents.filter(
    (event) => resolveEventType(event) === "exam",
  ).length;

  return (
    <div
      className={`bg-transparent text-[color:var(--text)] ${embedded ? "px-3 py-4" : "min-h-screen px-4 py-6 md:px-8 md:py-8"}`}
    >
      <div className={`w-full ${embedded ? "space-y-4" : "space-y-6"}`}>
        {error ? (
          <div className="rounded-2xl border border-rose-500/35 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-300 shadow-[0_10px_24px_rgba(244,63,94,0.14)]">
            {error}
          </div>
        ) : null}

        <section className="rounded-[28px] border border-muted bg-[color:var(--panel-bg)] p-5 shadow-soft md:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            {!embedded && (
              <div>
                <p className="inline-flex items-center rounded-full border border-[color:rgba(var(--accent-rgb),0.35)] bg-[color:rgba(var(--accent-rgb),0.08)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
                  Smart Calendar
                </p>
                <h1 className="mt-3 text-3xl font-bold text-[color:var(--text)]">
                  จัดการปฏิทินและการสอบ
                </h1>
              </div>
            )}
            <button
              type="button"
              onClick={openAddForm}
              className={`inline-flex items-center justify-center gap-2 rounded-2xl border border-[color:rgba(var(--accent-rgb),0.35)] bg-[color:rgba(var(--accent-rgb),0.10)] px-5 py-2.5 text-sm font-bold text-accent shadow-[0_12px_24px_rgba(var(--accent-rgb),0.10)] backdrop-blur-sm transition hover:bg-[color:rgba(var(--accent-rgb),0.16)] ${embedded ? "w-full" : ""}`}
            >
              <PlusIcon size={16} />
              เพิ่มรายการใหม่
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
            <div className="rounded-[18px] border border-muted bg-[color:var(--surface)] px-4 py-3">
              <p className="text-[10px] font-bold text-muted">
                รายการทั้งหมดใน
                {calendarView === "month"
                  ? "เดือน"
                  : calendarView === "week"
                    ? "สัปดาห์"
                    : "วัน"}
                ที่แสดง
              </p>
              <p className="mt-1.5 text-2xl font-bold">{periodEventCount}</p>
            </div>
            <div className="rounded-[18px] border border-muted bg-[color:var(--surface)] px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                วิชาในเทอม
              </p>
              <p className="mt-1.5 text-2xl font-bold text-[color:var(--text)]">
                {filteredSubjects.length}
              </p>
            </div>
            <div className="rounded-[18px] border border-muted bg-[color:var(--surface)] px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                วันที่เลือก
              </p>
              <p className="mt-1.5 text-lg font-bold text-[color:var(--text)]">
                {format(parseISO(selectedDate), "dd/MM/yyyy")}
              </p>
            </div>
            <div className="rounded-[18px] border border-muted bg-[color:var(--surface)] px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                สอบในวันที่เลือก
              </p>
              <p className="mt-1.5 text-2xl font-bold text-[color:var(--text)]">
                {selectedExamCount}
              </p>
            </div>
          </div>
        </section>

        <div
          className={`grid grid-cols-1 gap-6 ${embedded ? "xl:grid-cols-12" : "lg:grid-cols-12"}`}
        >
          <section
            className={`min-w-0 ${embedded ? "xl:col-span-9" : "lg:col-span-9"}`}
          >
            <div className="bg-[color:var(--panel-bg)] backdrop-blur-xl border border-muted rounded-[32px] overflow-hidden shadow-soft">
              <div className="flex flex-col gap-4 border-b border-muted px-4 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-6 sm:py-5">
                <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
                  <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
                    <MobileSemesterSelect
                      value={String(currentMonth)}
                      label="เลือกเดือน"
                      compact
                      menuClassName="left-0 w-40 max-w-full"
                      options={thaiMonthOptions.map((monthLabel, index) => ({
                        key: String(index),
                        label: monthLabel,
                      }))}
                      onChange={(month) =>
                        setSelectedDate(dateInMonth(selectedDate, currentYear, Number(month)))
                      }
                    />
                    <select
                      value={currentMonth}
                      aria-label="เลือกเดือน"
                      onChange={(event) =>
                        setSelectedDate(
                          dateInMonth(
                            selectedDate,
                            currentYear,
                            Number(event.target.value),
                          ),
                        )
                      }
                      className="hidden sm:block min-w-0 w-full bg-transparent text-sm sm:w-auto sm:min-w-[9.5rem] sm:text-lg font-bold text-[color:var(--text)] outline-none cursor-pointer"
                    >
                      {thaiMonthOptions.map((monthLabel, index) => (
                        <option
                          key={monthLabel}
                          value={index}
                          className="bg-[color:var(--surface-3)] text-[color:var(--text)]"
                        >
                          {monthLabel}
                        </option>
                      ))}
                    </select>
                    <MobileSemesterSelect
                      value={String(currentYear)}
                      label="เลือกปี"
                      compact
                      options={yearOptions.map((year) => ({ key: String(year), label: String(year) }))}
                      onChange={(year) =>
                        setSelectedDate(dateInMonth(selectedDate, Number(year), currentMonth))
                      }
                    />
                    <select
                      value={currentYear}
                      aria-label="เลือกปี"
                      onChange={(event) =>
                        setSelectedDate(
                          dateInMonth(
                            selectedDate,
                            Number(event.target.value),
                            currentMonth,
                          ),
                        )
                      }
                      className="hidden sm:block min-w-[6.5rem] bg-transparent text-lg font-bold text-muted outline-none cursor-pointer"
                    >
                      {yearOptions.map((year) => (
                        <option
                          key={year}
                          value={year}
                          className="bg-[color:var(--surface-3)] text-[color:var(--text)]"
                        >
                          {year}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex items-center gap-2 surface-2 p-1 rounded-2xl border border-muted">
                  <button
                    type="button"
                    onClick={() => changeCalendarPeriod(-1)}
                    className="p-2 hover:bg-[color:rgba(var(--accent-rgb),0.08)] rounded-xl transition-colors text-[color:var(--text)]"
                    aria-label={
                      calendarView === "month"
                        ? "เดือนก่อนหน้า"
                        : calendarView === "day"
                          ? "วันก่อนหน้า"
                          : "สัปดาห์ก่อนหน้า"
                    }
                  >
                    <ChevronLeftIcon size={18} />
                  </button>
                  <span className="min-w-[5.5rem] px-2 text-center text-sm font-medium text-[color:var(--text)]">
                    {navigationPeriodLabel}
                  </span>
                  <button
                    type="button"
                    onClick={() => changeCalendarPeriod(1)}
                    className="p-2 hover:bg-[color:rgba(var(--accent-rgb),0.08)] rounded-xl transition-colors text-[color:var(--text)]"
                    aria-label={
                      calendarView === "month"
                        ? "เดือนถัดไป"
                        : calendarView === "day"
                          ? "วันถัดไป"
                          : "สัปดาห์ถัดไป"
                    }
                  >
                    <ChevronRightIcon size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={goToToday}
                    className="rounded-xl px-2 py-1 text-xs font-bold text-accent transition-colors hover:bg-[color:rgba(var(--accent-rgb),0.08)]"
                  >
                    กลับวันนี้
                  </button>
                </div>
                <div className="rounded-2xl border border-muted surface-2 px-1">
                  <select
                    value={calendarView}
                    onChange={(event) =>
                      setCalendarView(
                        event.target.value as "week" | "day" | "month",
                      )
                    }
                    className="cursor-pointer bg-transparent py-2 pl-3 pr-2 text-xs font-bold text-[color:var(--text)] outline-none"
                    aria-label="เลือกรูปแบบปฏิทิน"
                  >
                    <option value="week">สัปดาห์</option>
                    <option value="day">รายวัน</option>
                    <option value="month">เดือน</option>
                  </select>
                </div>
              </div>

              <div className="px-3 py-4 sm:px-6 sm:py-6">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
                  <div className="min-w-0 sm:min-w-[220px]">
                    <label className="mb-1 block text-xs font-bold text-muted uppercase tracking-widest">
                      ภาคเรียน
                    </label>
                    <MobileSemesterSelect
                      value={selectedSemesterKey}
                      options={semesterOptions}
                      onChange={setSelectedSemesterKey}
                    />
                    <select
                      aria-label="เลือกภาคเรียน"
                      value={selectedSemesterKey}
                      onChange={(event) =>
                        setSelectedSemesterKey(event.target.value)
                      }
                      className="hidden sm:block w-full surface-2 border border-muted rounded-2xl px-4 py-2.5 text-sm text-[color:var(--text)] focus:outline-none focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:var(--accent)]/20"
                    >
                      {!semesterOptions.length && (
                        <option value="all">ทุกปีการศึกษา</option>
                      )}
                      {semesterOptions.map((option) => (
                        <option
                          key={option.key}
                          value={option.key}
                          className="bg-[color:var(--surface-3)] text-[color:var(--text)]"
                        >
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <label className="text-xs font-bold text-muted">
                    วันที่ที่ต้องการดู
                    <CalendarDateInput
                      value={selectedDate}
                      onChange={setSelectedDate}
                    />
                  </label>

                  <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
                    <div
                      className="flex items-center gap-3 text-xs font-semibold text-muted"
                      aria-label="คำอธิบายสีของกิจกรรม"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="h-2.5 w-2.5 rounded-full bg-emerald-500"
                          aria-hidden="true"
                        />
                        เรียน
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="h-2.5 w-2.5 rounded-full bg-rose-500"
                          aria-hidden="true"
                        />
                        สอบ
                      </span>
                    </div>
                    <div className="text-xs font-bold text-muted">
                      {calendarView === "week"
                        ? weekLabel
                        : format(parseISO(selectedDate), "d MMMM yyyy", {
                            locale: th,
                          })}
                    </div>
                  </div>
                </div>

                {loading && (
                  <p role="status" className="mb-3 text-sm text-muted">
                    กำลังโหลดปฏิทิน...
                  </p>
                )}
                {calendarView === "week" || calendarView === "day" ? (
                  <div className="overflow-x-auto pb-2">
                    {(() => {
                      const gridDays =
                        calendarView === "week"
                          ? weekDays
                          : [parseISO(selectedDate)];
                      const gridTemplateColumns = `var(--calendar-time-width) repeat(${gridDays.length}, minmax(0, 1fr))`;

                      return (
                        <div
                          className={`w-full overflow-hidden rounded-2xl border border-muted bg-[color:var(--surface)] [--calendar-time-width:40px] sm:[--calendar-time-width:68px] ${calendarView === "week" ? "sm:min-w-[992px]" : ""}`}
                        >
                          <div
                            className="grid bg-[color:var(--surface-2)]"
                            style={{ gridTemplateColumns }}
                          >
                            <div className="flex items-end justify-center px-1 pb-3 text-xs font-bold calendar-grid-text">
                              เวลา
                            </div>
                            {gridDays.map((date) => {
                              const dateKey = format(date, "yyyy-MM-dd");
                              const isToday = dateKey === todayDateKey;
                              const isSelected = dateKey === selectedDate;
                              return (
                                <button
                                  key={dateKey}
                                  type="button"
                                  onClick={() => {
                                    setSelectedDate(dateKey);
                                    setIsAddingEvent(false);
                                  }}
                                  aria-label={format(date, "EEEE d MMMM yyyy", { locale: th })}
                                  aria-pressed={isSelected}
                                  className={`min-w-0 px-0.5 py-2 text-center transition sm:px-2 sm:py-3 hover:bg-primary/[0.06] ${isSelected ? "bg-primary/[0.07]" : ""}`}
                                >
                                  <span className="block text-xs font-bold calendar-grid-text sm:uppercase sm:tracking-widest">
                                    <span className="sm:hidden">{["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."][date.getDay()]}</span>
                                    <span className="hidden sm:inline">{timetableDayLabels[date.getDay()]}</span>
                                  </span>
                                  <span
                                    className={`mx-auto mt-1 flex h-7 w-full max-w-7 items-center justify-center rounded-full text-sm font-bold calendar-grid-text sm:h-9 sm:w-9 sm:max-w-none sm:text-xl ${
                                      isToday ? "bg-primary" : ""
                                    }`}
                                  >
                                    {format(date, "d")}
                                  </span>
                                </button>
                              );
                            })}
                          </div>

                          <div
                            className="grid bg-[color:var(--surface-2)]"
                            style={{ gridTemplateColumns }}
                          >
                            <div className="flex items-center justify-center px-1 text-xs font-bold calendar-grid-text">
                              ทั้งวัน
                            </div>
                            {gridDays.map((date) => {
                              const dateKey = format(date, "yyyy-MM-dd");
                              const allDayEvents = visibleEvents.filter(
                                (event) =>
                                  Boolean(event.all_day) &&
                                  format(
                                    parseCalendarDateTime(event.start_time),
                                    "yyyy-MM-dd",
                                  ) === dateKey,
                              );
                              return (
                                <div
                                  key={dateKey}
                                  className="min-w-0 min-h-8 p-0.5 sm:min-h-[52px] sm:p-1.5"
                                >
                                  {allDayEvents.slice(0, 2).map((event) => {
                                    const type =
                                      event.source === "study_log"
                                        ? "log"
                                        : (resolveEventType(event) ?? "other");
                                    return (
                                      <button
                                        key={event.id}
                                        type="button"
                                        onClick={() => {
                                          setSelectedDate(dateKey);
                                          setIsAddingEvent(false);
                                        }}
                                        className={`mb-1 block w-full truncate rounded-md px-2 py-1 text-left text-[11px] font-bold calendar-grid-text ${calendarChipClassByType[type]}`}
                                        title={event.title}
                                      >
                                        {event.subject?.name ?? event.title}
                                      </button>
                                    );
                                  })}
                                  {allDayEvents.length > 2 ? (
                                    <span className="px-1 text-xs font-bold calendar-grid-text">
                                      +{allDayEvents.length - 2} รายการ
                                    </span>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>

                          <div className="grid" style={{ gridTemplateColumns }}>
                            <div
                              className="relative border-r border-muted/70"
                              style={{
                                height: calendarTimeSlots * calendarSlotHeight,
                              }}
                            >
                              {Array.from(
                                {
                                  length:
                                    calendarEndHour - calendarStartHour + 1,
                                },
                                (_, index) => (
                                  <span
                                    key={`time-line-${index}`}
                                    aria-hidden="true"
                                    className="pointer-events-none absolute inset-x-0 z-0 border-t border-muted/60"
                                    style={{
                                      top: index * 2 * calendarSlotHeight,
                                    }}
                                  />
                                ),
                              )}
                              {Array.from(
                                {
                                  length:
                                    calendarEndHour - calendarStartHour + 1,
                                },
                                (_, index) => {
                                  const hour = calendarStartHour + index;
                                  const top = index * 2 * calendarSlotHeight;
                                  return (
                                    <span
                                      key={hour}
                                      className="absolute right-1 z-[1] bg-[color:var(--surface)] px-1 text-xs font-semibold leading-4 calendar-grid-text"
                                      style={{ top: Math.min(top + 2, calendarTimeSlots * calendarSlotHeight - 18) }}
                                    >
                                      {hour === 24
                                        ? "00:00"
                                        : `${String(hour).padStart(2, "0")}:00`}
                                    </span>
                                  );
                                },
                              )}
                            </div>

                            {gridDays.map((date) => {
                              const dateKey = format(date, "yyyy-MM-dd");
                              const timedEvents = visibleEvents.filter(
                                (event) =>
                                  !event.all_day &&
                                  format(
                                    parseCalendarDateTime(event.start_time),
                                    "yyyy-MM-dd",
                                  ) === dateKey,
                              );
                              return (
                                <div
                                  key={dateKey}
                                  className={`relative min-w-0 border-r border-muted/45 last:border-r-0 ${dateKey === selectedDate ? "bg-primary/[0.025]" : ""}`}
                                  style={{
                                    height:
                                      calendarTimeSlots * calendarSlotHeight,
                                  }}
                                >
                                  {Array.from(
                                    {
                                      length:
                                        calendarEndHour - calendarStartHour + 1,
                                    },
                                    (_, index) => (
                                      <span
                                        key={`grid-line-${index}`}
                                        aria-hidden="true"
                                        className="pointer-events-none absolute inset-x-0 z-0 border-t border-muted/60"
                                        style={{
                                          top: index * 2 * calendarSlotHeight,
                                        }}
                                      />
                                    ),
                                  )}
                                  {layoutTimedEvents(timedEvents).map(
                                    ({ event, column, columns }) => {
                                      const start = parseCalendarDateTime(
                                        event.start_time,
                                      );
                                      const parsedEnd = event.end_time
                                        ? parseCalendarDateTime(event.end_time)
                                        : null;
                                      const startMinutes =
                                        start.getHours() * 60 +
                                        start.getMinutes();
                                      const endMinutes =
                                        parsedEnd &&
                                        !Number.isNaN(parsedEnd.getTime())
                                          ? Math.max(
                                              parsedEnd.getHours() * 60 +
                                                parsedEnd.getMinutes(),
                                              startMinutes + 30,
                                            )
                                          : startMinutes + 60;
                                      const visibleStart = Math.max(
                                        startMinutes,
                                        calendarStartHour * 60,
                                      );
                                      const visibleEnd = Math.min(
                                        endMinutes,
                                        calendarEndHour * 60,
                                      );
                                      if (
                                        visibleEnd <= calendarStartHour * 60 ||
                                        visibleStart >= calendarEndHour * 60
                                      )
                                        return null;
                                      const type =
                                        event.source === "study_log"
                                          ? "log"
                                          : (resolveEventType(event) ??
                                            "other");
                                      const eventClass =
                                        type === "exam"
                                          ? "border-rose-500/60 bg-rose-500/15"
                                          : type === "class"
                                            ? "border-emerald-500/60 bg-emerald-500/15"
                                            : "border-sky-500/60 bg-sky-500/15";
                                      const top =
                                        ((visibleStart -
                                          calendarStartHour * 60) /
                                          30) *
                                        calendarSlotHeight;
                                      const height = Math.max(
                                        ((visibleEnd - visibleStart) / 30) *
                                          calendarSlotHeight,
                                        25,
                                      );
                                      const room =
                                        event.room ?? event.metadata?.room;
                                      return (
                                        <button
                                          key={event.id}
                                          type="button"
                                          onClick={() => {
                                            setSelectedDate(dateKey);
                                            setIsAddingEvent(false);
                                          }}
                                          title={`${type === "exam" ? "สอบ · " : ""}${event.subject?.name ?? event.title} · ${formatEventTime(event)}`}
                                          className={`absolute left-1 right-1 z-10 overflow-hidden rounded-md border px-2 py-1 text-left text-[11px] font-bold leading-tight calendar-grid-text shadow-sm transition hover:brightness-95 ${eventClass}`}
                                          style={{
                                            top,
                                            height,
                                            left: `calc(${(column / columns) * 100}% + 4px)`,
                                            right: "auto",
                                            width: `calc(${100 / columns}% - 8px)`,
                                          }}
                                        >
                                          <span className="block truncate">
                                            {type === "exam"
                                              ? `สอบ · ${event.subject?.name ?? event.title}`
                                              : (event.subject?.name ??
                                                event.title)}
                                          </span>
                                          {height >= 42 ? (
                                            <span className="mt-0.5 block truncate text-[10px] font-medium">
                                              {formatEventTime(event)}
                                              {room ? ` · ห้อง ${room}` : ""}
                                            </span>
                                          ) : null}
                                        </button>
                                      );
                                    },
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="w-full pb-2">
                    <div className="grid w-full min-w-0 grid-cols-7 gap-2">
                      {dayHeaders.map((dayLabel, index) => (
                        <div
                          key={dayLabel}
                          className={`text-center text-xs font-bold uppercase tracking-wider mb-3 ${
                            index === 0
                              ? "text-rose-600"
                              : index === 6
                                ? "text-accent"
                                : "text-[color:rgba(var(--text),0.72)]"
                          }`}
                        >
                          {dayLabel}
                        </div>
                      ))}

                      {blankDays.map((blankKey) => (
                        <div key={blankKey} className="h-32 opacity-0" />
                      ))}

                      {monthDays.map((day) => {
                        const dayDate = new Date(
                          currentYear,
                          currentMonth,
                          day,
                        );
                        const dayKey = format(dayDate, "yyyy-MM-dd");
                        const dayEvents = getEventsForDay(day);
                        const isSelected = dayKey === selectedDate;
                        const isToday =
                          dayKey === format(new Date(), "yyyy-MM-dd");
                        const weekDay = dayDate.getDay();
                        const isWeekend = weekDay === 0 || weekDay === 6;

                        return (
                          <button
                            key={day}
                            type="button"
                            onClick={() => {
                              setSelectedDate(dayKey);
                              setIsAddingEvent(false);
                            }}
                            className={`h-32 rounded-2xl p-2.5 border transition-all cursor-pointer relative group ${
                              isSelected
                                ? "bg-primary/10 border-primary/40 shadow-glow"
                                : "bg-[color:rgba(var(--on-accent-rgb),0.04)] border-muted hover:border-[color:rgba(var(--accent-rgb),0.45)]"
                            }`}
                          >
                            <div
                              className={`text-base font-extrabold leading-none ${
                                isToday
                                  ? "text-accent"
                                  : isWeekend
                                    ? weekDay === 0
                                      ? "text-rose-400"
                                      : "text-accent"
                                    : "text-[color:var(--text)]"
                              }`}
                            >
                              {day}
                            </div>
                            <div className="mt-2 space-y-1.5">
                              {dayEvents.slice(0, 2).map((event) => {
                                const badge = resolveEventBadge(event);
                                const resolvedType =
                                  event.source === "study_log"
                                    ? "log"
                                    : (resolveEventType(event) ?? "other");
                                const eventTimeText = formatEventTime(event);
                                const examInfo = parseExamDescription(
                                  event.description,
                                );
                                const examTopic =
                                  examInfo.examScope ||
                                  (event.title ?? "")
                                    .replace(/^สอบ:\s*/u, "")
                                    .trim();
                                const subjectName = event.subject?.name ?? "";
                                const compactTitle =
                                  resolvedType === "exam"
                                    ? `สอบ ${subjectName || examTopic || ""} ${eventTimeText}`.trim()
                                    : event.title || badge.label;
                                return (
                                  <div
                                    key={event.id}
                                    className={`line-clamp-2 rounded-lg px-2 py-1.5 text-xs font-bold leading-snug shadow-sm ${calendarChipClassByType[resolvedType]}`}
                                    title={
                                      resolvedType === "exam"
                                        ? `${badge.label}: ${subjectName || "-"} | ${examTopic || "-"} | ${eventTimeText}`
                                        : `${badge.label}: ${event.title} | ${eventTimeText}`
                                    }
                                  >
                                    {compactTitle}
                                  </div>
                                );
                              })}
                              {dayEvents.length > 2 ? (
                                <div className="rounded-lg border border-muted surface-2 px-2 py-1.5 text-xs font-semibold leading-tight text-[color:rgba(var(--text),0.78)]">
                                  +{dayEvents.length - 2} รายการ
                                </div>
                              ) : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 bg-[color:var(--panel-bg)] backdrop-blur-xl border border-muted rounded-[32px] overflow-hidden p-5 shadow-soft">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className="text-xs font-bold text-muted uppercase tracking-widest">
                  สถานะรายวิชา
                </h3>
                <span className="text-xs font-semibold text-muted">
                  {filteredSubjectStatuses.length}/{subjectStatuses.length} วิชา
                </span>
              </div>
              {subjectStatuses.length === 0 ? (
                <div className="rounded-2xl border border-muted surface-2 px-4 py-8 text-center text-sm text-muted">
                  ยังไม่มีรายวิชาในเทอมที่เลือก
                </div>
              ) : filteredSubjectStatuses.length === 0 ? (
                <div className="rounded-2xl border border-muted surface-2 px-4 py-8 text-center text-sm text-muted">
                  ไม่พบรายวิชาที่ค้นหา
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  {filteredSubjectStatuses.map((subject) => {
                    const isActive =
                      subject.studied || subject.activity !== "none";
                    const badgeLabel =
                      subject.activity === "exam"
                        ? "EXAM"
                        : subject.activity === "class"
                          ? "ACTIVE"
                          : "PENDING";
                    const badgeClass =
                      subject.activity === "class"
                        ? "bg-primary/10 text-primary border-primary/20"
                        : subject.activity === "exam"
                          ? "bg-rose-500/10 text-rose-500 border-rose-500/30"
                          : "surface-2 text-muted border-muted";
                    const icon =
                      subject.activity === "class" ? (
                        <BookOpenIcon size={24} />
                      ) : subject.activity === "exam" ? (
                        <ClockIcon size={24} />
                      ) : (
                        <ClockIcon size={24} />
                      );

                    return (
                      <div
                        key={subject.id}
                        className={`grid grid-cols-[auto_minmax(0,1fr)] items-start gap-4 rounded-[28px] border p-4 transition-all sm:p-5 ${
                          isActive
                            ? "border-muted surface"
                            : "border-muted surface-2"
                        }`}
                      >
                        <div
                          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
                            subject.activity === "class"
                              ? "bg-emerald-500/20 text-emerald-300"
                              : subject.activity === "exam"
                                ? "bg-rose-500/15 text-rose-500"
                                : "surface-2 text-muted"
                          }`}
                        >
                          {icon}
                        </div>
                        <div className="min-w-0">
                          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                            <h4 className="min-w-0 flex-1 truncate font-bold">
                              {subject.name}
                            </h4>
                            <div
                              className={`shrink-0 rounded-full border px-3 py-1 text-[10px] font-bold uppercase ${badgeClass}`}
                            >
                              {badgeLabel}
                            </div>
                          </div>
                          <p className="mt-1 text-xs leading-5 text-muted">
                            สถานะ: {subject.studied ? "กำลังเรียน • " : ""}
                            {subject.hasClass && subject.hasExam
                              ? "มีเรียน • มีสอบ"
                              : subject.hasExam
                                ? "มีสอบ"
                                : subject.hasClass
                                  ? "มีเรียน"
                                  : "ยังไม่กำหนด"}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => addClassFromTimetable(subject.id)}
                              disabled={saving}
                              aria-pressed={subject.hasClass}
                              className={`text-[10px] font-bold px-3 py-1 rounded-full border transition disabled:opacity-60 ${
                                subject.hasClass
                                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600"
                                  : "border-muted text-muted hover:border-emerald-500/40 hover:text-emerald-500"
                              }`}
                            >
                              ตั้งเป็นเรียน
                            </button>
                            <button
                              type="button"
                              onClick={() => openExamFormForSubject(subject.id)}
                              disabled={saving}
                              aria-pressed={subject.activity === "exam"}
                              className={`text-[10px] font-bold px-3 py-1 rounded-full border transition disabled:opacity-60 ${
                                subject.activity === "exam"
                                  ? "border-primary/40 bg-primary/10 text-primary"
                                  : "border-muted text-muted hover:border-primary/40 hover:text-primary"
                              }`}
                            >
                              ตั้งเป็นสอบ
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <aside
            className={`flex flex-col gap-6 ${embedded ? "xl:col-span-3 xl:sticky xl:top-6" : "lg:col-span-3 lg:sticky lg:top-6"}`}
          >
            {!isAddingEvent ? (
              <section className="overflow-hidden rounded-[32px] border border-muted bg-[color:var(--panel-bg)] backdrop-blur-xl shadow-soft">
                <div className="flex items-start justify-between gap-4 px-6 py-6">
                  <div>
                    <h3 className="text-4xl font-black leading-none text-[color:var(--text)]">
                      {format(parseISO(selectedDate), "d")}
                    </h3>
                    <p className="mt-2 text-sm font-bold tracking-widest uppercase text-accent">
                      {format(parseISO(selectedDate), "LLLL", { locale: th })}
                    </p>
                    <p className="mt-3 text-xs font-bold text-muted uppercase tracking-widest">
                      {selectedEvents.length} รายการ
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={openAddForm}
                    className="bg-[color:var(--accent)] text-[color:var(--on-accent)] p-2.5 rounded-full shadow-glow transition-all hover:opacity-90 active:scale-95"
                    aria-label="เพิ่มกิจกรรมใหม่"
                    title="เพิ่มกิจกรรมใหม่"
                  >
                    <PlusIcon size={20} />
                  </button>
                </div>

                <div className="space-y-4 px-6 pb-6">
                  {selectedEvents.length > 0 ? (
                    selectedEvents.map((event) => {
                      const badge = resolveEventBadge(event);
                      const canEdit =
                        event.id > 0 && event.source !== "study_log";
                      const resolvedType = resolveEventType(event);
                      const examInfo =
                        resolvedType === "exam"
                          ? parseExamDescription(event.description)
                          : null;
                      return (
                        <article
                          key={event.id}
                          className={`p-4 rounded-[24px] surface-2 border transition-all group ${
                            resolvedType === "exam"
                              ? "border-rose-500/40 bg-rose-500/[0.06] hover:border-rose-500/60"
                              : "border-muted hover:border-primary/40"
                          }`}
                        >
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-semibold ${badge.className}`}
                            >
                              {badge.label}
                            </span>
                            <span className="text-xs font-bold text-muted">
                              {formatEventTime(event)}
                            </span>
                          </div>
                          <h4 className="font-bold text-lg text-[color:var(--text)]">
                            {event.title}
                          </h4>
                          {event.subject?.name ? (
                            <p className="mt-1 text-xs text-muted">
                              {event.subject.name}
                            </p>
                          ) : null}
                          {event.room ? (
                            <p className="mt-1 text-xs text-muted">
                              ห้อง: {event.room}
                            </p>
                          ) : null}
                          {examInfo ? (
                            <div className="mt-3 space-y-2 rounded-2xl border border-rose-500/25 bg-rose-500/10 p-3 text-sm">
                              <p className="text-[color:var(--text)]">
                                <span className="font-semibold">
                                  วิชาที่สอบ:
                                </span>{" "}
                                {event.subject?.name ?? "-"}
                              </p>
                              {examInfo.examScope ? (
                                <p className="text-muted">
                                  <span className="font-semibold text-[color:var(--text)]">
                                    เรื่องที่สอบ:
                                  </span>{" "}
                                  {examInfo.examScope}
                                </p>
                              ) : null}
                              {examInfo.examMethod ? (
                                <p className="text-muted">
                                  <span className="font-semibold text-[color:var(--text)]">
                                    รูปแบบการสอบ:
                                  </span>{" "}
                                  {examInfo.examMethod}
                                </p>
                              ) : null}
                              {examInfo.preparationNotes ? (
                                <p className="whitespace-pre-line text-muted">
                                  <span className="font-semibold text-[color:var(--text)]">
                                    แนวทางเตรียมตัว:
                                  </span>{" "}
                                  {examInfo.preparationNotes}
                                </p>
                              ) : null}
                              {examInfo.generalNotes ? (
                                <p className="whitespace-pre-line text-muted">
                                  <span className="font-semibold text-[color:var(--text)]">
                                    หมายเหตุ:
                                  </span>{" "}
                                  {examInfo.generalNotes}
                                </p>
                              ) : null}
                            </div>
                          ) : event.description ? (
                            <p className="mt-2 text-xs text-muted">
                              {event.description}
                            </p>
                          ) : null}
                          {canEdit ? (
                            <div className="mt-4 flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => startEditEvent(event)}
                                className="text-[10px] font-bold bg-primary text-[color:var(--on-accent)] px-3 py-1.5 rounded-full hover:opacity-90 transition-all"
                              >
                                แก้ไข
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteEvent(event)}
                                disabled={deletingId === event.id}
                                className="text-[10px] font-bold px-3 py-1.5 rounded-full border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 transition disabled:opacity-60"
                              >
                                {deletingId === event.id ? "กำลังลบ..." : "ลบ"}
                              </button>
                            </div>
                          ) : null}
                        </article>
                      );
                    })
                  ) : (
                    <div className="p-6 rounded-[24px] surface-2 border border-muted text-center">
                      <p className="text-sm font-semibold text-[color:var(--text)]">
                        ยังไม่มีรายการในวันที่เลือก
                      </p>
                      <p className="text-xs text-muted mt-1">
                        กดปุ่ม + เพื่อเพิ่มกิจกรรมใหม่
                      </p>
                    </div>
                  )}
                </div>
              </section>
            ) : (
              <section className="mx-auto w-full max-w-[400px] overflow-hidden rounded-[32px] border border-muted bg-[color:var(--panel-bg)] shadow-soft">
                <div className="flex items-start justify-between gap-3 px-6 pb-4 pt-6">
                  <div>
                    <h3 className="text-xl font-black leading-snug text-[color:var(--text)]">
                      {editingEventId ? "แก้ไขตาราง" : "เพิ่มตารางใหม่"}
                    </h3>
                    <p className="mt-2 text-sm font-bold text-muted">
                      {form.date && !Number.isNaN(parseISO(form.date).getTime())
                        ? format(parseISO(form.date), "d MMMM yyyy", {
                            locale: th,
                          })
                        : "เลือกวันที่กิจกรรม"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddingEvent(false);
                      setEditingEventId(null);
                      setForm((prev) => ({
                        ...prev,
                        title: "",
                        examTopic: "",
                        examMethod: "",
                        examNotes: "",
                        room: "",
                        description: "",
                      }));
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-muted surface-2 text-base font-bold text-muted transition hover:border-[color:var(--accent)] hover:text-accent"
                    aria-label="ปิดฟอร์มเพิ่มตาราง"
                  >
                    ×
                  </button>
                </div>

                <form
                  id="calendar-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    createEvent();
                  }}
                  className="grid gap-4 px-6 pb-6 [&_input]:text-base [&_select]:text-base"
                >
                  <div>
                    <label className="mb-1.5 block text-sm font-black text-[color:var(--text)]">
                      ประเภทกิจกรรม
                    </label>
                    <div className="grid h-10 grid-cols-2 gap-1 rounded-xl border border-muted surface-2 p-1">
                      <button
                        type="button"
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            type: "class",
                            examTopic: "",
                            examMethod: "",
                            examNotes: "",
                          }))
                        }
                        aria-pressed={form.type === "class"}
                        className={`rounded-lg text-sm font-bold transition ${
                          form.type === "class"
                            ? "bg-emerald-500 text-white shadow-sm"
                            : "text-muted hover:bg-emerald-500/10 hover:text-emerald-500"
                        }`}
                      >
                        เรียน
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setForm((prev) => ({ ...prev, type: "exam" }))
                        }
                        aria-pressed={form.type === "exam"}
                        className={`rounded-lg text-sm font-bold transition ${
                          form.type === "exam"
                            ? "bg-rose-500 text-white shadow-sm"
                            : "text-muted hover:bg-rose-500/10 hover:text-rose-500"
                        }`}
                      >
                        สอบ
                      </button>
                    </div>
                  </div>

                  <label className="block text-sm font-bold">
                    ชื่อกิจกรรม
                    <input
                      required
                      maxLength={255}
                      value={form.title}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          title: event.target.value,
                        }))
                      }
                      className="mt-1 w-full rounded-xl border border-muted surface-2 px-3 py-2 text-base"
                    />
                  </label>
                  <label className="block text-sm font-bold">
                    รายวิชา
                    <select
                      required
                      value={form.subjectId}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          subjectId: event.target.value,
                        }))
                      }
                      className="mt-1 w-full rounded-xl border border-muted surface-2 px-3 py-2 text-base"
                    >
                      <option value="">เลือกรายวิชา</option>
                      {filteredSubjects.map((subject) => (
                        <option key={subject.id} value={subject.id}>
                          {subject.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm font-bold">
                    ห้องเรียน / ห้องสอบ
                    <input
                      maxLength={255}
                      value={form.room}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          room: event.target.value,
                        }))
                      }
                      placeholder="เช่น อาคาร 3 ห้อง 305"
                      className="mt-1 w-full rounded-xl border border-muted surface-2 px-3 py-2 text-base"
                    />
                  </label>
                  <div className="block text-sm font-bold">
                    วันที่
                    <CalendarDateInput
                      value={form.date}
                      onChange={(date) =>
                        setForm((prev) => ({ ...prev, date }))
                      }
                    />
                  </div>
                  <label className="flex items-center gap-2 text-base">
                    <input
                      type="checkbox"
                      checked={form.allDay}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          allDay: event.target.checked,
                        }))
                      }
                    />{" "}
                    ทั้งวัน
                  </label>
                  {!form.allDay && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="min-w-0 text-sm font-bold">
                        เวลาเริ่ม
                        <TimePicker
                          value={form.startTime.slice(0, 5)}
                          onChange={(value) =>
                            setForm((prev) => ({ ...prev, startTime: value }))
                          }
                          label="เวลาเริ่ม"
                          className="mt-1 w-full"
                          compact
                        />
                      </div>
                      <div className="min-w-0 text-sm font-bold">
                        เวลาสิ้นสุด
                        <TimePicker
                          value={form.endTime.slice(0, 5)}
                          onChange={(value) =>
                            setForm((prev) => ({ ...prev, endTime: value }))
                          }
                          label="เวลาสิ้นสุด"
                          className="mt-1 w-full"
                          compact
                        />
                      </div>
                    </div>
                  )}
                  {form.type === "exam" && (
                    <>
                      <label className="block text-sm font-bold">
                        เรื่องที่สอบ
                        <input
                          value={form.examTopic}
                          onChange={(event) =>
                            setForm((prev) => ({
                              ...prev,
                              examTopic: event.target.value,
                            }))
                          }
                          className="mt-1 w-full rounded-xl border border-muted surface-2 px-3 py-2 text-base"
                        />
                      </label>
                      <label className="block text-sm font-bold">
                        รูปแบบการสอบ
                        <input
                          value={form.examMethod}
                          onChange={(event) =>
                            setForm((prev) => ({
                              ...prev,
                              examMethod: event.target.value,
                            }))
                          }
                          className="mt-1 w-full rounded-xl border border-muted surface-2 px-3 py-2 text-base"
                        />
                      </label>
                      <label className="block text-sm font-bold">
                        แนวทางเตรียมตัว
                        <textarea
                          value={form.examNotes}
                          onChange={(event) =>
                            setForm((prev) => ({
                              ...prev,
                              examNotes: event.target.value,
                            }))
                          }
                          className="mt-1 w-full rounded-xl border border-muted surface-2 px-3 py-2 text-base"
                        />
                      </label>
                    </>
                  )}
                  <label className="block text-sm font-bold">
                    รายละเอียดเพิ่มเติม
                    <textarea
                      value={form.description}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          description: event.target.value,
                        }))
                      }
                      className="mt-1 min-h-24 w-full rounded-xl border border-muted surface-2 px-3 py-2 text-base"
                    />
                  </label>
                  {error && (
                    <p
                      role="alert"
                      className="text-base font-semibold text-red-600"
                      style={{ WebkitTextFillColor: "currentColor" }}
                    >
                      {error}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={saving || loading}
                    className="w-full rounded-full bg-primary px-4 py-2.5 text-base font-bold text-[color:var(--on-accent)] disabled:opacity-50"
                  >
                    {saving
                      ? "กำลังบันทึก..."
                      : editingEventId
                        ? "บันทึกการแก้ไข"
                        : "บันทึกรายการ"}
                  </button>
                </form>
              </section>
            )}

            <section className="bg-[color:var(--panel-bg)] backdrop-blur-xl border border-muted rounded-[32px] overflow-hidden p-5 shadow-soft">
              <h5 className="text-xs font-bold text-muted uppercase mb-4 px-1">
                สรุปภาพรวมสัปดาห์
              </h5>
              <p className="mb-4 text-xs text-muted">{weekLabel}</p>
              <div className="grid grid-cols-7 items-end gap-1">
                {weeklySummary.values.map((count, index) => {
                  const date = format(weekDays[index], "yyyy-MM-dd");
                  return (
                    <button
                      key={date}
                      type="button"
                      onClick={() => setSelectedDate(date)}
                      aria-label={`${format(weekDays[index], "d MMMM", { locale: th })}: ${count} รายการ`}
                      aria-pressed={date === selectedDate}
                      className="min-w-0 text-center text-xs"
                    >
                      <span className="block font-bold">{count}</span>
                      <span className="mt-1 flex h-20 items-end">
                        <span
                          className={`block w-full rounded-t-lg ${date === selectedDate ? "bg-primary" : "bg-emerald-500/40"}`}
                          style={{
                            height: `${Math.max(3, (count / weeklySummary.max) * 100)}%`,
                          }}
                        />
                      </span>
                      <span className="mt-2 block text-muted">
                        {["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."][index]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
};
