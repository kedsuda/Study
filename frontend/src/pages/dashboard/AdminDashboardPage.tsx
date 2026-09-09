import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { BookOpen, CalendarBlank, ChartBar, FileText, Gear, MagnifyingGlass, Target, UserCircle, Users } from 'phosphor-react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

type AdminCounts = {
  users: number;
  subjects: number;
  schedules: number;
  study_logs: number;
  summaries: number;
  quizzes: number;
  quiz_attempts: number;
  goals: number;
  files: number;
};

type AdminOverview = {
  counts: AdminCounts;
  recent_activity: Record<string, number>;
  latest_users: Array<{ id: number; name: string; email: string; role?: string | null; created_at?: string | null }>;
};

type AdminUser = {
  id: number;
  name: string;
  email: string;
  role?: string | null;
  provider?: string | null;
  education_level?: string | null;
  created_at?: string | null;
  subjects_count: number;
  study_logs_count: number;
  quiz_attempts_count: number;
  goals_count: number;
};

type AdminUserDetail = {
  user: AdminUser;
  subjects: any[];
  schedules: any[];
  calendar_events: any[];
  study_logs: any[];
  summaries: any[];
  quizzes: any[];
  goals: any[];
  profile?: any | null;
};

type AdminSettings = {
  app_display_name: string;
  maintenance_notice: string;
  default_timezone: string;
  notifications_enabled: string;
};

const numberFormat = new Intl.NumberFormat('th-TH');

const formatDate = (value?: string | null) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
};

const StatCard = ({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: number;
  icon: JSX.Element;
  accent: string;
}) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <p className="mt-2 text-3xl font-bold text-slate-950">{numberFormat.format(value)}</p>
      </div>
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl text-white" style={{ backgroundColor: accent }}>
        {icon}
      </span>
    </div>
  </div>
);

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <h2 className="text-lg font-bold text-slate-950">{title}</h2>
    <div className="mt-4">{children}</div>
  </section>
);

