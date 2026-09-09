import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { api, assetBaseURL } from '../../services/api';
import { useAppAlert } from '../../context/AppAlertContext';
import { useDefaultSemesterSelection, useSemesterOptions } from '../../hooks/useSemesterOptions';
import { filterBySemester, toNumberOrNull } from '../../utils/semester';
import { resolveStudyFileUrl } from '../../utils/studyFiles';

type SubjectOption = {
  id: number;
  name: string;
  semester_id?: number | null;
  semester?: number | null;
  academic_year?: number | null;
};

type StudyFile = {
  id: number;
  original_name: string;
  file_path: string;
  file_url?: string | null;
  file_type: string;
  file_size?: number | null;
  status?: string | null;
  archived_at?: string | null;
  created_at?: string | null;
};

type StudyLogEntry = {
  id: number;
  files?: StudyFile[];
};

type StorageFile = StudyFile & {
  subjectId: number;
  subjectName: string;
};

type PreviewState = {
  file: StorageFile;
  url: string;
};

const unwrapCollection = (payload: any): any[] => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.data)) return payload.data.data;
  return [];
};

const formatFileSize = (bytes?: number | null) => {
  if (!Number.isFinite(Number(bytes))) return 'ไม่ทราบขนาด';
  const value = Number(bytes);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value >= 1024 * 100 ? 0 : 1)} KB`;
  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(value >= 1024 * 1024 * 100 ? 0 : 1)} MB`;
  }
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const formatThaiDateTime = (value?: string | null) => {
  if (!value) return 'ไม่ทราบเวลา';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getSubjectTone = (index: number, active: boolean) => {
  void index;
  return active
    ? 'border-[color:var(--accent)] bg-[color:rgba(var(--accent-rgb),0.08)] shadow-sm'
    : 'border-[color:var(--border)] bg-[color:var(--surface)] hover:bg-[color:var(--surface-2)]';
};

const getFolderTone = (index: number) => {
  const tones = [
    'bg-blue-100 text-blue-600',
    'bg-pink-100 text-pink-600',
    'bg-emerald-100 text-emerald-600',
    'bg-orange-100 text-orange-600',
  ];
  return tones[index % tones.length];
};

const getFileBadgeTone = (type: string) => {
  switch (type) {
    case 'pdf':
      return 'bg-red-50 text-red-500';
    case 'image':
      return 'bg-blue-50 text-blue-500';
    case 'audio':
      return 'bg-orange-50 text-orange-500';
    case 'word':
      return 'bg-indigo-50 text-indigo-500';
    default:
      return 'bg-slate-100 text-slate-500';
  }
};

const normalizeFileStatus = (value?: string | null) => {
  const status = (value || '').trim().toLowerCase();
  return status === 'archived' ? 'archived' : 'active';
};

const FileTypeIcon = ({ type }: { type: string }) => {
  if (type === 'pdf') {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M8 13h2a1.5 1.5 0 0 1 0 3H8z" />
        <path d="M14 16v-3h1a1.5 1.5 0 0 1 0 3z" />
      </svg>
    );
  }
  if (type === 'image') {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="9" cy="9" r="1.5" />
        <path d="m21 15-4.5-4.5L5 21" />
      </svg>
    );
  }
  if (type === 'audio') {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3v12" />
        <path d="M18 3v8" />
        <path d="M12 7 18 5" />
        <circle cx="10" cy="18" r="3" />
        <circle cx="16" cy="16" r="3" />
      </svg>
    );
  }
  if (type === 'word') {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="m8 13 1.5 4L12 13l2.5 4L16 13" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
};

