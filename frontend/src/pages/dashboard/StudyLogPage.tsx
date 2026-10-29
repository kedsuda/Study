import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { format } from 'date-fns';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';
import { BookOpen, Calendar, FileText, LoaderCircle, Send, Sparkles } from 'lucide-react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ExpandableText } from '../../components/ExpandableText';
import { api, assetBaseURL } from '../../services/api';
import { getLastSubjectKey } from '../../constants/storage';
import { useAppAlert } from '../../context/AppAlertContext';
import { useAuth } from '../../context/AuthContext';
import { downloadStudyFileBlob, isSupabaseStudyFilePath, resolveStudyFileUrl } from '../../utils/localStudyFiles';

interface Subject {
  id: number;
  name: string;
  description?: string | null;
  target_hours?: number | null;
  semester?: number | null;
  academic_year?: number | null;
}

interface StudyFile {
  id: number;
  original_name: string;
  file_path: string;
  file_url?: string | null;
  file_type: string;
  mime_type?: string | null;
  file_size?: number | null;
}

interface Summary {
  id: number;
  content: string;
  created_at: string;
  ai_model?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface AudioSummary {
  id: number;
  summary: string;
  transcript?: string | null;
  created_at?: string;
  source?: string;
}

interface StudyLog {
  id: number;
  title: string;
  note: string;
  log_date: string;
  duration_minutes?: number | null; // Added to match database
  mood?: string | null; // Added to match database
  files: StudyFile[];
  summaries: Summary[];
  audio_summaries?: AudioSummary[];
}

interface StudyLogForm {
  title: string;
  note: string;
  log_date: string;
  duration_minutes?: number;
  mood?: string;
}

const storageBase = assetBaseURL || (api.defaults.baseURL ?? '').replace(/\/api\/?$/, '');
const documentExtensions = new Set(['pdf', 'doc', 'docx', 'txt']);

const normalizeDateInputValue = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return '';

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return '';

  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return '';
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const formatDateDisplayValue = (value: string) => {
  const normalized = normalizeDateInputValue(value);
  if (!normalized) return value;
  const [year, month, day] = normalized.split('-');
  return `${day}/${month}/${year}`;
};

const getFileExtension = (filename?: string | null) => {
  const value = filename?.trim() ?? '';
  const parts = value.split('.');
  return parts.length > 1 ? (parts.pop() ?? '').toLowerCase() : '';
};

const isDocumentAttachment = (file: StudyFile) => {
  const extension = getFileExtension(file.original_name);
  return documentExtensions.has(extension) || file.file_type === 'pdf' || file.file_type === 'word';
};

const extractPdfTextInBrowser = async (file: File) => {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerPort) {
    pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
  }

  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const items = textContent.items as Array<{ str?: string }>;
    const pageText = items
      .map(item => (typeof item.str === 'string' ? item.str.trim() : ''))
      .filter(Boolean)
      .join(' ');

    if (pageText) {
      pages.push(pageText);
    }
  }

  return pages.join('\n\n').trim();
};

const summarizeStoredDocumentFile = async (file: StudyFile) => {
  let blob = await downloadStudyFileBlob(file.file_path);
  if (!blob) {
    const fileUrl = file.file_url || resolveStudyFileUrl(file.file_path, storageBase);
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`โหลดไฟล์แนบไม่สำเร็จ (${response.status})`);
    }
    blob = await response.blob();
  }

  const formData = new FormData();
  const uploadFile = new File([blob], file.original_name, {
    type: file.mime_type || blob.type || 'application/octet-stream',
  });

  if (getFileExtension(file.original_name) === 'pdf') {
    try {
      const extractedText = await extractPdfTextInBrowser(uploadFile);
      if (extractedText.trim().length >= 20) {
        formData.append('text', extractedText);
      }
    } catch (pdfError) {
      console.warn('browser pdf text extraction failed', pdfError);
    }
  }

  if (!formData.has('text')) {
    formData.append('file', uploadFile, file.original_name);
  }

  const summaryResponse = await api.post('/ai/summarize/document', formData);
  return summaryResponse.data as { summary?: string; text?: string; model?: string };
};