export const AdminDashboardPage = () => {
  const { user } = useAuth();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [usersPage, setUsersPage] = useState<{ data: AdminUser[]; total: number } | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [settings, setSettings] = useState<AdminSettings>({
    app_display_name: '',
    maintenance_notice: '',
    default_timezone: 'Asia/Bangkok',
    notifications_enabled: '1',
  });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    if (!isAdmin) return;
    const load = async () => {
      setLoading(true);
      try {
        const [overviewRes, usersRes, settingsRes] = await Promise.all([
          api.get<AdminOverview>('/admin/overview'),
          api.get('/admin/users', { params: { per_page: 15 } }),
          api.get<{ settings: AdminSettings }>('/admin/settings'),
        ]);
        setOverview(overviewRes.data);
        setUsersPage({ data: usersRes.data.data ?? [], total: usersRes.data.total ?? 0 });
        setSettings(settingsRes.data.settings);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [isAdmin]);

  const searchUsers = async () => {
    const res = await api.get('/admin/users', { params: { search, per_page: 15 } });
    setUsersPage({ data: res.data.data ?? [], total: res.data.total ?? 0 });
  };

  const loadUserDetail = async (id: number) => {
    setSelectedUserId(id);
    setDetail(null);
    const res = await api.get<AdminUserDetail>(`/admin/users/${id}`);
    setDetail(res.data);
  };

  const saveSettings = async () => {
    const res = await api.put<{ message: string; settings: AdminSettings }>('/admin/settings', settings);
    setSettings(res.data.settings);
    setMessage(res.data.message);
    window.setTimeout(() => setMessage(null), 2600);
  };

  const statCards = useMemo(() => {
    const counts = overview?.counts;
    if (!counts) return [];
    return [
      ['ผู้ใช้งาน', counts.users, <Users size={24} weight="duotone" />, '#2563eb'],
      ['ตารางเรียน', counts.schedules, <CalendarBlank size={24} weight="duotone" />, '#0891b2'],
      ['สรุปและบันทึก', counts.summaries + counts.study_logs, <FileText size={24} weight="duotone" />, '#7c3aed'],
      ['แบบฝึกหัด', counts.quizzes + counts.quiz_attempts, <BookOpen size={24} weight="duotone" />, '#16a34a'],
      ['เป้าหมาย', counts.goals, <Target size={24} weight="duotone" />, '#ea580c'],
    ] as const;
  }, [overview]);

  const overviewChartData = useMemo(
    () => statCards.map(([label, value, , accent]) => ({ label, value, accent })),
    [statCards],
  );

  if (!isAdmin) {
    return <Navigate to="/ai-assistant" replace />;
  }

  return (
    <div className="mx-auto max-w-7xl pb-4 text-slate-900" style={{ fontFamily: "'Kanit', var(--font-body)" }}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-950">ขอบเขตผู้ดูแล</h1>
          <p className="mt-2 text-sm text-slate-500">ดูข้อมูลผู้ใช้งาน ตารางเรียน ตารางสอบ สรุป แบบฝึกหัด เป้าหมาย โปรไฟล์ และตั้งค่าระบบ โดยไม่แก้ไขข้อมูลผู้ใช้หรือดูข้อมูลแจ้งเตือนผู้ใช้</p>
        </div>
        {loading ? <span className="text-sm text-slate-500">กำลังโหลด...</span> : null}
      </div>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-slate-950">
              <ChartBar size={21} weight="duotone" className="text-blue-600" />
              ภาพรวมข้อมูลในระบบ
            </h2>
            <p className="mt-1 text-sm text-slate-500">เปรียบเทียบจำนวนข้อมูลแต่ละประเภท</p>
          </div>
          <span className="text-xs font-medium text-slate-400">หน่วย: รายการ</span>
        </div>

        <div className="mt-5 h-72" aria-label="กราฟแท่งภาพรวมข้อมูลในระบบ">
          {overviewChartData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={overviewChartData} margin={{ top: 8, right: 12, left: -18, bottom: 8 }}>
                <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                <Tooltip
                  cursor={{ fill: '#f8fafc' }}
                  formatter={(value: number) => [numberFormat.format(value), 'จำนวน']}
                  contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', fontFamily: "Kanit, sans-serif" }}
                />
                <Bar dataKey="value" radius={[8, 8, 0, 0]} maxBarSize={64}>
                  {overviewChartData.map(item => <Cell key={item.label} fill={item.accent} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">กำลังโหลดข้อมูลกราฟ...</div>
          )}
        </div>
      </section>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <Section title="ข้อมูลผู้ใช้งานทั้งหมด">
          <div className="mb-4 flex gap-2">
            <div className="relative flex-1">
              <MagnifyingGlass className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-400 focus:bg-white"
                placeholder="ค้นหาชื่อหรืออีเมล"
              />
            </div>
            <button type="button" onClick={searchUsers} className="rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white">
              ค้นหา
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-400">
                <tr>
                  <th className="py-2 pr-3">ผู้ใช้</th>
                  <th className="py-2 pr-3">Role</th>
                  <th className="py-2 pr-3">รายวิชา</th>
                  <th className="py-2 pr-3">บันทึก</th>
                  <th className="py-2 pr-3">แบบฝึกหัด</th>
                  <th className="py-2 pr-3">เป้าหมาย</th>
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(usersPage?.data ?? []).map(item => (
                  <tr key={item.id} className={selectedUserId === item.id ? 'bg-blue-50/60' : undefined}>
                    <td className="py-3 pr-3">
                      <p className="font-semibold text-slate-950">{item.name}</p>
                      <p className="text-xs text-slate-500">{item.email}</p>
                    </td>
                    <td className="py-3 pr-3">{item.role ?? 'user'}</td>
                    <td className="py-3 pr-3">{numberFormat.format(item.subjects_count)}</td>
                    <td className="py-3 pr-3">{numberFormat.format(item.study_logs_count)}</td>
                    <td className="py-3 pr-3">{numberFormat.format(item.quiz_attempts_count)}</td>
                    <td className="py-3 pr-3">{numberFormat.format(item.goals_count)}</td>
                    <td className="py-3 pr-3">
                      <button type="button" onClick={() => void loadUserDetail(item.id)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                        ดูข้อมูล
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-500">ทั้งหมด {numberFormat.format(usersPage?.total ?? 0)} ผู้ใช้</p>
        </Section>

        <Section title="ตั้งค่าระบบ">
          <div className="space-y-3">
            <label className="block text-sm font-semibold text-slate-700">
              ชื่อระบบ
              <input value={settings.app_display_name} onChange={event => setSettings(prev => ({ ...prev, app_display_name: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400" />
            </label>
            <label className="block text-sm font-semibold text-slate-700">
              Timezone
              <input value={settings.default_timezone} onChange={event => setSettings(prev => ({ ...prev, default_timezone: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400" />
            </label>
            <label className="block text-sm font-semibold text-slate-700">
              ประกาศระบบ
              <textarea value={settings.maintenance_notice} onChange={event => setSettings(prev => ({ ...prev, maintenance_notice: event.target.value }))} rows={3} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400" />
            </label>
            <label className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">
              เปิดระบบแจ้งเตือน
              <input type="checkbox" checked={settings.notifications_enabled === '1'} onChange={event => setSettings(prev => ({ ...prev, notifications_enabled: event.target.checked ? '1' : '0' }))} className="h-4 w-4" />
            </label>
            <button type="button" onClick={() => void saveSettings()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-700">
              <Gear size={17} />
              บันทึกการตั้งค่า
            </button>
            {message ? <p className="text-sm font-semibold text-emerald-600">{message}</p> : null}
          </div>
        </Section>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-2">
        <Section title="รายละเอียดผู้ใช้">
          {detail ? (
            <div className="space-y-5 text-sm">
              <div className="flex items-start gap-3 rounded-xl bg-slate-50 p-4">
                <UserCircle size={34} className="text-slate-500" />
                <div>
                  <p className="font-bold text-slate-950">{detail.user.name}</p>
                  <p className="text-slate-500">{detail.user.email}</p>
                  <p className="mt-1 text-xs text-slate-400">สมัครเมื่อ {formatDate(detail.user.created_at)}</p>
                </div>
              </div>
              {[
                ['ตารางเรียน', detail.schedules, 'day_of_week', 'start_time'],
                ['ตารางเรียนและตารางสอบ', detail.calendar_events, 'title', 'start_time'],
                ['สรุปการเรียนและแบบบันทึก', [...detail.study_logs, ...detail.summaries], 'title', 'created_at'],
                ['แบบฝึกหัด', detail.quizzes, 'title', 'subject_name'],
                ['เป้าหมายและความคืบหน้า', detail.goals, 'title', 'status'],
              ].map(([title, rows, primary, secondary]) => (
                <div key={String(title)}>
                  <p className="mb-2 font-bold text-slate-800">{String(title)}</p>
                  <div className="space-y-2">
                    {(rows as any[]).slice(0, 5).map((row, index) => (
                      <div key={`${String(title)}-${row.id ?? index}`} className="rounded-xl border border-slate-100 px-3 py-2">
                        <p className="font-semibold text-slate-800">{row[primary as string] ?? '-'}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{row[secondary as string] ?? ''}</p>
                      </div>
                    ))}
                    {(rows as any[]).length === 0 ? <p className="text-xs text-slate-400">ไม่มีข้อมูล</p> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">เลือกผู้ใช้จากตารางเพื่อดูข้อมูลในระบบแบบอ่านอย่างเดียว</p>
          )}
        </Section>

        <Section title="กิจกรรมล่าสุด">
          <div className="grid gap-4">
            <div>
              <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800">
                <ChartBar size={18} />
                ผู้ใช้ล่าสุด
              </div>
              <div className="space-y-2">
                {(overview?.latest_users ?? []).map(item => (
                  <div key={item.id} className="rounded-xl border border-slate-100 px-3 py-2 text-sm">
                    <p className="font-semibold text-slate-900">{item.name}</p>
                    <p className="text-xs text-slate-500">{item.email} - {formatDate(item.created_at)}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
};
