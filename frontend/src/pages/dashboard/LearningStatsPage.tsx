import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  BookOpen,
  ChartLineUp,
  Trophy,
} from 'phosphor-react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../../services/api';
import { useAcademicSearchParams } from '../../hooks/useAcademicSelection';

type Totals = {
  study_sessions: number;
  study_minutes: number;
  study_hours: number;
  quiz_sets: number;
  quiz_questions: number;
  quiz_passed: number;
  quiz_pass_rate: number;
};

type DailyActivity = {
  date: string;
  label: string;
  study_minutes: number;
  study_sessions: number;
  quiz_sets: number;
};

type SubjectBreakdown = {
  subject_id: number;
  subject_name: string;
  study_minutes: number;
  study_sessions: number;
  quiz_sets: number;
  average_score: number;
};

type LearningStats = {
  range: { days: number; start: string; end: string };
  totals: Totals;
  today: Totals;
  week: Totals;
  month: Totals;
  streaks: { current: number; longest: number };
  daily_activity: DailyActivity[];
  subject_breakdown: SubjectBreakdown[];
  quiz_performance: {
    average_score: number;
    best_score: number;
    latest_score: number;
  };
};

const numberFormat = new Intl.NumberFormat('th-TH');

const clampPercent = (value: number) => Math.max(0, Math.min(100, value));

const chartColors = {
  study: '#6366f1',
  studyFill: '#a5b4fc',
  quiz: '#f97316',
  quizFill: '#fdba74',
  grid: '#dbeafe',
  axis: '#64748b',
};

const buildAxisTicks = (maxValue: number) =>
  Array.from({ length: Math.max(1, Math.floor(maxValue)) + 1 }, (_, index) => index);

type ChartPoint = DailyActivity & {
  study_hours: number;
};

const ChartTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ color?: string; name?: string; value?: number | string; dataKey?: string }>;
  label?: string;
}) => {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-2xl border border-white/80 bg-white/90 px-4 py-3 text-sm text-slate-700 shadow-[0_18px_40px_rgba(15,23,42,0.14)] backdrop-blur-xl">
      <p className="mb-2 font-bold text-slate-900">วันที่ {label}</p>
      <div className="space-y-1.5">
        {payload.map(item => {
          const suffix = item.dataKey === 'study_hours' ? ' ชม.' : item.dataKey === 'quiz_sets' ? ' ชุด' : '';
          return (
            <div key={String(item.dataKey)} className="flex min-w-40 items-center justify-between gap-6">
              <span className="flex items-center gap-2 text-slate-500">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                {item.name}
              </span>
              <span className="font-semibold text-slate-900">
                {numberFormat.format(Number(item.value ?? 0))}
                {suffix}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const StatTile = ({
  label,
  value,
  hint,
  icon,
  iconClass,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  icon: ReactNode;
  iconClass: string;
  tone: string;
}) => (
  <div className={`group relative overflow-hidden rounded-2xl border border-slate-100 bg-white p-6 shadow-sm transition duration-300 hover:-translate-y-0.5 hover:shadow-md ${tone}`}>
    <div className="relative flex items-start justify-between gap-3">
      <div>
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <p className="mt-7 text-3xl font-bold tracking-tight text-slate-800">{value}</p>
      </div>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${iconClass}`}>
        {icon}
      </span>
    </div>
    <div className="relative mt-4 flex items-center gap-2">
      <span className="h-1.5 w-12 rounded-full bg-current" />
      <p className="text-xs font-medium text-slate-400">{hint}</p>
    </div>
  </div>
);

const ProgressBar = ({ value, tone = 'bg-gradient-to-r from-indigo-500 to-violet-500' }: { value: number; tone?: string }) => (
  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200/80">
    <div className={`h-full rounded-full transition-[width] duration-700 ease-out ${tone}`} style={{ width: `${clampPercent(value)}%` }} />
  </div>
);

export const LearningStatsPage = () => {
  const [academicParams] = useAcademicSearchParams();
  const academicYear = academicParams.get('academic_year') ?? '';
  const semester = academicParams.get('semester') ?? '';
  const subjectId = academicParams.get('subject') ?? '';
  const [stats, setStats] = useState<LearningStats | null>(null);
  const [days, setDays] = useState(14);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestRequestRef = useRef(0);

  const loadStats = async (requestedDays: number) => {
    const requestId = ++latestRequestRef.current;

    try {
      setLoading(true);
      setError(null);
      setStats(null);
      const res = await api.get<LearningStats>('/learning-stats/summary', {
        params: { days: requestedDays, academic_year: academicYear || undefined, semester: semester || undefined, subject_id: subjectId || undefined },
      });

      if (requestId !== latestRequestRef.current) return;
      setStats(res.data);
    } catch (err: any) {
      if (requestId !== latestRequestRef.current) return;
      setError(err.response?.data?.message ?? 'โหลดสถิติการเรียนไม่สำเร็จ');
    } finally {
      if (requestId === latestRequestRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void loadStats(days);
    return () => { latestRequestRef.current += 1; };
  }, [days, academicYear, semester, subjectId]);

  const chartData = useMemo<ChartPoint[]>(
    () =>
      (stats?.daily_activity ?? []).map(item => ({
        ...item,
        study_hours: Math.round((item.study_minutes / 60) * 10) / 10,
      })),
    [stats]
  );

  const hasStudyActivity = chartData.some(item => item.study_hours > 0);
  const hasQuizActivity = chartData.some(item => item.quiz_sets > 0);
  const hasChartActivity = hasStudyActivity || hasQuizActivity;
  const chartMax = Math.max(4, Math.ceil(Math.max(...chartData.map(item => item.study_hours), 0)));
  const quizChartMax = Math.max(4, Math.ceil(Math.max(...chartData.map(item => item.quiz_sets), 0)));
  const chartTickInterval = Math.max(0, Math.ceil(chartData.length / 8) - 1);

  return (
  <div className="relative w-full pb-8 text-slate-800">
      <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white px-5 py-7 text-slate-900 shadow-sm sm:px-8 sm:py-8">
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
          
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">สถิติการทำข้อสอบ</h1>
       
          </div>
        </div>
        <div className="relative mt-7 inline-flex rounded-xl bg-slate-100 p-1">
          {[14].map(option => (
            <button
              key={option}
              type="button"
              onClick={() => setDays(option)}
              aria-pressed={days === option}
              className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-all duration-200 ${
                days === option
                  ? 'border-slate-200 bg-white text-slate-900 shadow-sm'
                  : 'border-transparent text-slate-700 hover:bg-white'
              }`}
            >
              {option} วัน
            </button>
          ))}
        </div>
      </section>

      {loading ? <p className="mt-6 text-sm text-slate-500">กำลังโหลดสถิติ...</p> : null}
      {error ? <p className="mt-6 rounded-xl border border-slate-300 bg-white/80 px-4 py-3 text-sm text-slate-600 shadow-sm backdrop-blur">{error}</p> : null}

      {stats ? (
        <div className="mt-7 space-y-6">
          <section className="grid gap-4 sm:grid-cols-2">
            <StatTile
              label="แบบทดสอบ"
              value={`${numberFormat.format(stats.totals.quiz_sets)} ชุด`}
              hint={`${numberFormat.format(stats.totals.quiz_questions)} ข้อทั้งหมด`}
              icon={<BookOpen size={23} weight="duotone" />}
              iconClass="bg-white text-indigo-600"
              tone="text-indigo-500"
            />
            <StatTile
              label="ผ่านแบบทดสอบ"
              value={`${numberFormat.format(stats.totals.quiz_pass_rate)}%`}
              hint={`${numberFormat.format(stats.totals.quiz_passed)} ชุดที่ผ่านเกณฑ์`}
              icon={<Trophy size={23} weight="duotone" />}
              iconClass="bg-white text-emerald-600"
              tone="text-emerald-500"
            />
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-500"><ChartLineUp size={18} weight="bold" /></span>
                    <h2 className="text-lg font-bold tracking-normal text-slate-800">กิจกรรมรายวัน</h2>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">เวลาเรียนและจำนวนชุดแบบทดสอบตามวันที่</p>
                </div>
              </div>
              <div className="relative h-[290px] w-full overflow-hidden px-3 pb-2 pt-4">
                {hasChartActivity ? (
                  <div className="absolute right-5 top-3 z-10 flex flex-wrap justify-end gap-3 text-xs font-semibold text-slate-500">
                    {hasStudyActivity ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: chartColors.study }} />
                        ชั่วโมงเรียน
                      </span>
                    ) : null}
                    {hasQuizActivity ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: chartColors.quiz }} />
                        แบบทดสอบ
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 16, right: 10, bottom: 6, left: -6 }}>
                    <defs>
                      <linearGradient id="studyActivityFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={chartColors.studyFill} stopOpacity={0.78} />
                        <stop offset="56%" stopColor={chartColors.studyFill} stopOpacity={0.28} />
                        <stop offset="100%" stopColor={chartColors.studyFill} stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="quizActivityFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={chartColors.quizFill} stopOpacity={0.55} />
                        <stop offset="65%" stopColor={chartColors.quizFill} stopOpacity={0.16} />
                        <stop offset="100%" stopColor={chartColors.quizFill} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke={chartColors.grid} strokeDasharray="4 4" />
                    <XAxis
                      dataKey="label"
                      axisLine={{ stroke: '#d5dde7' }}
                      tickLine={false}
                      interval={chartTickInterval}
                      minTickGap={12}
                      tick={{ fontSize: 12, fill: chartColors.axis, fontWeight: 500 }}
                      tickMargin={8}
                    />
                    <YAxis
                      yAxisId="left"
                      axisLine={false}
                      tickLine={false}
                      width={44}
                      domain={[0, chartMax]}
                      ticks={buildAxisTicks(chartMax)}
                      tick={{ fontSize: 12, fill: chartColors.axis, fontWeight: 500 }}
                      tickFormatter={value => `${value}`}
                    />
                    {hasQuizActivity ? (
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        axisLine={false}
                        tickLine={false}
                        width={34}
                        domain={[0, quizChartMax]}
                        ticks={buildAxisTicks(quizChartMax)}
                        tick={{ fontSize: 12, fill: chartColors.axis, fontWeight: 500 }}
                        tickFormatter={value => `${value}`}
                      />
                    ) : null}
                    <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#94a3b8', strokeDasharray: '4 4' }} />
                    {hasStudyActivity ? (
                      <Area
                        yAxisId="left"
                        type="monotoneX"
                        dataKey="study_hours"
                        name="ชั่วโมงเรียน"
                        stroke={chartColors.study}
                        strokeWidth={3}
                        fill="url(#studyActivityFill)"
                        fillOpacity={1}
                        dot={{ r: 3.25, strokeWidth: 2, stroke: '#ffffff', fill: chartColors.study }}
                        activeDot={{ r: 6, strokeWidth: 2.5, stroke: '#ffffff', fill: chartColors.study }}
                      />
                    ) : null}
                    {hasQuizActivity ? (
                      <Line
                        yAxisId="right"
                        type="monotoneX"
                        dataKey="quiz_sets"
                        name="แบบทดสอบ"
                        stroke={chartColors.quiz}
                        strokeWidth={2.4}
                        dot={{ r: 3, strokeWidth: 2, stroke: '#ffffff', fill: chartColors.quiz }}
                        activeDot={{ r: 6, strokeWidth: 2.5, stroke: '#ffffff', fill: chartColors.quiz }}
                      />
                    ) : null}
                  </ComposedChart>
                </ResponsiveContainer>
                {!hasChartActivity ? (
                  <div className="pointer-events-none absolute inset-x-6 top-1/2 -translate-y-1/2 text-center text-sm font-medium text-slate-400">
                    ยังไม่มีข้อมูลเวลาเรียนหรือแบบทดสอบในช่วงวันที่เลือก
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex overflow-hidden rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="flex w-full flex-col">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-amber-500"><Trophy size={20} weight="duotone" /></span>
                <div>
                  <h2 className="text-lg font-bold tracking-normal text-slate-800">คะแนนแบบทดสอบ</h2>
                  <p className="text-xs text-slate-500">วัดผลความเข้าใจของคุณ</p>
                </div>
              </div>
              <div className="mt-6 space-y-7">
                {[
                  ['คะแนนเฉลี่ย', stats.quiz_performance.average_score],
                  ['คะแนนล่าสุด', stats.quiz_performance.latest_score],
                  ['คะแนนดีที่สุด', stats.quiz_performance.best_score],
                ].map(([label, value]) => (
                  <div key={label}>
                    <div className="mb-2 flex items-center justify-between text-sm">
                      <span className="font-medium text-slate-700">{label}</span>
                      <span className="font-bold text-slate-950">{numberFormat.format(Number(value))}%</span>
                    </div>
                    <ProgressBar value={Number(value)} />
                  </div>
                ))}
              </div>
              <div className="mt-auto h-1.5 rounded-full bg-gradient-to-r from-amber-400 via-orange-500 to-rose-500" />
              </div>
            </div>
          </section>

        </div>
      ) : null}
    </div>
  );
};
