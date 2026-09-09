import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ClipboardList, RotateCcw, Save, Target, Trophy } from 'lucide-react';
import { api } from '../../services/api';
import { useDefaultSemesterSelection, useSemesterOptions } from '../../hooks/useSemesterOptions';
import { filterBySemester } from '../../utils/semester';
import { emitSubjectsUpdated, subscribeSubjectsUpdated } from '../../utils/subjectSync';

type GoalSubjectOption = {
  id: number;
  name: string;
  semester_id?: number | null;
  semester?: number | null;
  academic_year?: number | null;
};

type SubjectSummary = {
  subject_id: number;
  subject_name: string;
  activity_count: number;
  study_sessions: number;
  quiz_sets: number;
  question_count: number;
};

type QuestSummary = {
  id: number | null;
  quest_type: string;
  title: string;
  description: string;
  reward_points: number;
  status: 'pending' | 'completed' | 'failed';
  target_value: number;
  current_value: number;
  mission_count: number;
  progress_percent: number;
  focus_subject_id: number | null;
  focus_subject_name: string | null;
  focus_lesson_title: string | null;
  focus_quiz_title: string | null;
  celebration_message: string;
  cta_path: string;
};

type GoalState = {
  target_value: number;
  current_value: number;
  mission_count: number;
  target_sessions: number;
  target_questions: number;
  target_quiz_sets: number;
  current_activities: number;
  current_sessions: number;
  current_questions: number;
  current_quiz_sets: number;
  progress_percent: number;
  status: 'achieved' | 'not_achieved' | 'not_set';
  achieved: boolean;
};

type PeriodSummary = {
  period_type: 'daily' | 'weekly' | 'monthly';
  period_start: string;
  period_end: string;
  total_activities: number;
  total_sessions: number;
  total_quiz_sets: number;
  total_questions: number;
  subjects: SubjectSummary[];
  goal: GoalState;
  quest: QuestSummary;
};

type GoalSummary = {
  today: PeriodSummary;
  week: PeriodSummary;
  month: PeriodSummary;
};

type PeriodKey = 'today' | 'week' | 'month';

const periodCards: Array<{ key: PeriodKey; label: string; shortLabel: string; apiType: 'daily' | 'weekly' | 'monthly' }> = [
  { key: 'today', label: 'วันนี้', shortLabel: 'วันนี้', apiType: 'daily' },
  { key: 'week', label: 'สัปดาห์นี้', shortLabel: 'สัปดาห์นี้', apiType: 'weekly' },
  { key: 'month', label: 'เดือนนี้', shortLabel: 'เดือนนี้', apiType: 'monthly' },
];

const periodLabelMap: Record<PeriodKey, string> = {
  today: 'วันนี้',
  week: 'สัปดาห์นี้',
  month: 'เดือนนี้',
};

const periodResetMap: Record<PeriodKey, string> = {
  today: 'รีเซ็ตสิ้นวัน',
  week: 'รีเซ็ตสิ้นสัปดาห์',
  month: 'รีเซ็ตสิ้นเดือน',
};

const targetInputFromSummary = (goal: GoalState): string => {
  const sessionTarget = goal.target_sessions > 0 ? goal.target_sessions : goal.target_quiz_sets;
  return sessionTarget > 0 ? String(sessionTarget) : '';
};

const activityCountFromGoal = (goal: GoalState): number =>
  goal.current_activities ?? goal.current_sessions + goal.current_quiz_sets;

const unwrapCollection = (payload: any): any[] => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.data)) return payload.data.data;
  return [];
};

