import { Filter, PieChart } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../services/api";
import { DocumentSummaryPage } from "./DocumentSummaryPage";

type SubjectOption = {
  id: number;
  name: string;
};

type StudyLogEntry = {
  id: number;
  title?: string | null;
  note?: string | null;
  log_date: string;
  duration_minutes?: number | null;
  mood?: string | null;
};

type StudySummaryRange = "today" | "week" | "month" | "year";

type DecoratedLog = StudyLogEntry & {
  subjectName: string;
};

const rangeOptions: Array<{ key: StudySummaryRange; label: string }> = [
  { key: "today", label: "วันนี้" },
  { key: "week", label: "สัปดาห์นี้" },
  { key: "month", label: "เดือนนี้" },
  { key: "year", label: "ปีนี้" },
];

const getRangeBounds = (range: StudySummaryRange) => {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);

  if (range === "today") {
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  if (range === "week") {
    const dayIndex = (now.getDay() + 6) % 7;
    start.setDate(now.getDate() - dayIndex);
    start.setHours(0, 0, 0, 0);
    end.setTime(start.getTime());
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  if (range === "month") {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    end.setMonth(now.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  start.setMonth(0, 1);
  start.setHours(0, 0, 0, 0);
  end.setMonth(11, 31);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

const safeTrim = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

export const StudyDigestPage = () => {
  const navigate = useNavigate();
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [selectedSubject, setSelectedSubject] = useState("all");
  const [range, setRange] = useState<StudySummaryRange>("today");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<DecoratedLog[]>([]);

  const loadLogs = async (selectedRange: StudySummaryRange) => {
    setLoading(true);
    setError(null);
    try {
      const subjectResponse = await api.get("/subjects");
      const payload = Array.isArray(subjectResponse.data)
        ? subjectResponse.data
        : Array.isArray(subjectResponse.data?.data)
          ? subjectResponse.data.data
          : [];

      const nextSubjects: SubjectOption[] = payload
        .map((item: any) => ({
          id: Number(item.id),
          name: String(item.name ?? item.subject_name ?? ""),
        }))
        .filter(
          (item: SubjectOption) =>
            Number.isFinite(item.id) && item.name.trim() !== "",
        );

      setSubjects(nextSubjects);

      const responses = await Promise.all(
        nextSubjects.map((subject) =>
          api.get(`/subjects/${subject.id}/study-logs`).then((response) => ({
            subjectName: subject.name,
            logs: Array.isArray(response.data?.data)
              ? response.data.data
              : Array.isArray(response.data)
                ? response.data
                : [],
          })),
        ),
      );

      const { start, end } = getRangeBounds(selectedRange);
      const nextLogs = responses.flatMap(({ subjectName, logs }) =>
        logs
          .filter((log: StudyLogEntry) => {
            const logDate = new Date(log.log_date);
            return (
              !Number.isNaN(logDate.getTime()) &&
              logDate >= start &&
              logDate <= end
            );
          })
          .map((log: StudyLogEntry) => ({
            ...log,
            title: safeTrim(log.title),
            note: safeTrim(log.note),
            mood: safeTrim(log.mood),
            subjectName,
          })),
      );

      nextLogs.sort(
        (a, b) =>
          new Date(b.log_date).getTime() - new Date(a.log_date).getTime(),
      );
      setLogs(nextLogs);
    } catch {
      setError("โหลดข้อมูลสรุปการเรียนไม่สำเร็จ ลองใหม่อีกครั้งได้เลย");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadLogs(range);
  }, [range]);

  return (
    <div className="space-y-6 bg-[var(--bg-gradient)] pb-6 text-[color:var(--text)]">
      <section className="mx-auto w-full max-w-6xl rounded-[2rem] border border-[color:var(--border)] bg-[color:var(--surface)] px-6 pb-8 pt-4 shadow-[0_14px_34px_rgba(15,23,42,0.12)]">
        <button
          type="button"
          onClick={() => navigate("/ai-assistant")}
          className="group mb-5 inline-flex w-fit items-center gap-1.5 rounded-full border border-slate-200/90 bg-slate-50/90 px-4 py-2 text-xs font-bold text-slate-600 shadow-[0_4px_12px_rgba(148,163,184,0.12)] transition"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
          กลับหน้าหลัก
        </button>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.32em] text-[color:var(--accent-ink)]">
              Study Summary
            </p>
            <h1 className="mt-1.5 text-[2.1rem] font-bold leading-tight text-[color:var(--text)]">
              สรุปการเรียน
            </h1>
            <p className="mt-2 max-w-2xl text-base leading-7 text-[color:var(--muted)]">
              รองรับการสรุปข้อมูลจากไฟล์ Word (.doc/.docx), PDF และ TXT
              พร้อมทั้งสามารถเลือกสรุปจากไฟล์เสียงหรือเสียงที่อัดสด
    
            </p>
          </div>
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full shadow-[0_8px_18px_rgba(var(--accent-rgb),0.18)] ring-1"
            style={{
              background: "rgba(var(--accent-rgb),0.10)",
              color: "var(--accent-ink)",
              borderColor: "rgba(var(--accent-rgb),0.14)",
            }}
          >
            <PieChart size={18} />
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-6xl space-y-6 px-6">
        <section className="rounded-[1.75rem] border border-[color:var(--border)] bg-[color:var(--surface)] p-6 shadow-[0_10px_26px_rgba(15,23,42,0.10)] backdrop-blur">
          <div className="mb-4 flex items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border"
              style={{
                borderColor: "rgba(var(--accent-rgb),0.16)",
                background: "rgba(var(--accent-rgb),0.10)",
                color: "var(--accent-ink)",
              }}
            >
              <Filter size={16} />
            </div>
            <select
              value={selectedSubject}
              onChange={(event) => setSelectedSubject(event.target.value)}
              className="rounded-full border border-[color:var(--border)] bg-[color:var(--surface-2)] px-4 py-2 text-sm font-bold text-[color:var(--text)] outline-none shadow-sm"
            >
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.name}>
                  {subject.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex rounded-full bg-[color:var(--surface-2)] p-1.5">
            {rangeOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setRange(option.key)}
                className={`flex-1 rounded-full px-4 py-2.5 text-sm font-bold transition ${range === option.key ? "bg-[color:var(--surface)] shadow-sm" : "text-[color:var(--muted)] hover:text-[color:var(--text)]"}`}
                style={
                  range === option.key
                    ? {
                        color: "var(--accent-ink)",
                        boxShadow: "0 8px 18px rgba(var(--accent-rgb),0.12)",
                      }
                    : undefined
                }
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-[1.75rem] border border-[color:var(--border)] bg-[color:var(--surface)] p-6 shadow-[0_10px_26px_rgba(15,23,42,0.10)] backdrop-blur">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="text-lg font-bold text-[color:var(--text)]">
                สรุปจากไฟล์และเก็บถาวร
              </h3>
              <p className="text-sm text-[color:var(--muted)]">
                อัปโหลดเอกสารหรือไฟล์เสียงเพื่อสรุปด้วย AI
                แล้วบันทึกสรุปหรือเก็บถาวรได้จากหน้านี้
              </p>
            </div>
            <span
              className="rounded-full border px-3 py-1 text-[10px] font-bold shadow-sm"
              style={{
                borderColor: "rgba(var(--accent-rgb),0.18)",
                color: "var(--accent-ink)",
                background: "var(--surface-2)",
              }}
            >
              รองรับ PDF, DOCX, TXT, เสียง
            </span>
          </div>

          <div className="mt-5">
            <DocumentSummaryPage embedded />
          </div>
        </section>
      </div>
    </div>
  );
};