export const StudyStoragePage = () => {
  const navigate = useNavigate();
  const { success, error } = useAppAlert();
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [files, setFiles] = useState<StorageFile[]>([]);
  const [selectedSemesterKey, setSelectedSemesterKey] = useState('all');
  const [activeSubjectId, setActiveSubjectId] = useState<'all' | number>('all');
  const [loading, setLoading] = useState(true);
  const [deletingFileId, setDeletingFileId] = useState<number | null>(null);
  const [updatingFileStatusId, setUpdatingFileStatusId] = useState<number | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [confirmState, setConfirmState] = useState<{ title: string; description: string; confirmLabel: string; onConfirm: () => Promise<void> | void } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [textPreview, setTextPreview] = useState<string>('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [fileTypeFilter, setFileTypeFilter] = useState<'all' | 'audio' | 'word' | 'pdf' | 'image'>('all');
  const [sortBy, setSortBy] = useState<'latest' | 'oldest' | 'name_asc' | 'size_desc' | 'size_asc'>('latest');
  const semesterOptions = useSemesterOptions();
  useDefaultSemesterSelection(semesterOptions, selectedSemesterKey, setSelectedSemesterKey);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const subjectResponse = await api.get('/subjects');
        const nextSubjects = unwrapCollection(subjectResponse.data)
          .map((item: any) => ({
            id: Number(item.id),
            name: String(item.name ?? item.subject_name ?? '').trim(),
            semester_id: toNumberOrNull(item.semester_id),
            semester: toNumberOrNull(item.semester),
            academic_year: toNumberOrNull(item.academic_year),
          }))
          .filter((item: SubjectOption) => Number.isFinite(item.id) && item.name !== '');

        setSubjects(nextSubjects);

        const logResponses = await Promise.all(
          nextSubjects.map(async subject => {
            const response = await api.get(`/subjects/${subject.id}/study-logs`);
            const logs = unwrapCollection(response.data) as StudyLogEntry[];
            return logs.flatMap(log =>
              (Array.isArray(log.files) ? log.files : []).map(file => ({
                ...file,
                subjectId: subject.id,
                subjectName: subject.name,
              }))
            );
          })
        );

        const nextFiles = logResponses
          .flat()
          .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime());

        setFiles(nextFiles);
      } finally {
        setLoading(false);
      }
    };

    void loadData();
  }, []);

  const filteredSubjects = useMemo(
    () => filterBySemester(subjects, selectedSemesterKey),
    [selectedSemesterKey, subjects]
  );

  useEffect(() => {
    if (activeSubjectId !== 'all' && !filteredSubjects.some(subject => subject.id === activeSubjectId)) {
      setActiveSubjectId('all');
    }
  }, [activeSubjectId, filteredSubjects]);

  const filteredFiles = useMemo(
    () => {
      const semesterSubjectIds = new Set(filteredSubjects.map(subject => subject.id));
      const semesterFiles = files.filter(file => semesterSubjectIds.has(file.subjectId));
      return activeSubjectId === 'all' ? semesterFiles : semesterFiles.filter(file => file.subjectId === activeSubjectId);
    },
    [activeSubjectId, files, filteredSubjects]
  );

  const visibleFiles = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    const matchesKeyword = (file: StorageFile) =>
      keyword === '' ||
      file.original_name.toLowerCase().includes(keyword) ||
      file.subjectName.toLowerCase().includes(keyword);
    const matchesType = (file: StorageFile) => fileTypeFilter === 'all' || file.file_type === fileTypeFilter;

    const next = filteredFiles.filter(file => matchesKeyword(file) && matchesType(file));
    next.sort((a, b) => {
      if (sortBy === 'oldest') return new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime();
      if (sortBy === 'name_asc') return a.original_name.localeCompare(b.original_name, 'th');
      if (sortBy === 'size_desc') return Number(b.file_size ?? 0) - Number(a.file_size ?? 0);
      if (sortBy === 'size_asc') return Number(a.file_size ?? 0) - Number(b.file_size ?? 0);
      return new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
    });
    return next;
  }, [filteredFiles, fileTypeFilter, searchText, sortBy]);

  const visibleSubjectGroups = useMemo(() => {
    const groups = new Map<number, { subjectId: number; subjectName: string; files: StorageFile[]; totalSize: number }>();

    visibleFiles.forEach(file => {
      const current = groups.get(file.subjectId) ?? {
        subjectId: file.subjectId,
        subjectName: file.subjectName,
        files: [],
        totalSize: 0,
      };

      current.files.push(file);
      current.totalSize += Number.isFinite(Number(file.file_size)) ? Number(file.file_size) : 0;
      groups.set(file.subjectId, current);
    });

    return Array.from(groups.values());
  }, [visibleFiles]);

  const totalUsage = useMemo(
    () => files.reduce((sum, file) => sum + (Number.isFinite(Number(file.file_size)) ? Number(file.file_size) : 0), 0),
    [files]
  );

  const subjectSummaries = useMemo(
    () =>
      filteredSubjects.map(subject => {
        const subjectFiles = files.filter(file => file.subjectId === subject.id);
        const subjectUsage = subjectFiles.reduce(
          (sum, file) => sum + (Number.isFinite(Number(file.file_size)) ? Number(file.file_size) : 0),
          0
        );
        return {
          id: subject.id,
          name: subject.name,
          count: subjectFiles.length,
          size: subjectUsage,
        };
      }),
    [files, filteredSubjects]
  );

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

  const handleDeleteFile = async (fileId: number, name: string) => {
    openConfirmDialog({
      title: 'ลบไฟล์',
      description: `ต้องการลบไฟล์ "${name}" ใช่หรือไม่?`,
      confirmLabel: 'ลบไฟล์',
      onConfirm: async () => {
        setDeletingFileId(fileId);
        try {
          await api.delete(`/files/${fileId}`);
          setFiles(prev => prev.filter(file => file.id !== fileId));
          success('ลบไฟล์เรียบร้อยแล้ว');
        } catch {
          error('ลบไฟล์ไม่สำเร็จ');
        } finally {
          setDeletingFileId(null);
        }
      },
    });
  };

  const handleToggleArchiveFile = async (file: StorageFile) => {
    const nextStatus = normalizeFileStatus(file.status) === 'archived' ? 'active' : 'archived';
    setUpdatingFileStatusId(file.id);
    try {
      const response = await api.patch(`/files/${file.id}/status`, { status: nextStatus });
      const payload = response.data?.data ?? response.data;
      setFiles(prev =>
        prev.map(item =>
          item.id === file.id
            ? {
                ...item,
                status: typeof payload?.status === 'string' ? payload.status : nextStatus,
                archived_at: typeof payload?.archived_at === 'string' ? payload.archived_at : nextStatus === 'archived' ? new Date().toISOString() : null,
              }
            : item
        )
      );
      window.dispatchEvent(new Event('slt:archive-refresh'));
      success(nextStatus === 'archived' ? 'เก็บถาวรไฟล์เรียบร้อยแล้ว' : 'นำไฟล์กลับมาใช้งานเรียบร้อยแล้ว');
    } catch {
      error(nextStatus === 'archived' ? 'เก็บถาวรไฟล์ไม่สำเร็จ' : 'นำไฟล์กลับไม่สำเร็จ');
    } finally {
      setUpdatingFileStatusId(null);
    }
  };

  const handlePreviewFile = async (file: StorageFile) => {
    const url = file.file_url || resolveStudyFileUrl(file.file_path, assetBaseURL || (api.defaults.baseURL ?? '').replace(/\/api\/?$/, ''));
    setPreview({ file, url });
    setTextPreview('');

    const isTextFile =
      file.file_type === 'word' &&
      /\.(txt)$/i.test(file.original_name);

    if (!isTextFile) {
      return;
    }

    setPreviewLoading(true);
    try {
      const response = await fetch(url);
      const content = await response.text();
      setTextPreview(content);
    } catch {
      setTextPreview('ไม่สามารถโหลดข้อความจากไฟล์นี้ได้');
    } finally {
      setPreviewLoading(false);
    }
  };

  const progressWidth = Math.min((totalUsage / (1024 * 1024 * 1024)) * 100, 100);

  return (
    <div className="space-y-5 bg-[color:var(--bg)] pb-1 text-[color:var(--text)]">
      {preview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-2 backdrop-blur-sm sm:p-4">
          <div className="flex h-[78vh] w-full max-w-6xl flex-col overflow-hidden rounded-[1.25rem] bg-white shadow-[0_24px_60px_rgba(15,23,42,0.28)] sm:h-[80vh] sm:rounded-[1.75rem]">
            <div className="flex flex-col gap-3 border-b border-slate-100 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5 sm:py-4">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-xs font-bold text-slate-800 sm:text-sm">{preview.file.original_name}</h2>
                <p className="mt-1 line-clamp-2 text-[10px] text-slate-500 sm:text-[11px]">
                  {preview.file.subjectName} • {formatFileSize(preview.file.file_size)} • {formatThaiDateTime(preview.file.created_at)}
                </p>
              </div>
              <div className="flex items-center justify-end gap-2">
                <a
                  href={preview.url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 rounded-xl border border-slate-200 px-3 py-2 text-[11px] font-bold text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 sm:text-xs"
                >
                  เปิดไฟล์ต้นฉบับ
                </a>
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  className="shrink-0 rounded-xl border border-slate-200 p-2 text-slate-400 transition hover:bg-slate-50 hover:text-slate-600"
                  aria-label="ปิดตัวอย่างไฟล์"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden bg-slate-50">
              {preview.file.file_type === 'image' ? (
                <div className="flex h-full items-center justify-center p-2 sm:p-4">
                  <img src={preview.url} alt={preview.file.original_name} className="max-h-full max-w-full rounded-xl object-contain shadow-sm sm:rounded-2xl" />
                </div>
              ) : preview.file.file_type === 'audio' ? (
                <div className="flex h-full flex-col items-center justify-center gap-4 p-4 sm:p-6">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-orange-100 text-orange-500">
                    <FileTypeIcon type={preview.file.file_type} />
                  </div>
                  <audio controls className="w-full max-w-2xl">
                    <source src={preview.url} />
                  </audio>
                </div>
              ) : preview.file.file_type === 'pdf' ? (
                <iframe title={preview.file.original_name} src={preview.url} className="h-full w-full border-0" />
              ) : /\.(txt)$/i.test(preview.file.original_name) ? (
                <div className="h-full overflow-auto p-3 sm:p-5">
                  {previewLoading ? (
                    <div className="text-sm text-slate-500">กำลังโหลดเนื้อหา...</div>
                  ) : (
                    <pre className="whitespace-pre-wrap break-words rounded-2xl bg-white p-4 text-sm leading-6 text-slate-700 shadow-sm">{textPreview || 'ไม่มีข้อความในไฟล์นี้'}</pre>
                  )}
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-4 p-4 text-center sm:p-6">
                  <div className={`flex h-16 w-16 items-center justify-center rounded-2xl ${getFileBadgeTone(preview.file.file_type)}`}>
                    <FileTypeIcon type={preview.file.file_type} />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-800">ยังไม่รองรับพรีวิวไฟล์ประเภทนี้ในหน้าเดียว</p>
                    <p className="mt-1 text-xs text-slate-500">คุณยังเปิดไฟล์ต้นฉบับจากปุ่มด้านบนได้</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <section className="rounded-b-[2.15rem] border-b px-5 pb-7 pt-2 shadow-soft sm:px-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <button
          type="button"
          onClick={() => navigate('/ai-assistant')}
          className="group mb-5 inline-flex w-fit items-center gap-1.5 rounded-full border border-slate-200/90 bg-slate-50/90 px-4 py-2 text-xs font-bold text-slate-600 shadow-[0_4px_12px_rgba(148,163,184,0.12)] transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          กลับหน้าหลัก
        </button>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.32em] text-[color:var(--accent-ink)]">My Storage</p>
            <h1 className="mt-1.5 text-[1.8rem] font-bold leading-tight text-[color:var(--text)]">กระเป๋าเก็บไฟล์</h1>
           
          </div>
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[color:rgba(var(--accent-rgb),0.10)] text-[color:var(--accent-ink)] shadow-soft ring-1 ring-[color:rgba(var(--accent-rgb),0.16)]">
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
              <path d="M10 12h4" />
            </svg>
          </div>
        </div>
      </section>

      <div className="space-y-6 px-5 pb-8 sm:px-6">
        <section className="rounded-[1.75rem] border p-5 shadow-soft backdrop-blur" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[color:rgba(var(--accent-rgb),0.10)] text-[color:var(--accent-ink)]">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="14" rx="2" />
                <path d="M7 20h10" />
                <path d="M9 16v4" />
                <path d="M15 16v4" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-bold text-[color:var(--text)]">พื้นที่เก็บข้อมูล</h2>
              <p className="text-[11px] text-[color:var(--muted)]">จำกัดสูงสุด 1 GB ต่อบัญชี</p>
            </div>
          </div>

          <div className="mt-4 flex items-end justify-between gap-3">
            <span className="text-xs font-bold text-[color:var(--accent-ink)]">ใช้ไป {formatFileSize(totalUsage)}</span>
            <span className="text-[10px] font-medium text-[color:var(--muted)]">1 GB</span>
          </div>
          <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-[color:var(--accent)]" style={{ width: `${progressWidth}%` }} />
          </div>
        </section>

        <section>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-bold text-[color:var(--text)]">แฟ้มรายวิชา</h2>
            <div className="flex items-center gap-2">
              <label htmlFor="storage-semester-filter" className="sr-only">กรองภาคเรียน</label>
              <select
                id="storage-semester-filter"
                value={selectedSemesterKey}
                onChange={event => {
                  setSelectedSemesterKey(event.target.value);
                  setActiveSubjectId('all');
                }}
                className="max-w-[210px] rounded-lg border px-2.5 py-1.5 text-xs font-semibold text-[color:var(--text)] outline-none transition focus:border-[color:var(--accent)]"
                style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
              >
                {semesterOptions.map(option => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
              {activeSubjectId !== 'all' ? (
                <button
                  type="button"
                  onClick={() => setActiveSubjectId('all')}
                  className="rounded-md bg-indigo-50 px-2 py-1 text-[10px] font-bold text-indigo-600"
                >
                  ดูทั้งหมด
                </button>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {subjectSummaries.map((subject, index) => {
              const active = activeSubjectId === subject.id;
              return (
                <button
                  key={subject.id}
                  type="button"
                  onClick={() => setActiveSubjectId(subject.id)}
                  className={`rounded-2xl border p-4 text-left transition-all ${getSubjectTone(index, active)}`}
                >
                  <div
                    className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl ${active ? '' : getFolderTone(index)}`}
                    style={active ? { background: 'var(--accent)', color: 'var(--on-accent)' } : undefined}
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
                    </svg>
                  </div>
                  <h3 className="text-xs font-bold text-[color:var(--text)]">{subject.name}</h3>
                  <p className="mt-0.5 text-[10px] text-[color:var(--muted)]">
                    {subject.count > 0 ? `${subject.count} ไฟล์ • ${formatFileSize(subject.size)}` : 'ว่างเปล่า'}
                  </p>
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <div className="mb-4 flex flex-col gap-1">
            <h2 className="text-base font-bold text-[color:var(--text)]">
              {activeSubjectId === 'all'
                ? 'ไฟล์สรุปแยกตามรายวิชา'
                : `ไฟล์สรุปในวิชา ${subjectSummaries.find(subject => subject.id === activeSubjectId)?.name ?? ''}`}
            </h2>
            <p className="text-xs text-[color:var(--muted)]">
              {activeSubjectId === 'all'
                ? 'แต่ละไฟล์จะแสดงอยู่ใต้ชื่อวิชาที่เป็นเจ้าของไฟล์'
                : ''}
            </p>
          </div>

          <div className="mb-4 rounded-2xl border p-3 shadow-sm" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <input
                  value={searchText}
                  onChange={event => setSearchText(event.target.value)}
                  placeholder="ค้นหาชื่อไฟล์..."
                  className="w-full rounded-xl border py-2.5 pl-9 pr-3 text-sm text-[color:var(--text)] outline-none transition focus:border-[color:var(--accent)]"
                  style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setSearchText('');
                  setFileTypeFilter('all');
                  setSortBy('latest');
                  setSelectedSemesterKey('all');
                  setActiveSubjectId('all');
                }}
                className="rounded-xl px-3 py-2 text-xs font-bold text-[color:var(--accent-ink)] transition hover:brightness-95"
                style={{ background: 'rgba(var(--accent-rgb),0.10)' }}
              >
                รีเซ็ต
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {[
                { value: 'all' as const, label: 'ทั้งหมด' },
                { value: 'audio' as const, label: 'ไฟล์เสียง' },
                { value: 'word' as const, label: 'เอกสาร (Word)' },
                { value: 'pdf' as const, label: 'PDF' },
                { value: 'image' as const, label: 'รูปภาพ' },
              ].map(option => {
                const active = fileTypeFilter === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setFileTypeFilter(option.value)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      active
                        ? 'border-[color:var(--accent)] bg-[color:var(--accent)] shadow-[0_6px_16px_rgba(var(--accent-rgb),0.35)]'
                        : 'border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--muted)] hover:bg-[color:var(--surface-2)]'
                    }`}
                    style={active ? { color: 'var(--on-accent)', WebkitTextFillColor: 'var(--on-accent)' } : undefined}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-3">
              <label className="mb-1 block text-xs font-semibold text-[color:var(--muted)]">จัดเรียงตาม</label>
              <select
                value={sortBy}
                onChange={event => setSortBy(event.target.value as 'latest' | 'oldest' | 'name_asc' | 'size_desc' | 'size_asc')}
                className="w-full max-w-xs rounded-xl border px-3 py-2 text-sm text-[color:var(--text)] outline-none transition focus:border-[color:var(--accent)]"
                style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
              >
                <option value="latest">ใหม่ล่าสุด</option>
                <option value="oldest">เก่าสุด</option>
                <option value="size_desc">ขนาดไฟล์ (ใหญ่-เล็ก)</option>
                <option value="size_asc">ขนาดไฟล์ (เล็ก-ใหญ่)</option>
                <option value="name_asc">ชื่อไฟล์ A-Z</option>
              </select>
            </div>
          </div>

          {loading ? (
            <div className="rounded-2xl border p-5 text-sm text-[color:var(--muted)] shadow-sm" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              กำลังโหลดไฟล์...
            </div>
          ) : visibleFiles.length > 0 ? (
            <div className="space-y-4">
              {(activeSubjectId === 'all'
                ? visibleSubjectGroups
                : [{
                    subjectId: Number(activeSubjectId),
                    subjectName: subjectSummaries.find(subject => subject.id === activeSubjectId)?.name ?? 'ไม่ทราบวิชา',
                    files: visibleFiles,
                    totalSize: visibleFiles.reduce(
                      (sum, file) => sum + (Number.isFinite(Number(file.file_size)) ? Number(file.file_size) : 0),
                      0
                    ),
                  }]
              ).map((group, groupIndex) => (
                <div key={group.subjectId} className="rounded-2xl border p-3 shadow-sm" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                  <div className="mb-3 flex items-center justify-between gap-3 border-b pb-3" style={{ borderColor: 'var(--border)' }}>
                    <div className="flex min-w-0 items-center gap-3">
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${getFolderTone(groupIndex)}`}>
                        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
                        </svg>
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-bold text-[color:var(--text)]">{group.subjectName}</h3>
                        <p className="text-[10px] text-[color:var(--muted)]">
                          {group.files.length} ไฟล์ • {formatFileSize(group.totalSize)}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {group.files.map(file => (
                      <div
                        key={file.id}
                        className="flex items-center justify-between gap-3 rounded-xl border p-3"
                        style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
                      >
                        <button
                          type="button"
                          onClick={() => void handlePreviewFile(file)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${getFileBadgeTone(file.file_type)}`}>
                            <FileTypeIcon type={file.file_type} />
                          </div>
                          <div className="min-w-0">
                            <h3 className="truncate text-xs font-bold text-[color:var(--text)]">{file.original_name}</h3>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-[color:var(--muted)]">
                              <span>{formatThaiDateTime(file.created_at)}</span>
                              <span className="h-1 w-1 rounded-full bg-slate-300" />
                              <span className="font-medium text-[color:var(--muted)]">{formatFileSize(file.file_size)}</span>
                              {activeSubjectId !== 'all' ? (
                                <>
                                  <span className="h-1 w-1 rounded-full bg-slate-300" />
                                  <span>{file.subjectName}</span>
                                </>
                              ) : null}
                              {normalizeFileStatus(file.status) === 'archived' ? (
                                <>
                                  <span className="h-1 w-1 rounded-full bg-slate-300" />
                                  <span className="font-bold text-amber-600">เก็บถาวร</span>
                                </>
                              ) : null}
                            </div>
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => void handleToggleArchiveFile(file)}
                          disabled={updatingFileStatusId === file.id}
                          className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] font-bold text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                          title={normalizeFileStatus(file.status) === 'archived' ? 'นำออกจากเก็บถาวร' : 'เก็บถาวรไฟล์'}
                        >
                          {updatingFileStatusId === file.id
                            ? 'กำลังบันทึก'
                            : normalizeFileStatus(file.status) === 'archived'
                              ? 'นำกลับ'
                              : 'เก็บ'}
                        </button>

                        <button
                          type="button"
                          onClick={() => void handleDeleteFile(file.id, file.original_name)}
                          disabled={deletingFileId === file.id}
                          className="shrink-0 rounded-lg p-2 text-slate-300 transition hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-60"
                          title="ลบไฟล์"
                        >
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M3 6h18" />
                            <path d="M8 6V4h8v2" />
                            <path d="M19 6l-1 14H6L5 6" />
                            <path d="M10 11v6" />
                            <path d="M14 11v6" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed p-6 text-center" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <svg viewBox="0 0 24 24" className="mb-2 h-8 w-8 text-slate-300" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
              </svg>
              <p className="text-xs font-medium text-[color:var(--muted)]">ไม่พบไฟล์ตามเงื่อนไขที่เลือก</p>
            </div>
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

export default StudyStoragePage;