export const StudyLogPage = () => {
  const { user } = useAuth();
  const { success, error } = useAppAlert();
  const { subjectId } = useParams();
  const [, setSharedSubjectId] = useSharedSubjectSelection();
  const location = useLocation();
  const [subject, setSubject] = useState<Subject | null>(null);
  const [logs, setLogs] = useState<StudyLog[]>([]);
  const [selectedLog, setSelectedLog] = useState<StudyLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [deletingLogId, setDeletingLogId] = useState<number | null>(null);
  const [deletingFileId, setDeletingFileId] = useState<number | null>(null);
  const [generatingSummaryId, setGeneratingSummaryId] = useState<number | null>(null);
  const [showAllLogs, setShowAllLogs] = useState(false);
  const [confirmState, setConfirmState] = useState<{ title: string; description: string; confirmLabel: string; onConfirm: () => Promise<void> | void } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const datePickerRef = useRef<HTMLInputElement | null>(null);
  const selectedLogIdFromState = Number((location.state as { selectedLogId?: number } | null)?.selectedLogId);
  const lastSubjectKey = useMemo(() => getLastSubjectKey(user?.id), [user?.id]);
  const defaultLogDate = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);
  const [logDateDisplay, setLogDateDisplay] = useState(() => formatDateDisplayValue(defaultLogDate));

  useEffect(() => {
    if (subjectId) {
      localStorage.setItem(lastSubjectKey, subjectId);
      setSharedSubjectId(subjectId);
    }
  }, [subjectId, lastSubjectKey, setSharedSubjectId]);
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { isSubmitting }
  } = useForm<StudyLogForm>({
    defaultValues: {
      title: '',
      note: '',
      log_date: defaultLogDate,
      duration_minutes: 60,
      mood: ''
    }
  });
  const logDateField = register('log_date', { required: true });
  const moodOptions = ['สนุก', 'เฉย ๆ', 'เครียด', 'มั่นใจ', 'ต้องทบทวน'];

  useEffect(() => {
    if (!subjectId) return;

    Promise.all([
      api.get(`/subjects/${subjectId}`),
      api.get(`/subjects/${subjectId}/study-logs`)
    ])
      .then(([subjectRes, logsRes]) => {
        const subjectPayload = subjectRes.data?.data ?? subjectRes.data;
        const logsPayload = logsRes.data?.data ?? logsRes.data;
        const logsList: StudyLog[] = Array.isArray(logsPayload) ? logsPayload : [];
        setSubject(subjectPayload);
        setLogs(logsList);
        if (Number.isFinite(selectedLogIdFromState)) {
          const matched = logsList.find(log => log.id === selectedLogIdFromState);
          setSelectedLog(matched ?? logsList[0] ?? null);
        } else {
          setSelectedLog(logsList[0] ?? null);
        }
      })
      .finally(() => setLoading(false));
  }, [subjectId, selectedLogIdFromState]);

  const onSubmit = async (data: StudyLogForm) => {
    if (!subjectId) return;
    const normalizedLogDate = normalizeDateInputValue(data.log_date);
    if (!normalizedLogDate) {
      error('กรุณากรอกวันที่เป็น วัน/เดือน/ปี');
      return;
    }
    const response = await api.post<StudyLog>(`/subjects/${subjectId}/study-logs`, {
      ...data,
      log_date: normalizedLogDate,
    });
    const payload = (response.data as any)?.data ?? response.data;
    setLogs(prev => [payload, ...prev]);
    setSelectedLog(payload);
    reset({
      title: '',
      note: '',
      log_date: defaultLogDate,
      duration_minutes: 60,
      mood: ''
    });
    setLogDateDisplay(formatDateDisplayValue(defaultLogDate));
  };

  const uploadFile = async (logId: number, file: File) => {
    try {
      const uploadForm = new FormData();
      uploadForm.append('file', file, file.name);
      const response = await api.post<StudyFile>(`/study-logs/${logId}/files`, uploadForm);

      const filePayload = (response.data as any)?.data ?? response.data;
      setLogs(prev =>
        prev.map(log => (log.id === logId ? { ...log, files: [...log.files, filePayload] } : log))
      );
      setSelectedLog(prev =>
        prev?.id === logId ? { ...prev, files: [...prev.files, filePayload] } : prev
      );
      success('อัปโหลดไฟล์เรียบร้อยแล้ว');
    } catch (err: any) {
      error(err?.response?.data?.message || err?.message || 'อัปโหลดไฟล์ไม่สำเร็จ');
    }
  };

  const openConfirmDialog = (config: { title: string; description: string; confirmLabel: string; onConfirm: () => Promise<void> | void }) => {
    setConfirmState(config);
    setConfirmBusy(false);
  };

  const handleConfirmDialogCancel = () => {
    setConfirmState(null);
    setConfirmBusy(false);
  };

  const handleConfirmDialogConfirm = async () => {
    if (!confirmState) return;
    setConfirmBusy(true);
    try {
      await confirmState.onConfirm();
    } finally {
      setConfirmBusy(false);
      setConfirmState(null);
    }
  };

  const deleteLog = async (logId: number) => {
    if (!subjectId) return;
    openConfirmDialog({
      title: 'ลบบันทึกการเรียน',
      description: 'ต้องการลบบันทึกการเรียนนี้ใช่หรือไม่?',
      confirmLabel: 'ลบ',
      onConfirm: async () => {
        setDeletingLogId(logId);
        try {
          await api.delete(`/subjects/${subjectId}/study-logs/${logId}`);
          let nextLogs: StudyLog[] = [];
          setLogs(prev => {
            nextLogs = prev.filter(log => log.id !== logId);
            return nextLogs;
          });
          setSelectedLog(prev => (prev?.id === logId ? nextLogs[0] ?? null : prev));
          success('ลบบันทึกการเรียนเรียบร้อยแล้ว');
        } catch {
          error('ลบบันทึกการเรียนไม่สำเร็จ');
        } finally {
          setDeletingLogId(null);
        }
      },
    });
  };

  const deleteFile = async (logId: number, file: StudyFile) => {
    openConfirmDialog({
      title: 'ลบไฟล์',
      description: `ต้องการลบไฟล์ "${file.original_name}" ใช่หรือไม่?`,
      confirmLabel: 'ลบไฟล์',
      onConfirm: async () => {
        setDeletingFileId(file.id);
        try {
          await api.delete(`/files/${file.id}`);
          setLogs(prev =>
            prev.map(log =>
              log.id === logId ? { ...log, files: log.files.filter(item => item.id !== file.id) } : log
            )
          );
          success('ลบไฟล์เรียบร้อยแล้ว');
        } catch {
          error('ลบไฟล์ไม่สำเร็จ');
        } finally {
          setDeletingFileId(null);
        }
      },
    });
  };

  const generateSummary = async (logId: number) => {
    setGeneratingSummaryId(logId);
    try {
      const targetLog = logs.find(log => log.id === logId) ?? selectedLog;
      const documentFile = targetLog?.files?.find(isDocumentAttachment) ?? null;
      let response;

      if (documentFile) {
        try {
          const documentSummary = await summarizeStoredDocumentFile(documentFile);
          const content = documentSummary.summary?.trim();
          if (!content) {
            throw new Error('Groq ไม่ได้ส่งผลสรุปกลับมา');
          }

          response = await api.post<Summary>(`/study-logs/${logId}/summaries`, {
            content,
            ai_model: documentSummary.model ?? null,
            metadata: {
              source: 'document',
              file_id: documentFile.id,
              file_name: documentFile.original_name,
              text_length: documentSummary.text?.length ?? null,
            },
          });
        } catch (fileError) {
          if (isSupabaseStudyFilePath(documentFile.file_path)) {
            throw fileError;
          }
          console.warn('browser document summary failed; trying backend file summary', fileError);
          response = await api.post<Summary>(`/study-logs/${logId}/summaries`, {
            file_id: documentFile.id,
          });
        }
      } else {
        response = await api.post<Summary>(`/study-logs/${logId}/summaries`);
      }

      const payload = (response.data as any)?.data ?? response.data;
      setLogs(prev =>
        prev.map(log =>
          log.id === logId ? { ...log, summaries: [payload, ...(log.summaries ?? [])] } : log
        )
      );
      setSelectedLog(prev =>
        prev?.id === logId ? { ...prev, summaries: [payload, ...(prev.summaries ?? [])] } : prev
      );
      success(documentFile ? 'สร้างสรุปจากไฟล์ด้วย Groq เรียบร้อยแล้ว' : 'สร้างสรุปด้วย Groq เรียบร้อยแล้ว');
    } catch (err: any) {
      const message = err?.response?.data?.message || err?.message || 'สร้างสรุปไม่สำเร็จ กรุณาตรวจสอบ Groq API key แล้วลองใหม่';
      error(message);
    } finally {
      setGeneratingSummaryId(null);
    }
  };

  const currentLog = useMemo(
    () => logs.find(log => log.id === selectedLog?.id) ?? selectedLog,
    [logs, selectedLog]
  );

  if (loading) {
    return <p className="text-muted">กำลังโหลดข้อมูล...</p>;
  }

  if (!subject) {
    return <p className="text-rose-500">ไม่พบรายวิชา</p>;
  }

  return (
    <div className="w-full rounded-[2rem] border border-pink-100 bg-white/95 p-5 text-[color:var(--text)] shadow-[0_18px_55px_rgba(236,72,153,0.10)]">
      <section className="relative overflow-hidden rounded-[1.35rem] bg-gradient-to-r from-pink-500 via-pink-400 to-pink-500 px-6 py-5 text-white shadow-[0_20px_45px_rgba(236,72,153,0.24)]">
        <div className="absolute right-6 top-4 hidden text-white/20 sm:block">
          <BookOpen size={86} strokeWidth={1.2} />
        </div>
        <div className="relative flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/20 ring-1 ring-white/35 backdrop-blur">
            <BookOpen size={24} />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.36em] text-white/75">Subject Timeline</p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <h2 className="min-w-0 truncate text-2xl font-black leading-tight md:text-3xl">{subject.name}</h2>
              <Link
                to={`/subjects?edit=${subject.id}`}
                aria-label={`เปลี่ยนชื่อรายวิชา ${subject.name}`}
                className="shrink-0 rounded-lg border border-white/40 bg-white/15 px-3 py-1.5 text-xs font-semibold transition hover:bg-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                เปลี่ยนชื่อรายวิชา
              </Link>
            </div>
            <p className="mt-1 text-xs font-semibold text-white/90">{subject.description ?? 'ติดตามและบันทึกความก้าวหน้าของคุณได้ที่นี่'}</p>
          </div>
        </div>
      </section>

      <div className="mt-5 grid gap-5 lg:grid-cols-[330px,1fr]">
        <aside className="rounded-[1.5rem] border border-pink-100 bg-white p-5 shadow-[0_16px_34px_rgba(15,23,42,0.06)]">
          <h3 className="text-base font-black text-slate-900">บันทึกการเรียน</h3>
          <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-3">
            <input
              placeholder="หัวข้อที่เรียน"
              className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-800 outline-none transition focus:border-pink-300 focus:bg-white focus:ring-4 focus:ring-pink-100"
              {...register('title', { required: true })}
            />
            <textarea
              placeholder="สรุปบทเรียน / สิ่งที่เข้าใจ"
              className="h-24 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-800 outline-none transition focus:border-pink-300 focus:bg-white focus:ring-4 focus:ring-pink-100"
              {...register('note')}
            />
            <input
              placeholder="สิ่งที่ต้องการเรียนรู้เพิ่มเติม (ถ้ามี)"
              className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-800 outline-none transition focus:border-pink-300 focus:bg-white focus:ring-4 focus:ring-pink-100"
            />
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-600">วันที่เรียน</label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="dd/mm/yyyy"
                    value={logDateDisplay}
                    onChange={event => {
                      const nextDisplay = event.target.value;
                      setLogDateDisplay(nextDisplay);
                      const normalized = normalizeDateInputValue(nextDisplay);
                      if (normalized) {
                        setValue('log_date', normalized, { shouldDirty: true, shouldValidate: true });
                      }
                    }}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 pr-10 text-sm text-slate-800 outline-none transition focus:border-pink-300 focus:bg-white focus:ring-4 focus:ring-pink-100"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const picker = datePickerRef.current;
                      if (!picker) return;
                      if (typeof (picker as any).showPicker === 'function') (picker as any).showPicker();
                      else picker.click();
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-pink-500"
                    aria-label="เลือกวันที่เรียน"
                    title="เลือกวันที่เรียน"
                  >
                    <Calendar size={16} />
                  </button>
                  <input
                    type="date"
                    className="absolute inset-0 pointer-events-none opacity-0"
                    tabIndex={-1}
                    aria-hidden="true"
                    {...logDateField}
                    ref={element => {
                      logDateField.ref(element);
                      datePickerRef.current = element;
                    }}
                    onChange={event => {
                      const normalized = normalizeDateInputValue(event.target.value);
                      if (!normalized) return;
                      setValue('log_date', normalized, { shouldDirty: true, shouldValidate: true });
                      setLogDateDisplay(formatDateDisplayValue(normalized));
                    }}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-600">เวลา (นาที)</label>
                <input
                  type="number"
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800 outline-none transition focus:border-pink-300 focus:bg-white focus:ring-4 focus:ring-pink-100"
                  {...register('duration_minutes')}
                />
              </div>
            </div>
            <div>
              <label className="mb-2 block text-xs font-bold text-slate-600">อารมณ์</label>
              <select
                className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-pink-300 focus:bg-white focus:ring-4 focus:ring-pink-100"
                {...register('mood')}
              >
                <option value="">เลือกอารมณ์</option>
                {moodOptions.map(mood => (
                  <option key={mood} value={mood}>{mood}</option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-pink-500 px-4 text-sm font-black text-white shadow-[0_16px_30px_rgba(236,72,153,0.28)] transition hover:bg-pink-600 disabled:opacity-60"
              disabled={isSubmitting}
            >
              <Send size={16} />
              {isSubmitting ? 'กำลังบันทึก...' : 'บันทึกการเรียน'}
            </button>
          </form>
        </aside>

        <section className="space-y-4">
          <div className="rounded-[1.5rem] border border-pink-100 bg-white p-5 shadow-[0_16px_34px_rgba(15,23,42,0.06)]">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900">บันทึกล่าสุด</h3>
              {logs.length > 3 ? (
                <button
                  type="button"
                  onClick={() => setShowAllLogs(prev => !prev)}
                  className="rounded-full px-2 py-1 text-[11px] font-black text-pink-500 transition hover:bg-pink-50"
                >
                  {showAllLogs ? 'ย่อรายการ' : 'ดูทั้งหมด'} &gt;
                </button>
              ) : null}
            </div>
            <div className={`${showAllLogs ? 'max-h-[560px]' : 'max-h-[255px]'} space-y-0 overflow-y-auto pr-2 transition-[max-height] duration-300`}>
              {logs.map((log, index) => (
                <article key={log.id} className="relative flex gap-4 pb-4">
                  <div className="flex w-4 shrink-0 flex-col items-center">
                    <span className={`mt-2 h-2.5 w-2.5 rounded-full ${currentLog?.id === log.id ? 'bg-pink-500' : 'bg-pink-300'}`} />
                    {index < logs.length - 1 ? <span className="mt-1 h-full w-px bg-pink-200" /> : null}
                  </div>
                  <div
                    className={`flex-1 rounded-xl px-3 py-2 transition ${
                      currentLog?.id === log.id ? 'bg-pink-50 ring-1 ring-pink-100' : 'hover:bg-slate-50'
                    }`}
                  >
                    <button type="button" onClick={() => setSelectedLog(log)} className="w-full text-left">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                        {format(new Date(log.log_date), 'd MMM yyyy')}
                      </p>
                      <p className="mt-0.5 line-clamp-1 text-sm font-bold text-slate-900">{log.title}</p>
                      {log.duration_minutes ? (
                        <p className="mt-0.5 text-[11px] text-slate-500">{log.duration_minutes} นาที {log.mood ? `• ${log.mood}` : ''}</p>
                      ) : null}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => void deleteLog(log.id)}
                    disabled={deletingLogId === log.id}
                    className="mt-5 h-7 shrink-0 rounded-full border border-pink-200 bg-pink-50 px-3 text-[11px] font-bold text-pink-500 transition hover:bg-pink-100 disabled:opacity-60"
                  >
                    {deletingLogId === log.id ? '...' : 'ลบ'}
                  </button>
                </article>
              ))}
            </div>
            {logs.length === 0 ? (
              <p className="rounded-xl border border-dashed border-pink-200 bg-pink-50/60 p-4 text-center text-sm text-slate-500">
                ยังไม่มีบันทึก เริ่มต้นด้วยการเพิ่มหัวข้อใหม่ทางด้านซ้าย
              </p>
            ) : null}
          </div>

          {currentLog && (
            <article className="rounded-[1.5rem] border border-pink-100 bg-white p-5 shadow-[0_16px_34px_rgba(15,23,42,0.06)]">
              <header>
                <h3 className="text-lg font-black text-slate-900">{currentLog.title}</h3>
                <p className="text-xs font-semibold text-slate-500">{format(new Date(currentLog.log_date), 'EEEE d MMM yyyy')}</p>
              </header>
              <div className="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
                <ExpandableText key={currentLog.id} text={currentLog.note || 'ไม่มีโน้ต'} />
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(280px,0.9fr),minmax(0,1.1fr)]">
                <div className="rounded-xl border border-pink-100 bg-white p-4">
                  <h4 className="mb-2 text-sm font-black text-pink-500">ไฟล์แนบ</h4>
                  <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-pink-200 bg-pink-50/60 px-4 py-3 text-sm font-semibold text-slate-500 transition hover:border-pink-300 hover:bg-pink-50">
                    <FileText size={15} />
                    <span>อัปโหลดไฟล์ (.pdf, .docx, .mp3, รูปภาพ)</span>
                    <input
                      type="file"
                      hidden
                      accept=".pdf,.doc,.docx,.txt,.mp3,.wav,.m4a,.jpg,.jpeg,.png,.gif,.webp,image/*,audio/*"
                      onChange={event => {
                        const file = event.target.files?.[0];
                        if (file) {
                          void uploadFile(currentLog.id, file);
                        }
                      }}
                    />
                  </label>
                  {currentLog.files.length > 0 ? (
                    <ul className="mt-2 space-y-2 text-sm text-slate-600">
                      {currentLog.files.map(file => (
                        <li key={file.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                          <span className="min-w-0 truncate">{file.original_name}</span>
                          <div className="flex shrink-0 items-center gap-2">
                            <a
                              href={file.file_url || resolveStudyFileUrl(file.file_path, storageBase)}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs font-bold text-pink-500"
                            >
                              เปิดไฟล์
                            </a>
                            <button
                              type="button"
                              onClick={() => void deleteFile(currentLog.id, file)}
                              disabled={deletingFileId === file.id}
                              className="rounded-full border border-pink-200 bg-pink-50 px-3 py-1 text-[11px] font-bold text-pink-500 transition hover:bg-pink-100 disabled:opacity-60"
                            >
                              {deletingFileId === file.id ? '...' : 'ลบ'}
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500">ยังไม่มีไฟล์แนบ</p>
                  )}
                </div>

                <div className="rounded-xl border border-pink-100 bg-pink-50/50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-black text-pink-500">สรุปจากไฟล์แนบ</h4>
                  
                    </div>
                    <button
                      type="button"
                      onClick={() => void generateSummary(currentLog.id)}
                      disabled={generatingSummaryId === currentLog.id}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-pink-500 px-4 text-xs font-black text-white shadow-[0_12px_24px_rgba(236,72,153,0.22)] transition hover:bg-pink-600 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {generatingSummaryId === currentLog.id ? <LoaderCircle size={15} className="animate-spin" /> : <Sparkles size={15} />}
                      {generatingSummaryId === currentLog.id ? 'กำลังสรุป...' : 'สรุปด้วย Groq'}
                    </button>
                  </div>
                  {currentLog.summaries?.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      {currentLog.summaries.map(summary => (
                        <div key={summary.id} className="rounded-xl border border-pink-100 bg-white px-4 py-3 text-sm leading-6 text-slate-700">
                          <ExpandableText text={summary.content} />
                          <p className="mt-2 text-[11px] font-semibold text-slate-400">
                            {summary.ai_model ? `Model: ${summary.ai_model}` : 'AI summary'}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 rounded-xl border border-dashed border-pink-100 bg-white/70 px-4 py-3 text-xs text-slate-500">
                      ยังไม่มีสรุปสำหรับบันทึกนี้
                    </p>
                  )}
                </div>
              </div>

            </article>
          )}
        </section>
      </div>
      <ConfirmDialog
        isOpen={Boolean(confirmState)}
        title={confirmState?.title ?? ''}
        description={confirmState?.description ?? ''}
        confirmLabel={confirmState?.confirmLabel ?? 'ยืนยัน'}
        onConfirm={handleConfirmDialogConfirm}
        onCancel={handleConfirmDialogCancel}
        busy={confirmBusy}
      />
    </div>
  );
};
import { useSharedSubjectSelection } from '../../hooks/useAcademicSelection';
