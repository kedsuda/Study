import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, ClipboardList, Pencil, Plus, Target, Trash2, X } from 'lucide-react';
import { api } from '../../services/api';
import { DateInput } from '../../components/DateInput';
import { dateKey, taskBounds, taskProgress, tasksInPeriod, type GoalTask, type TaskPeriod } from '../../utils/goalTasks';

const panel = 'rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)]';
const field = 'w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] px-3 py-2.5 text-sm text-[color:var(--text)] outline-none focus:ring-2 focus:ring-[color:var(--accent)]';
const primary = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[color:var(--accent)] px-4 py-2.5 text-sm font-semibold text-[color:var(--on-accent)] hover:opacity-90 disabled:opacity-50';
const secondary = 'inline-flex items-center justify-center gap-2 rounded-xl border border-[color:var(--border)] px-3 py-2 text-sm hover:bg-[color:var(--surface-2)] disabled:opacity-50';
const periods: { key: TaskPeriod; label: string }[] = [{ key: 'day', label: 'รายวัน' }, { key: 'week', label: 'รายสัปดาห์ (จันทร์–อาทิตย์)' }, { key: 'month', label: 'รายเดือน' }];
const formatDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
const errorMessage = (error: any, fallback = 'บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง') => {
  const message = Object.values(error?.response?.data?.errors ?? {}).flat().join(' ') || error?.response?.data?.message;
  if (typeof message !== 'string' || !message.trim() || /SQLSTATE\[|\bSQL:\s/i.test(message)) return fallback;
  return message;
};

function TaskEditor({ task, date, onClose, onSaved }: {
  task: GoalTask | null; date: string; onClose: () => void; onSaved: (task: GoalTask) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [taskDate, setTaskDate] = useState(task?.task_date ?? date);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (!title.trim()) { setError('กรุณาระบุสิ่งที่ต้องการทำ'); return; }
    setSaving(true); setError('');
    try {
      const response = await api.post<GoalTask>(task ? `/goals/tasks/${task.id}` : '/goals/tasks', {
        title: title.trim(), description: description.trim() || null, task_date: taskDate,
        start_time: null, end_time: null,
      });
      onSaved(response.data);
    } catch (err) { setError(errorMessage(err)); }
    finally { setSaving(false); }
  };

  return <dialog ref={dialog} aria-labelledby="task-editor-title" onCancel={event => { event.preventDefault(); if (!saving) onClose(); }} className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-0 text-[color:var(--text)] shadow-2xl backdrop:bg-black/40">
    <form onSubmit={save} className="space-y-5 p-5 sm:p-6">
      <div className="flex items-center justify-between"><h2 id="task-editor-title" className="text-lg font-bold">{task ? 'แก้ไขกิจกรรม' : 'เพิ่มกิจกรรม'}</h2><button type="button" className={secondary} aria-label="ปิด" disabled={saving} onClick={onClose}><X size={18} /></button></div>
      <fieldset disabled={saving} className="space-y-4">
        <label className="block space-y-2 text-sm"><span>สิ่งที่ต้องการทำ</span><input autoFocus required maxLength={255} className={field} placeholder="เช่น อ่านบทที่ 3 หรือเตรียมตัวสอบ" value={title} onChange={event => setTitle(event.target.value)} /></label>
        <div className="space-y-2 text-sm"><span>วันที่</span><DateInput required className={field} value={taskDate} onChange={setTaskDate} /></div>
        <label className="block space-y-2 text-sm"><span>รายละเอียด (ไม่บังคับ)</span><textarea rows={3} maxLength={5000} className={field} value={description} onChange={event => setDescription(event.target.value)} placeholder="เพิ่มรายละเอียดของกิจกรรมนี้" /></label>
      </fieldset>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" disabled={saving} className={secondary} onClick={onClose}>ยกเลิก</button><button type="submit" disabled={saving} className={primary}>{saving ? 'กำลังบันทึก...' : 'บันทึกกิจกรรม'}</button></div>
    </form>
  </dialog>;
}

export const GoalsPage = () => {
  const [date, setDate] = useState(() => dateKey(new Date()));
  const [period, setPeriod] = useState<TaskPeriod>('day');
  const [tasks, setTasks] = useState<GoalTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState<number | null>(null);
  const [editor, setEditor] = useState<{ task: GoalTask | null } | null>(null);
  // Include full weeks at month boundaries for accurate summary cards.
  const month = taskBounds(date, 'month');
  const week = taskBounds(date, 'week');
  const rangeStart = month.start < week.start ? month.start : week.start;
  const rangeEnd = month.end > week.end ? month.end : week.end;

  useEffect(() => {
    let disposed = false;
    setLoading(true); setError('');
    api.get<GoalTask[]>('/goals/tasks', { params: { start: rangeStart, end: rangeEnd } })
      .then(response => { if (!disposed) setTasks(response.data); })
      .catch(err => { if (!disposed) { setTasks([]); setError(errorMessage(err, 'โหลดกิจกรรมไม่สำเร็จ กรุณาลองอีกครั้ง')); } })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [rangeStart, rangeEnd, refresh]);
  const visible = tasksInPeriod(tasks, date, period).sort((a, b) => a.task_date.localeCompare(b.task_date) || a.id - b.id);
  const progress = taskProgress(visible);
  const bounds = taskBounds(date, period);
  const toggle = async (task: GoalTask) => {
    if (busy !== null) return;
    setBusy(task.id); setError(''); setNotice('');
    try {
      const response = await api.post<GoalTask>(`/goals/tasks/${task.id}/complete`, { completed: !task.completed });
      setTasks(current => current.map(item => item.id === task.id ? response.data : item));
      setNotice(response.data.completed ? `ทำ “${task.title}” สำเร็จแล้ว` : `ยกเลิกเครื่องหมายสำเร็จของ “${task.title}” แล้ว`);
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(null); }
  };
  const remove = async (task: GoalTask) => {
    if (busy !== null || !window.confirm(`ลบกิจกรรม “${task.title}” หรือไม่?`)) return;
    setBusy(task.id); setError('');
    try {
      await api.post(`/goals/tasks/${task.id}/delete`);
      setTasks(current => current.filter(item => item.id !== task.id)); setNotice('ลบกิจกรรมเรียบร้อยแล้ว');
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(null); }
  };
  const taskRow = (task: GoalTask) => <div key={task.id} className="relative flex items-start gap-3 rounded-xl border border-blue-500/30 bg-blue-500/10 p-3">
    <input type="checkbox" aria-label={`ทำ ${task.title} สำเร็จ`} checked={task.completed} disabled={busy !== null || loading} onChange={() => void toggle(task)} className="mt-1 h-5 w-5 shrink-0 cursor-pointer accent-emerald-600 disabled:cursor-wait" />
    <div className="min-w-0 flex-1">
      <div className={task.completed ? 'text-[color:var(--muted)] line-through' : undefined}>
        <p className="break-words text-sm font-semibold">{task.title}</p>
        {task.description && <p className="mt-2 whitespace-pre-wrap break-words text-xs text-[color:var(--muted)]">{task.description}</p>}
      </div>
      {task.completed && <p className="mt-1 text-xs text-[color:var(--muted)]">สำเร็จแล้ว</p>}
    </div>
    <div className="flex shrink-0 gap-1"><button type="button" className="rounded-lg p-2 hover:bg-[color:var(--surface)] disabled:opacity-50" aria-label={`แก้ไข ${task.title}`} disabled={busy !== null || loading} onClick={() => setEditor({ task })}><Pencil size={15} /></button><button type="button" className="rounded-lg p-2 text-red-500 hover:bg-[color:var(--surface)] disabled:opacity-50" aria-label={`ลบ ${task.title}`} disabled={busy !== null || loading} onClick={() => void remove(task)}><Trash2 size={15} /></button></div>
  </div>;

  return <div className="space-y-5 pb-10 text-[color:var(--text)]">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="flex items-center gap-2 text-2xl font-bold"><Target className="text-[color:var(--accent)]" />เป้าหมายของฉัน</h1><p className="mt-1 text-sm text-[color:var(--muted)]">วางแผนสิ่งที่อยากทำ แล้วติ๊กถูกเมื่อทำสำเร็จ</p></div></header>
    <div className="grid gap-3 sm:grid-cols-3">{periods.map(item => {
      const value = taskProgress(tasksInPeriod(tasks, date, item.key));
      const range = taskBounds(date, item.key);
      return <button key={item.key} disabled={busy !== null} aria-pressed={period === item.key} onClick={() => setPeriod(item.key)} className={`${panel} p-4 text-left transition ${period === item.key ? 'ring-2 ring-[color:var(--accent)]' : ''}`}>
        <div className="flex items-center justify-between text-sm font-semibold"><span>เป้าหมาย{item.label}</span>{value.total > 0 && value.completed === value.total ? <CheckCircle2 size={18} className="text-emerald-500" /> : <Target size={18} className="text-[color:var(--muted)]" />}</div>
        <p className="mt-3 text-2xl font-bold tabular-nums">{loading ? '—' : `${value.percent}%`}</p>
        <p className="mt-2 text-xs text-[color:var(--muted)]">{item.key === 'day' ? formatDate(date) : `${formatDate(range.start)} – ${formatDate(range.end)}`}</p>
        <div role="progressbar" aria-label={`ความคืบหน้า${item.label}`} aria-valuenow={loading ? undefined : value.percent} aria-valuemin={0} aria-valuemax={100} className="mt-3 h-2 overflow-hidden rounded-full bg-[color:var(--surface-2)]"><div className="h-full rounded-full bg-emerald-500 transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${loading ? 0 : value.percent}%` }} /></div>
        <p className="mt-2 text-xs text-[color:var(--muted)]">{loading ? 'กำลังโหลด...' : value.total ? `สำเร็จ ${value.completed} จาก ${value.total} กิจกรรม` : 'ยังไม่มีกิจกรรมในช่วงนี้'}</p>
      </button>;
    })}</div>
    {error && <div role="alert" className={`${panel} flex flex-wrap items-center justify-between gap-2 p-4 text-sm text-red-500`}><span>{error}</span><button className={secondary} disabled={busy !== null} onClick={() => setRefresh(value => value + 1)}>ลองอีกครั้ง</button></div>}
    {notice && <p role="status" className="text-sm text-emerald-600">{notice}</p>}
    <section className={`${panel} overflow-hidden`} aria-label="รายการกิจกรรมเป้าหมาย">
      <div className="flex flex-wrap items-center justify-start gap-3 border-b border-[color:var(--border)] p-4">
        <label className="flex items-center gap-2 text-sm">วันที่อ้างอิง<DateInput required className={field} value={date} onChange={setDate} /></label>
        <button type="button" className={secondary} onClick={() => setDate(dateKey(new Date()))}>วันนี้</button>
        <select aria-label="ช่วงวันที่ของกิจกรรม" className={`${field} !w-auto`} value={period} disabled={busy !== null} onChange={event => setPeriod(event.target.value as TaskPeriod)}>{periods.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 bg-[color:var(--surface-2)] px-4 py-3"><h2 className="text-sm font-semibold">{period === 'day' ? formatDate(date) : `${formatDate(bounds.start)} – ${formatDate(bounds.end)}`}</h2><span className="text-xs text-[color:var(--muted)]">{loading ? 'กำลังโหลด...' : `สำเร็จ ${progress.completed}/${progress.total} กิจกรรม`}</span></div>
      {loading ? <p role="status" className="p-10 text-center text-sm text-[color:var(--muted)]">กำลังโหลดกิจกรรม...</p> : <>
        {!visible.length ? <div className="flex flex-col items-center gap-2 px-6 py-10 text-center"><ClipboardList className="text-[color:var(--muted)]" /><p className="text-sm">ยังไม่มีกิจกรรมในช่วงนี้</p><p className="text-xs text-[color:var(--muted)]">กดเพิ่มกิจกรรม แล้วพิมพ์สิ่งที่อยากทำได้เลย</p></div> : <div className="space-y-5 p-4">{[...new Set(visible.map(task => task.task_date))].map(day => <section key={day}>{period !== 'day' && <h3 className="mb-2 text-sm font-semibold">{formatDate(day)}</h3>}<div className="space-y-2">{visible.filter(task => task.task_date === day).map(taskRow)}</div></section>)}</div>}
        <div className="px-4 pb-4"><button type="button" className={primary} disabled={busy !== null} onClick={() => { setNotice(''); setEditor({ task: null }); }}><Plus size={18} />เพิ่มกิจกรรม</button></div>
      </>}
    </section>
    <p className="text-xs text-[color:var(--muted)]">ความคืบหน้า = กิจกรรมที่ติ๊กสำเร็จ ÷ กิจกรรมที่วางแผนไว้ในช่วงวันที่เลือก · สัปดาห์นับตั้งแต่วันจันทร์ถึงวันอาทิตย์ · เอาติ๊กออกได้หากต้องการกลับมาทำต่อ</p>
    {editor && <TaskEditor task={editor.task} date={date} onClose={() => setEditor(null)} onSaved={saved => { setEditor(null); setDate(saved.task_date); setNotice('บันทึกกิจกรรมเรียบร้อยแล้ว'); setRefresh(value => value + 1); }} />}
  </div>;
};