export const GoalsPage = () => {
  const navigate = useNavigate();
  const semesterOptions = useSemesterOptions();
  const [selectedSemesterKey, setSelectedSemesterKey] = useState('all');
  const [subjects, setSubjects] = useState<GoalSubjectOption[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  useDefaultSemesterSelection(semesterOptions, selectedSemesterKey, setSelectedSemesterKey);
  const [summary, setSummary] = useState<GoalSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const [activePeriod, setActivePeriod] = useState<PeriodKey>('month');
  const [targetInputs, setTargetInputs] = useState<Record<PeriodKey, string>>({
    today: '',
    week: '',
    month: '',
  });
  const [savingTarget, setSavingTarget] = useState<PeriodKey | null>(null);
  const previousQuestStatusRef = useRef<string | null>(null);
  const inputRefs = useRef<Record<PeriodKey, HTMLInputElement | null>>({ today: null, week: null, month: null });

  const selectedSemesterOption = useMemo(
    () => semesterOptions.find(option => option.key === selectedSemesterKey) ?? semesterOptions[0],
    [semesterOptions, selectedSemesterKey]
  );
  const selectedSemesterId = selectedSemesterOption?.key !== 'all'
    ? Number(String(selectedSemesterOption?.key ?? '').replace('id:', '')) || undefined
    : undefined;
  const filteredSubjectOptions = useMemo(
    () => filterBySemester(subjects, selectedSemesterKey),
    [subjects, selectedSemesterKey]
  );
  const selectedSubject = useMemo(
    () => subjects.find(subject => String(subject.id) === selectedSubjectId) ?? null,
    [subjects, selectedSubjectId]
  );
  const selectedSubjectLabel = selectedSubject?.name ?? '';

  useEffect(() => {
    const loadSubjects = async () => {
      try {
        const res = await api.get('/subjects');
        const nextSubjects = unwrapCollection(res.data)
          .map((subject: any) => ({
            id: Number(subject?.id),
            name: String(subject?.name ?? '').trim(),
            semester_id: subject?.semester_id ? Number(subject.semester_id) : null,
            semester: subject?.semester ? Number(subject.semester) : null,
            academic_year: subject?.academic_year ? Number(subject.academic_year) : null,
          }))
          .filter((subject: GoalSubjectOption) => Number.isFinite(subject.id) && subject.id > 0 && subject.name !== '');
        setSubjects(nextSubjects);
      } catch {
        setSubjects([]);
      }
    };

    void loadSubjects();
    return subscribeSubjectsUpdated(() => void loadSubjects());
  }, []);

  useEffect(() => {
    const subjectStillAvailable = filteredSubjectOptions.some(subject => String(subject.id) === selectedSubjectId);
    if (!subjectStillAvailable) {
      setSelectedSubjectId(filteredSubjectOptions[0] ? String(filteredSubjectOptions[0].id) : '');
    }
  }, [filteredSubjectOptions, selectedSubjectId]);

  const loadSummary = async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    setError(null);

    try {
      const res = await api.get<GoalSummary>('/goals/summary', {
        params: {
          semester_id: selectedSemesterId,
          subject_id: selectedSubjectId ? Number(selectedSubjectId) : undefined,
        },
      });
      const nextSummary = res.data;
      const nextStatus = nextSummary.today.quest.status;

      if (previousQuestStatusRef.current && previousQuestStatusRef.current !== 'completed' && nextStatus === 'completed') {
        setCelebrating(true);
        window.setTimeout(() => setCelebrating(false), 2600);
      }

      previousQuestStatusRef.current = nextStatus;
      setSummary(nextSummary);
      setTargetInputs({
        today: targetInputFromSummary(nextSummary.today.goal),
        week: targetInputFromSummary(nextSummary.week.goal),
        month: targetInputFromSummary(nextSummary.month.goal),
      });
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'โหลดภารกิจไม่สำเร็จ');
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void loadSummary();

    const intervalId = window.setInterval(() => {
      void loadSummary(true);
    }, 30000);

    const onFocus = () => {
      void loadSummary(true);
    };

    window.addEventListener('focus', onFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
    };
  }, [selectedSemesterKey, selectedSubjectId]);

  const saveTarget = async (periodType: PeriodKey) => {
    const rawValue = targetInputs[periodType]?.trim();
    const targetValue = Number(rawValue);
    if (!rawValue || !Number.isFinite(targetValue) || targetValue <= 0) {
      setError('กรุณาระบุเป้าหมายอย่างน้อย 1 กิจกรรม');
      return;
    }

    try {
      setSavingTarget(periodType);
      setError(null);
      await api.post('/goals/targets', {
        period_type: periodCards.find(card => card.key === periodType)?.apiType ?? 'daily',
        target_sessions: Math.max(1, Math.round(targetValue)),
        semester_id: selectedSemesterId,
        subject_id: selectedSubjectId ? Number(selectedSubjectId) : undefined,
      });
      await loadSummary(true);
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'บันทึกเป้าหมายไม่สำเร็จ');
    } finally {
      setSavingTarget(null);
    }
  };

  const startQuest = () => {
    emitSubjectsUpdated({ revealSchedule: true });
    navigate('/overview');
  };

  const sections = summary
    ? [
        { card: periodCards[0], data: summary.today },
        { card: periodCards[1], data: summary.week },
        { card: periodCards[2], data: summary.month },
      ]
    : [];
  const activeData = summary
    ? activePeriod === 'today'
      ? summary.today
      : activePeriod === 'week'
        ? summary.week
        : summary.month
    : null;
  const activeTargetValue = activeData?.goal.target_value && activeData.goal.target_value > 0
    ? activeData.goal.target_value
    : Number(targetInputs[activePeriod] || 0);
  const activeCurrentValue = activeData ? activityCountFromGoal(activeData.goal) : 0;
  const activeProgressPercent = activeData && activeTargetValue > 0
    ? Math.min(100, Math.round((activeCurrentValue / activeTargetValue) * 100))
    : 0;
  const activeSubjects = activeData?.subjects ?? [];

  return (
    <div className="relative mx-auto max-w-5xl pb-10 text-[color:var(--text)]">
      {celebrating ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 overflow-hidden">
          <div className="mx-auto flex max-w-4xl justify-center gap-3 py-4">
            {Array.from({ length: 18 }).map((_, index) => (
              <span
                key={index}
                className="h-3 w-3 animate-bounce rounded-full"
                style={{
                  backgroundColor: ['#14b8a6', '#3b82f6', '#8b5cf6', '#d946ef'][index % 4],
                  animationDelay: `${index * 70}ms`,
                }}
              />
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-5">
        <section className="mx-auto max-w-5xl rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-[var(--shadow-soft)]">
          <div className="mb-4">
            <h1 className="text-base font-bold text-[color:var(--text)]">เป้าหมายการเรียนตามช่วงเวลา</h1>

          </div>

          <div className="mb-4 grid w-full max-w-[520px] gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-[color:var(--text)]">ภาคเรียน</span>
              <select
                value={selectedSemesterKey}
                onChange={event => setSelectedSemesterKey(event.target.value)}
                className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] px-4 py-2.5 text-sm font-semibold text-[color:var(--text)] outline-none transition focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:rgba(var(--accent-rgb),0.18)]"
              >
                {semesterOptions.map(option => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-[color:var(--text)]">วิชา</span>
              <select
                value={selectedSubjectId}
                onChange={event => setSelectedSubjectId(event.target.value)}
                className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] px-4 py-2.5 text-sm font-semibold text-[color:var(--text)] outline-none transition focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:rgba(var(--accent-rgb),0.18)]"
              >
                {filteredSubjectOptions.map(subject => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
                {filteredSubjectOptions.length === 0 ? (
                  <option value="" disabled>ยังไม่มีวิชาในภาคเรียนนี้</option>
                ) : null}
              </select>
            </label>
          </div>

          {summary ? (
            <div className="grid gap-3 md:grid-cols-3">
              {sections.map(({ card, data }) => {
                const currentValue = activityCountFromGoal(data.goal);
                const targetValue = data.goal.target_value > 0
                  ? data.goal.target_value
                  : Number(targetInputs[card.key] || 0);
                const hasTarget = targetValue > 0;
                const isCompleted = data.quest.status === 'completed' || (hasTarget && currentValue >= targetValue);

                return (
                  <button
                    key={card.key}
                    type="button"
                    onClick={() => setActivePeriod(card.key)}
                    className={`min-h-[92px] rounded-xl border p-4 text-left transition ${
                      activePeriod === card.key
                        ? 'border-[color:var(--accent)] bg-[color:rgba(var(--accent-rgb),0.08)] shadow-[0_0_0_1px_rgba(var(--accent-rgb),0.12)]'
                        : 'border-[color:var(--border)] bg-[color:var(--surface-2)] hover:border-[color:rgba(var(--accent-rgb),0.36)]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-bold text-[color:var(--text)]">{card.label}</p>
                      <span className={`inline-flex items-center gap-1 text-[11px] font-bold ${isCompleted ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {isCompleted ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />}
                        {isCompleted ? 'บรรลุเป้าหมาย' : 'ไม่บรรลุเป้าหมาย'}
                      </span>
                    </div>
                    <p className="mt-4 text-xs text-[color:var(--muted)]">
                      ทำกิจกรรมแล้ว {currentValue} รายการ
                    </p>
                    <p className="mt-1 text-xs text-[color:var(--muted)] opacity-80">{periodResetMap[card.key]}</p>
                  </button>
                );
              })}
            </div>
          ) : null}
        </section>

        {loading ? <p className="mx-auto max-w-5xl text-sm text-muted">กำลังโหลดภารกิจ...</p> : null}
        {error ? <p className="mx-auto max-w-5xl rounded-2xl border border-rose-500/20 bg-rose-500/8 px-4 py-3 text-sm text-rose-500">{error}</p> : null}

        {summary ? (
          <>
            <section className="mx-auto max-w-5xl rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-[var(--shadow-soft)]">
              <div className="grid gap-4 lg:grid-cols-[1fr_1.9fr] lg:items-center">
                <div>
                  <h2 className="text-base font-bold text-[color:var(--text)]">กำหนดจำนวนกิจกรรมการเรียนที่ต้องการทำ</h2>
                  <p className="mt-2 text-xs leading-5 text-[color:var(--muted)]">
                    1 กิจกรรม หมายถึง บันทึกการเรียน สรุปเอกสาร สรุปเสียง หรือส่งแบบทดสอบสำเร็จ 1 ครั้ง
                    โดยกำหนดเป้าหมายแยกได้เป็นวันนี้ สัปดาห์นี้ และเดือนนี้
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {sections.map(({ card }) => (
                    <div key={card.key} className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="text-xs font-bold text-[color:var(--accent-ink)]">{card.shortLabel}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          step={1}
                          inputMode="numeric"
                          value={targetInputs[card.key]}
                          onChange={event => setTargetInputs(prev => ({ ...prev, [card.key]: event.target.value }))}
                          ref={el => (inputRefs.current[card.key] = el)}
                          className="min-w-0 flex-1 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-1.5 text-sm font-semibold text-[color:var(--text)] outline-none transition focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:rgba(var(--accent-rgb),0.18)]"
                        />
                        <span className="shrink-0 text-xs text-[color:var(--muted)]">กิจกรรม</span>
                        <button
                          type="button"
                          onClick={() => void saveTarget(card.key)}
                          disabled={savingTarget === card.key}
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--accent)] text-[color:var(--on-accent)] transition hover:opacity-90 disabled:opacity-60"
                          title="บันทึกเป้าหมาย"
                          aria-label={`บันทึกเป้าหมาย${card.label}`}
                        >
                          {savingTarget === card.key ? (
                            <RotateCcw className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Save className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {activeData ? (
              <section className="mx-auto max-w-5xl rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-[var(--shadow-soft)]">
                <div className="mb-4 flex flex-wrap gap-2">
                  {periodCards.map(card => (
                    <button
                      key={card.key}
                      type="button"
                      onClick={() => setActivePeriod(card.key)}
                      className={`rounded-full border px-4 py-2 text-xs font-bold transition ${
                        activePeriod === card.key
                          ? 'border-[color:var(--accent)] bg-[color:var(--accent)] text-[color:var(--on-accent)]'
                          : 'border-[color:rgba(var(--accent-rgb),0.3)] bg-[color:var(--surface-2)] text-[color:var(--accent-ink)] hover:border-[color:var(--accent)]'
                      }`}
                    >
                      {card.label}
                    </button>
                  ))}
                </div>

                <div className="grid gap-5 lg:grid-cols-[1fr_0.85fr]">
                  <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] p-4">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <h2 className="flex items-center gap-2 text-base font-bold text-[color:var(--text)]">
                          <ClipboardList className="h-4 w-4 text-[color:var(--accent-ink)]" />
                          สรุปกิจกรรมการเรียน
                        </h2>
                        <p className="mt-1 text-xs text-[color:var(--muted)]">
                          {selectedSubjectLabel
                            ? `${selectedSubjectLabel} - ${periodLabelMap[activePeriod]}`
                            : periodLabelMap[activePeriod]}
                        </p>
                      </div>
                      <span className={`inline-flex items-center gap-1 text-xs font-bold ${activeProgressPercent >= 100 ? 'text-emerald-400' : 'text-[color:var(--accent-ink)]'}`}>
                        {activeProgressPercent >= 100 ? <Trophy className="h-3.5 w-3.5" /> : <Target className="h-3.5 w-3.5" />}
                        {activeProgressPercent >= 100 ? 'บรรลุเป้าหมาย' : 'กำลังทำเป้าหมาย'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-3">
                        <p className="text-[11px] text-[color:var(--muted)]">กิจกรรมที่ทำแล้ว</p>
                        <p className="mt-1 break-words text-lg font-bold text-[color:var(--text)]">{activeCurrentValue}</p>
                      </div>
                      <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-3">
                        <p className="text-[11px] text-[color:var(--muted)]">วิชาที่มีกิจกรรม</p>
                        <p className="mt-1 break-words text-lg font-bold text-[color:var(--text)]">{activeSubjects.length}</p>
                      </div>
                    </div>

                    <div className="mt-4">
                      <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                        <span className="text-[color:var(--muted)]">
                          {`ทำแล้ว ${activeCurrentValue} รายการ - เป้าหมาย ${activeTargetValue} กิจกรรม`}
                        </span>
                        <span className="font-bold text-emerald-400">{activeProgressPercent}%</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-[color:var(--surface)] ring-1 ring-[color:var(--border)]">
                        <div
                          className="h-full rounded-full bg-[color:var(--accent)]"
                          style={{ width: `${activeProgressPercent}%` }}
                        />
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={startQuest}
                        className="rounded-full bg-[color:var(--accent)] px-4 py-2 text-xs font-bold text-[color:var(--on-accent)] transition hover:opacity-90"
                      >
                        เริ่มทำกิจกรรม
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          inputRefs.current[activePeriod]?.focus();
                        }}
                        className="rounded-full border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-2 text-xs font-bold text-[color:var(--text)] transition hover:border-[color:rgba(var(--accent-rgb),0.36)]"
                      >
                        แก้เป้าหมาย
                      </button>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] p-4">
                    <h2 className="text-base font-bold text-[color:var(--text)]">กิจกรรมแยกตามรายวิชา</h2>
                    <p className="mt-1 text-xs text-[color:var(--muted)]">
                      {selectedSubject ? `ดูจำนวนกิจกรรมการเรียนของวิชา ${selectedSubject.name}` : 'ดูจำนวนกิจกรรมการเรียนของแต่ละวิชา'}
                    </p>
                    <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
                      {activeSubjects.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-[color:var(--border)] p-4 text-center text-xs text-[color:var(--muted)]">
                          ยังไม่มีข้อมูลรายวิชาในช่วงเวลานี้
                        </p>
                      ) : (
                        activeSubjects.map(subject => (
                          <div key={subject.subject_id} className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2">
                            <div className="flex items-center justify-between gap-3">
                              <p className="min-w-0 truncate text-sm font-bold text-[color:var(--text)]">{subject.subject_name}</p>
                            </div>
                            <p className="mt-1 text-xs text-[color:var(--muted)]">
                              รวม {subject.activity_count} กิจกรรม — บันทึก/สรุป {subject.study_sessions} รายการ • แบบทดสอบ {subject.quiz_sets} ชุด
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
};
