import { ModalOverlay } from '../../components/ModalOverlay';
import { useAcademicSearchParams } from '../../hooks/useAcademicSelection';
  import { useEffect, useMemo, useState } from 'react';
  import { ConfirmDialog } from '../../components/ConfirmDialog';
  import { AcademicYearSelect } from '../../components/AcademicYearSelect';
  import { WordPreview } from '../../components/WordPreview';
  import { api, assetBaseURL } from '../../services/api';
  import { useAppAlert } from '../../context/AppAlertContext';
  import { toNumberOrNull } from '../../utils/semester';
  import { resolveStudyFileUrl } from '../../utils/localStudyFiles';
  import { belongsToSubject } from '../../utils/subjectFiles';

  type SubjectOption = {
    id: number;
    name: string;
    semester_id?: number | null;
    semester?: number | null;
    academic_year?: number | null;
  };

  type SemesterOption = {
    semester_id: number;
    semester: number;
    academic_year: number;
  };

  type StudyFile = {
    id: number;
    subject_id?: number | string | null;
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

  const getFolderTone = (index: number) => {
    const tones = [
      'bg-blue-50 text-blue-600 border-blue-100',
      'bg-pink-50 text-pink-600 border-pink-100',
      'bg-emerald-50 text-emerald-600 border-emerald-100',
      'bg-amber-50 text-amber-600 border-amber-100',
      'bg-purple-50 text-purple-600 border-purple-100',
      'bg-cyan-50 text-cyan-600 border-cyan-100',
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
        return 'bg-amber-50 text-amber-500';
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

  const FileTypeIcon = ({ type, className = "h-4 w-4" }: { type: string, className?: string }) => {
    if (type === 'pdf') {
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
          <path d="M8 13h2a1.5 1.5 0 0 1 0 3H8z" />
          <path d="M14 16v-3h1a1.5 1.5 0 0 1 0 3z" />
        </svg>
      );
    }
    if (type === 'image') {
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="9" cy="9" r="1.5" />
          <path d="m21 15-4.5-4.5L5 21" />
        </svg>
      );
    }
    if (type === 'audio') {
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
          <path d="m8 13 1.5 4L12 13l2.5 4L16 13" />
        </svg>
      );
    }
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
      </svg>
    );
  };

  export const StudyStoragePage = () => {
    const [searchParams, setSearchParams] = useAcademicSearchParams();
    const { success, error } = useAppAlert();
    const [subjects, setSubjects] = useState<SubjectOption[]>([]);
    const [semesterOptions, setSemesterOptions] = useState<SemesterOption[]>([]);
    const [files, setFiles] = useState<StorageFile[]>([]);
    const requestedSubjectId = Number(searchParams.get('subject'));
    const activeSubjectId = Number.isInteger(requestedSubjectId) && requestedSubjectId > 0 ? requestedSubjectId : 'all';
    const [loading, setLoading] = useState(true);
    const [deletingFileId, setDeletingFileId] = useState<number | null>(null);
    const [preview, setPreview] = useState<PreviewState | null>(null);
    const [confirmState, setConfirmState] = useState<{ title: string; description: string; confirmLabel: string; onConfirm: () => Promise<void> | void } | null>(null);

    const [confirmBusy, setConfirmBusy] = useState(false);
    const [textPreview, setTextPreview] = useState<string>('');
    const [previewLoading, setPreviewLoading] = useState(false);
    const [searchText, setSearchText] = useState('');
    const [fileTypeFilter, setFileTypeFilter] = useState<'all' | 'audio' | 'word' | 'pdf' | 'image'>('all');
    const [sortBy, setSortBy] = useState<'latest' | 'oldest' | 'name_asc' | 'size_desc' | 'size_asc'>('latest');
    const [mobileFolderSelectionExpanded, setMobileFolderSelectionExpanded] = useState(true);
    const mobileSemester = searchParams.has('semester') ? toNumberOrNull(searchParams.get('semester')) : null;
    const mobileAcademicYear = searchParams.has('academic_year') ? toNumberOrNull(searchParams.get('academic_year')) : null;
    const updateAcademicFilter = (semester: number | null, year: number | null) => {
      const next = new URLSearchParams(searchParams);
      if (semester == null) next.delete('semester');
      else next.set('semester', String(semester));
      if (year == null) next.delete('academic_year');
      else next.set('academic_year', String(year));
      next.delete('subject');
      setSearchParams(next);
    };
    const [isSemesterMenuOpen, setIsSemesterMenuOpen] = useState(false);
    const [isSubjectMenuOpen, setIsSubjectMenuOpen] = useState(false);
    const [collapsedSubjects, setCollapsedSubjects] = useState<Record<number, boolean>>({});

    useEffect(() => {
      setSearchText('');
      setFileTypeFilter('all');
    }, [activeSubjectId]);

    useEffect(() => {
      const loadData = async () => {
        setLoading(true);
        try {
          const [subjectResponse, semesterResponse] = await Promise.all([
            api.get('/subjects'),
            api.get('/semesters'),
          ]);
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
          setSemesterOptions(
            unwrapCollection(semesterResponse.data)
              .map((item: any) => ({
                semester_id: Number(item.semester_id),
                semester: Number(item.semester),
                academic_year: Number(item.academic_year),
              }))
              .filter((item: SemesterOption) =>
                Number.isFinite(item.semester_id) &&
                Number.isFinite(item.semester) &&
                Number.isFinite(item.academic_year)
              )
              .sort((a: SemesterOption, b: SemesterOption) =>
                a.semester - b.semester || b.academic_year - a.academic_year
              )
          );

          const logResponses = await Promise.all(
            nextSubjects.map(async subject => {
              const response = await api.get(`/subjects/${subject.id}/files`);
              return unwrapCollection(response.data)
                .filter((file: StudyFile) => belongsToSubject(file, subject.id))
                .map((file: StudyFile) => ({
                  ...file,
                  subjectId: subject.id,
                  subjectName: subject.name,
                }));
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

    const filteredFiles = useMemo(
      () => {
        const year = searchParams.get('academic_year');
        const semester = searchParams.get('semester');
        const subjectIds = new Set(subjects.filter(subject =>
          (!year || subject.academic_year === Number(year)) &&
          (!semester || subject.semester === Number(semester)) &&
          (activeSubjectId === 'all' || subject.id === activeSubjectId)
        ).map(subject => subject.id));
        return files.filter(file => subjectIds.has(file.subjectId));
      },
      [activeSubjectId, files, subjects, searchParams]
    );

    const mobileSemesters = useMemo(
      () => Array.from(new Set(semesterOptions.map(option => option.semester))).sort((a, b) => a - b),
      [semesterOptions]
    );

    const mobileAcademicYears = useMemo(
      () => Array.from(new Set(semesterOptions
        .filter(option => mobileSemester == null || option.semester === mobileSemester)
        .map(option => option.academic_year)))
        .sort((a, b) => b - a),
      [mobileSemester, semesterOptions]
    );

    const mobileSubjects = useMemo(
      () => subjects.filter(subject =>
        (mobileSemester == null || subject.semester === mobileSemester) &&
        (mobileAcademicYear == null || subject.academic_year === mobileAcademicYear)
      ),
      [mobileAcademicYear, mobileSemester, subjects]
    );

    const selectMobileSubject = (value: string) => {
      const nextParams = new URLSearchParams(searchParams);
      if (value === 'all') nextParams.delete('subject');
      else nextParams.set('subject', value);
      setSearchParams(nextParams);
    };

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
        description: `คุณแน่ใจหรือไม่ว่าต้องการลบไฟล์ "${name}" อย่างถาวร?`,
        confirmLabel: 'ลบไฟล์',
        onConfirm: async () => {
          setDeletingFileId(fileId);
          try {
            await api.delete(`/files/${fileId}`);
            setFiles(prev => prev.filter(file => file.id !== fileId));
            success('ลบไฟล์เรียบร้อยแล้ว');
          } catch {
            error('ลบไฟล์ไม่สำเร็จ โปรดลองใหม่อีกครั้ง');
          } finally {
            setDeletingFileId(null);
          }
        },
      });
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
        setTextPreview('ไม่สามารถโหลดเนื้อหาจากไฟล์นี้ได้');
      } finally {
        setPreviewLoading(false);
      }
    };

    const progressWidth = Math.min((totalUsage / (1024 * 1024 * 1024)) * 100, 100);
    const isNearLimit = progressWidth > 85;

    return (
      <div className="min-h-screen bg-[var(--bg)] pb-12 font-sans text-slate-800">
        
        {/* --- PREVIEW MODAL --- */}
        {preview ? (
          <ModalOverlay className="fixed inset-0 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm transition-all duration-300">
            <div className="flex h-[85vh] w-full max-w-6xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl ring-1 ring-slate-900/5">
              {/* Modal Header */}
              <div className="flex flex-col gap-3 border-b border-slate-100 bg-white/50 px-6 py-4 backdrop-blur-md sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4 min-w-0">
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${getFileBadgeTone(preview.file.file_type)}`}>
                    <FileTypeIcon type={preview.file.file_type} className="h-6 w-6" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-bold text-slate-900">{preview.file.original_name}</h2>
                    <p className="mt-1 flex items-center gap-2 truncate text-xs font-medium text-slate-500">
                      <span className="truncate max-w-[150px] sm:max-w-xs">{preview.file.subjectName}</span>
                      <span className="h-1 w-1 rounded-full bg-slate-300" />
                      <span>{formatFileSize(preview.file.file_size)}</span>
                      <span className="h-1 w-1 rounded-full bg-slate-300" />
                      <span>{formatThaiDateTime(preview.file.created_at)}</span>
                    </p>
                  </div>
                </div>
                
                <div className="flex shrink-0 items-center justify-end gap-3">
                  <a
                    href={preview.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 rounded-xl bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-600 transition hover:bg-indigo-100 hover:text-indigo-700"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                    เปิดไฟล์เต็ม
                  </a>
                  <button
                    type="button"
                    onClick={() => setPreview(null)}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800"
                    aria-label="ปิด"
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 6 6 18" />
                      <path d="m6 6 12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Modal Content */}
              <div className="min-h-0 flex-1 overflow-hidden bg-[var(--surface-2)]">
                {preview.file.file_type === 'image' ? (
                  <div className="flex h-full items-center justify-center p-6">
                    <img src={preview.url} alt={preview.file.original_name} className="max-h-full max-w-full rounded-2xl object-contain drop-shadow-md" />
                  </div>
                ) : preview.file.file_type === 'audio' ? (
                  <div className="flex h-full flex-col items-center justify-center gap-8 p-6">
                    <div className="flex h-24 w-24 items-center justify-center rounded-full bg-amber-100 text-amber-500 shadow-inner">
                      <FileTypeIcon type={preview.file.file_type} className="h-10 w-10" />
                    </div>
                    <audio controls className="w-full max-w-md shadow-sm rounded-full">
                      <source src={preview.url} />
                    </audio>
                  </div>
                ) : preview.file.file_type === 'pdf' ? (
                  <iframe title={preview.file.original_name} src={preview.url} className="h-full w-full border-0 bg-white" />
                ) : /\.docx$/i.test(preview.file.original_name) ? (
                  <WordPreview key={`${preview.file.id}:${preview.url}`} url={preview.url} name={preview.file.original_name} />
                ) : /\.(txt)$/i.test(preview.file.original_name) ? (
                  <div className="h-full overflow-auto p-6">
                    {previewLoading ? (
                      <div className="flex h-full items-center justify-center text-sm font-medium text-slate-500">กำลังโหลดเนื้อหา...</div>
                    ) : (
                      <div className="mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
                        <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-slate-700">{textPreview || 'ไม่มีข้อความในไฟล์นี้'}</pre>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-6 p-6 text-center">
                    <div className={`flex h-24 w-24 items-center justify-center rounded-3xl ${getFileBadgeTone(preview.file.file_type)} shadow-sm`}>
                      <FileTypeIcon type={preview.file.file_type} className="h-10 w-10" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-800">ไม่สามารถแสดงตัวอย่างไฟล์นี้ได้</h3>
                      <p className="mt-2 text-sm text-slate-500">{/\.doc$/i.test(preview.file.original_name) ? 'ไฟล์ Word รุ่นเก่า (.doc) กรุณาบันทึกเป็น .docx แล้วอัปโหลดใหม่เพื่อดูตัวอย่าง หรือคลิก "เปิดไฟล์เต็ม" เพื่อดาวน์โหลด' : 'กรุณาคลิก "เปิดไฟล์เต็ม" ที่มุมขวาบนเพื่อดูหรือดาวน์โหลด'}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </ModalOverlay>
        ) : null}





  <header className="sticky top-0 z-10 border-b border-slate-200/80 bg-white/80 px-6 py-6 backdrop-blur-xl shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)]">


  <div className="mx-auto max-w-7xl flex flex-col gap-6 md:flex-row md:items-center md:justify-between">

    {/* ฝั่งซ้าย */}
  <div className="flex items-center gap-4 md:-ml-10">

    {/* ชื่อหน้า ขยับขึ้น */}
    <div className="-translate-y-2">
      <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-500">
        Study Storage
      </p>

      <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
        คลังไฟล์ของคุณ
      </h1>
    </div>





      {/* พื้นที่จัดเก็บ */}
      <div className="ml-2 hidden min-w-[240px] flex-col gap-2 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 md:flex">
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 font-semibold text-slate-700">
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4 text-indigo-500"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
            </svg>
            พื้นที่จัดเก็บ (1 GB)
          </span>

          <span
            className={`font-bold ${
              isNearLimit ? 'text-red-500' : 'text-indigo-600'
            }`}
          >
            {formatFileSize(totalUsage)}
          </span>
        </div>

        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              isNearLimit ? 'bg-red-500' : 'bg-indigo-500'
            }`}
            style={{ width: `${progressWidth}%` }}
          />
        </div>
      </div>

    <div className="hidden h-9 w-px bg-slate-200 md:block" aria-hidden="true" />

    <h2 className="hidden text-xl font-extrabold text-slate-800 md:block">
      {activeSubjectId === 'all'
        ? 'ไฟล์ทั้งหมด'
        : `ไฟล์ในวิชา: ${subjects.find(subject => subject.id === activeSubjectId)?.name ?? ''}`}
    </h2>
    </div>













  </div>
        </header>

  <main className="mt-8 w-full px-4 lg:px-6">
    <div className="w-full">

      {/* --- MAIN FILES AREA --- */}
      <div className="min-w-0">
        <section>
            <h2 className="mb-6 text-xl font-extrabold text-slate-800 md:hidden">
              {activeSubjectId === 'all'
                ? 'ไฟล์ทั้งหมด'
                : `ไฟล์ในวิชา: ${subjects.find(subject => subject.id === activeSubjectId)?.name ?? ''}`}
            </h2>

            {/* Mobile folder selection */}
            <section className="relative z-10 mb-6 overflow-visible rounded-2xl border border-slate-200 bg-white p-3 shadow-sm md:hidden" aria-label="เลือกไฟล์ตามภาคเรียน">
              <button
                type="button"
                onClick={() => setMobileFolderSelectionExpanded(expanded => !expanded)}
                aria-expanded={mobileFolderSelectionExpanded}
                aria-controls="mobile-folder-selection-fields"
                className="flex w-full items-center justify-between gap-3 rounded-xl bg-indigo-50 px-3 py-3 text-left text-sm font-bold text-slate-800"
              >
                <span className="flex items-center gap-3">
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-indigo-700" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v8A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z" />
                </svg>
                ไฟล์ทั้งหมด
                </span>
                <svg viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${mobileFolderSelectionExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>

              <div id="mobile-folder-selection-fields" hidden={!mobileFolderSelectionExpanded} className="ml-3 mt-1 space-y-3 border-l border-slate-200 py-3 pl-5">
                <label className="block">
                  <span className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <span className="text-amber-400">■</span> ภาคเรียน
                  </span>
                  <div className="relative">
                    <button
                      type="button"
                      aria-expanded={isSemesterMenuOpen}
                      aria-haspopup="listbox"
                      onClick={() => setIsSemesterMenuOpen(open => !open)}
                      className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left text-sm font-medium text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    >
                      <span>{mobileSemester == null ? 'เลือกภาคเรียน' : `ภาคเรียนที่ ${mobileSemester}`}</span>
                      <svg viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${isSemesterMenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </button>

                    {isSemesterMenuOpen && (
                      <div role="listbox" className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                        <button
                          type="button"
                          role="option"
                          aria-selected={mobileSemester == null}
                          onClick={() => {
                            updateAcademicFilter(null, null);
                            setIsSemesterMenuOpen(false);
                            setIsSubjectMenuOpen(false);
                          }}
                          className={`w-full px-3 py-2 text-left text-sm ${mobileSemester == null ? 'bg-indigo-600 font-semibold text-white' : 'text-slate-700 hover:bg-indigo-50'}`}
                        >
                          เลือกภาคเรียน
                        </button>
                        {mobileSemesters.map(semester => (
                          <button
                            key={semester}
                            type="button"
                            role="option"
                            aria-selected={mobileSemester === semester}
                            onClick={() => {
                              updateAcademicFilter(semester, null);
                              setIsSemesterMenuOpen(false);
                              setIsSubjectMenuOpen(false);
                            }}
                            className={`w-full px-3 py-2 text-left text-sm ${mobileSemester === semester ? 'bg-indigo-600 font-semibold text-white' : 'text-slate-700 hover:bg-indigo-50'}`}
                          >
                            ภาคเรียนที่ {semester}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </label>

                <div className="min-w-0">
                  <span className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <span className="text-amber-400">■</span> ปีการศึกษา
                  </span>
                  <AcademicYearSelect
                    value={mobileAcademicYear}
                    years={mobileAcademicYears}
                    disabled={mobileSemester == null}
                    onChange={year => {
                      updateAcademicFilter(mobileSemester, year);
                      setIsSubjectMenuOpen(false);
                    }}
                  />
                </div>

                <label className="block">
                  <span className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <span className="text-amber-400">■</span> รายวิชา
                  </span>
                  <div className="relative">
                    <button
                      type="button"
                      disabled={mobileSemester == null || mobileAcademicYear == null}
                      aria-expanded={isSubjectMenuOpen}
                      aria-haspopup="listbox"
                      onClick={() => setIsSubjectMenuOpen(open => !open)}
                      className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left text-sm font-medium text-slate-700 outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    >
                      <span className="min-w-0 truncate">
                        {mobileSemester == null || mobileAcademicYear == null
                          ? 'เลือกภาคเรียนและปีการศึกษาก่อน'
                          : activeSubjectId === 'all'
                            ? 'เลือกรายวิชา'
                            : mobileSubjects.find(subject => subject.id === activeSubjectId)?.name ?? 'เลือกรายวิชา'}
                      </span>
                      <svg viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${isSubjectMenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </button>

                    {isSubjectMenuOpen && (
                      <div role="listbox" className="absolute bottom-full z-30 mb-1 max-h-48 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                        <button
                          type="button"
                          role="option"
                          aria-selected={activeSubjectId === 'all'}
                          onClick={() => {
                            selectMobileSubject('all');
                            setIsSubjectMenuOpen(false);
                          }}
                          className={`w-full px-3 py-2 text-left text-sm ${activeSubjectId === 'all' ? 'bg-indigo-600 font-semibold text-white' : 'text-slate-700 hover:bg-indigo-50'}`}
                        >
                          เลือกรายวิชา
                        </button>
                        {mobileSubjects.map(subject => (
                          <button
                            key={subject.id}
                            type="button"
                            role="option"
                            aria-selected={activeSubjectId === subject.id}
                            title={subject.name}
                            onClick={() => {
                              selectMobileSubject(String(subject.id));
                              setIsSubjectMenuOpen(false);
                            }}
                            className={`block w-full truncate px-3 py-2 text-left text-sm ${activeSubjectId === subject.id ? 'bg-indigo-600 font-semibold text-white' : 'text-slate-700 hover:bg-indigo-50'}`}
                          >
                            {subject.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </label>
              </div>
            </section>






  {/* Toolbar (Search, Filter, Sort) */}
  <div className="mb-8 flex flex-col gap-4 rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_10px_30px_-18px_rgba(15,23,42,0.18)] xl:flex-row xl:items-center xl:justify-between">
    {/* Search */}
    <div className="relative flex-1 xl:max-w-lg">
      <svg
        viewBox="0 0 24 24"
        className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>

      <input
        value={searchText}
        onChange={event => setSearchText(event.target.value)}
        placeholder="ค้นหาชื่อไฟล์..."
        className="w-full rounded-2xl border border-slate-200 bg-white py-4 pl-12 pr-4 text-sm font-medium text-slate-700 placeholder:text-slate-400 outline-none shadow-sm transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
      />
    </div>

    <div className="flex flex-col gap-4 sm:flex-row sm:items-center xl:shrink-0">
      {/* Type Filters */}
  {/* Type Filters */}
  <div className="flex flex-wrap items-center gap-3">
    {[
      { value: 'all' as const, label: 'ทั้งหมด' },
      { value: 'pdf' as const, label: 'PDF' },
      { value: 'word' as const, label: 'เอกสาร' },
      { value: 'image' as const, label: 'รูปภาพ' },
      { value: 'audio' as const, label: 'เสียง' },
    ].map(option => {
      const active = fileTypeFilter === option.value;

      return (
        <button
          key={option.value}
          type="button"
          onClick={() => setFileTypeFilter(option.value)}
          className={`rounded-full px-5 py-2.5 text-sm font-semibold transition-all duration-300 ${
            active
              ? 'border border-red-400/50 bg-red-500/10 text-red-600 backdrop-blur-md shadow-[0_0_10px_rgba(239,68,68,0.20),0_0_24px_rgba(239,68,68,0.22)]'
              : 'border border-slate-200 bg-white text-slate-600 shadow-sm hover:border-red-200 hover:bg-red-50/40 hover:text-red-500'
          }`}
        >
          {option.label}
        </button>
      );
    })}
  </div>

      {/* Sort Dropdown */}
      <div className="relative shrink-0 border-t border-slate-100 pt-4 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
        <select
          value={sortBy}
          onChange={event =>
            setSortBy(
              event.target.value as 'latest' | 'oldest' | 'name_asc' | 'size_desc' | 'size_asc'
            )
          }
          className="w-full appearance-none rounded-2xl border border-slate-200 bg-white py-3 pl-4 pr-11 text-sm font-semibold text-slate-700 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 sm:min-w-[180px]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2364748b' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M8 9l4-4 4 4m0 6l-4 4-4-4'%3E%3C/path%3E%3C/svg%3E")`,
            backgroundPosition: `right 0.75rem center`,
            backgroundSize: `1.1em 1.1em`,
            backgroundRepeat: `no-repeat`,
          }}
        >
          <option value="latest">ใหม่ล่าสุด</option>
          <option value="oldest">เก่าสุด</option>
          <option value="size_desc">ขนาด (ใหญ่-เล็ก)</option>
          <option value="size_asc">ขนาด (เล็ก-ใหญ่)</option>
          <option value="name_asc">ชื่อ A-Z</option>
        </select>
      </div>
    </div>
  </div>







            {/* Files List */}
            {loading ? (
              <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white p-12 text-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-600 mb-4"></div>
                <p className="text-sm font-medium text-slate-500">กำลังโหลดไฟล์...</p>
              </div>
            ) : visibleFiles.length > 0 ? (
              <div className="space-y-6">
                {(activeSubjectId === 'all'
                  ? visibleSubjectGroups
                  : [{
                      subjectId: Number(activeSubjectId),
                      subjectName: subjects.find(subject => subject.id === activeSubjectId)?.name ?? 'ไม่ทราบวิชา',
                      files: visibleFiles,
                      totalSize: visibleFiles.reduce(
                        (sum, file) => sum + (Number.isFinite(Number(file.file_size)) ? Number(file.file_size) : 0),
                        0
                      ),
                    }]





                ).map((group) => {
  const isCollapsed = Boolean(collapsedSubjects[group.subjectId]);

  return (
    <div
      key={group.subjectId}
      className="w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <button
        type="button"
        onClick={() => setCollapsedSubjects(prev => ({ ...prev, [group.subjectId]: !prev[group.subjectId] }))}
        aria-expanded={!isCollapsed}
        className="flex w-full items-center gap-3 border-b border-slate-200 px-5 py-4 text-left"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-600">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
          </svg>
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-slate-800">
            {group.subjectName}
          </h3>
          <p className="mt-1 text-xs font-medium text-slate-500">
            {group.files.length} ไฟล์ • รวม {formatFileSize(group.totalSize)}
          </p>
        </div>

        <svg
          viewBox="0 0 24 24"
          className={`h-5 w-5 shrink-0 text-slate-500 transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {!isCollapsed && (
        <div className="p-2">
          {group.files.map(file => {
            const isArchived = normalizeFileStatus(file.status) === 'archived';

            return (
              <div
                key={file.id}
                className="group flex items-center justify-between gap-4 rounded-2xl bg-slate-50 px-4 py-3 transition hover:bg-slate-100"
              >
                <div
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-4"
                  onClick={() => void handlePreviewFile(file)}
                >
                  <div
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${getFileBadgeTone(
                      file.file_type
                    )}`}
                  >
                    <FileTypeIcon
                      type={file.file_type}
                      className="h-5 w-5"
                    />
                  </div>

                  <div className="min-w-0">
                    <h4 className="truncate text-sm font-bold text-indigo-600">
                      {file.original_name}
                    </h4>

                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
                      <span>{formatFileSize(file.file_size)}</span>
                      <span className="h-1 w-1 rounded-full bg-slate-300" />
                      <span>{formatThaiDateTime(file.created_at)}</span>

                      {isArchived && (
                        <>
                          <span className="h-1 w-1 rounded-full bg-slate-300" />
                          <span className="rounded-md bg-amber-50 px-2 py-0.5 font-bold text-amber-600">
                            สรุปแล้ว
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handlePreviewFile(file)}
                    className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 shadow-sm transition hover:border-indigo-200 hover:text-indigo-600"
                  >
                    เปิดดู
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      void handleDeleteFile(file.id, file.original_name)
                    }
                    disabled={deletingFileId === file.id}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                    title="ลบไฟล์"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M3 6h18" />
                      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
})}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white py-20 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-50">
                  <svg viewBox="0 0 24 24" className="h-8 w-8 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 22h14a2 2 0 0 0 2-2V7.5L14.5 2H6a2 2 0 0 0-2 2v4" />
                    <polyline points="14 2 14 8 20 8" />
                    <path d="m3 15 2 2 4-4" />
                  </svg>
                </div>
                <h3 className="text-base font-bold text-slate-800">ไม่พบไฟล์ที่ค้นหา</h3>
                <p className="mt-1 text-sm text-slate-500">ลองเปลี่ยนเงื่อนไขการกรองหรือคำค้นหาใหม่</p>
              </div>
            )}
        </section>
      </div>
    </div>
  </main>

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
