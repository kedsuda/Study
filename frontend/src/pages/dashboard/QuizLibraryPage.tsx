import { ModalOverlay } from '../../components/ModalOverlay';
import { useAcademicSearchParams, useSharedSemesterSelection } from '../../hooks/useAcademicSelection';
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { QuizAttemptPage } from './QuizAttemptPage';
import { QuizHistory } from '../../components/QuizHistory';
import { displayQuizAnswer } from '../../utils/quizAnswers';
import { api, apiFallbackClients } from '../../services/api';
import { useAppAlert } from '../../context/AppAlertContext';
import { useAuth } from '../../context/AuthContext';
import { useSemesterOptions } from '../../hooks/useSemesterOptions';
import { filterBySemester, toNumberOrNull } from '../../utils/semester';
import { subscribeSubjectsUpdated } from '../../utils/subjectSync';
import { downloadStudyFileBlob } from '../../utils/localStudyFiles';
import { belongsToSubject } from '../../utils/subjectFiles';

interface SubjectOption {
  id: number;
  name: string;
  semester_id?: number | null;
  semester?: number | null;
  academic_year?: number | null;
}

interface QuizQuestion {
  id: number;
  question_text: string;
  question_type: string;
  options?: string[];
  correct_answer?: string | null;
  explanation?: string | null;
}

interface Quiz {
  id: number;
  title: string;
  description?: string | null;
  subject_id: number;
  metadata?: {
    fallback_mode?: string;
    fallback_message?: string;
    fallback_reason?: string;
    [key: string]: unknown;
  } | null;
  questions?: QuizQuestion[];
  latest_attempt?: {
    score: number;
    total: number;
    percentage: number;
    answered_at: string;
  } | null;
}

const quizSourceFileName = (quiz?: Quiz | null) => {
  const fileName = quiz?.metadata?.file_name;
  return typeof fileName === 'string' && fileName.trim() !== '' ? fileName.trim() : null;
};

interface QuizSummary {
  attempt_count: number;
  attempted_quiz_count: number;
  average_score: number | null;
  latest_score: number | null;
  best_score: number | null;
  passed_count: number;
  pass_rate: number | null;
}

type Difficulty = 'easy' | 'medium' | 'hard';
type QuestionType = 'multiple_choice' | 'true_false' | 'short_answer';

type StudyFile = {
  id: number;
  subject_id?: number | string | null;
  original_name: string;
  file_path: string;
  file_url?: string | null;
  file_type: string;
  mime_type?: string | null;
  file_size?: number | null;
  created_at?: string | null;
};

type StoredStudyFile = StudyFile & {
  subject_id?: number | string | null;
  subjectId: number;
};

type StudyLogEntry = {
  id: number;
  title?: string | null;
  files?: StudyFile[];
};

type ConfirmState = {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
};

const allowedTypes = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain'
];

const allowedExtensions = ['pdf', 'doc', 'docx', 'txt'];

const isAllowedFile = (file: File) => {
  if (allowedTypes.includes(file.type)) return true;
  const ext = file.name.split('.').pop()?.toLowerCase();
  return !!ext && allowedExtensions.includes(ext);
};

const formatFileSize = (bytes: number) => {
  if (!Number.isFinite(bytes)) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const normalizeQuizDescription = (value?: string | null) => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';

  const lowered = text.toLowerCase();
  if (
    lowered.includes('สร้างแบบฝึกหัด') ||
    lowered.includes('ข้อความจริง') ||
    lowered.includes('เอกสาร') ||
    lowered.includes('readable')
  ) {
    return '';
  }

  return text;
};

const extractPdfTextInBrowser = async (file: File, onStatus: (message: string) => void) => {
  // Do not pass an HTML/error response renamed as .pdf to PDF.js.  Besides
  // producing a long stream of worker warnings, it cannot yield document text.
  const buffer = await file.arrayBuffer();
  const header = new TextDecoder('latin1').decode(new Uint8Array(buffer.slice(0, 5)));
  if (header !== '%PDF-') {
    throw new Error('ไฟล์ที่เลือกมีนามสกุล PDF แต่ข้อมูลภายในไม่ใช่ไฟล์ PDF ที่สมบูรณ์');
  }

  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerPort) {
    pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
  }

  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  try {
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
      } else {
        onStatus(`กำลังอ่านข้อความจากภาพใน PDF หน้า ${pageNumber}/${pdf.numPages}...`);
        const originalViewport = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2, 1600 / Math.max(1, originalViewport.width)) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        try {
          const canvasContext = canvas.getContext('2d', { alpha: false });
          if (!canvasContext) throw new Error('ไม่สามารถอ่านภาพจาก PDF ได้');
          await page.render({ canvas, canvasContext, viewport }).promise;
          const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.86));
          if (!blob) throw new Error('ไม่สามารถอ่านภาพจาก PDF ได้');
          const form = new FormData();
          form.append('images[]', blob, `pdf-page-${pageNumber}.jpg`);
          const response = await api.post<{ text?: string }>('/ai/analyze/document', form);
          const text = response.data.text?.trim();
          if (!text) throw new Error(`ไม่พบข้อความใน PDF หน้า ${pageNumber}`);
          pages.push(text);
        } finally {
          canvas.width = 0;
          canvas.height = 0;
        }
      }
      page.cleanup();
    }

    return pages.join('\n\n').trim();
  } finally {
    await loadingTask.destroy();
  }
};

const extractErrorMessage = (error: any, fallback: string) => {
  const errors = error?.response?.data?.errors;
  if (errors && typeof errors === 'object') {
    const messages = Object.values(errors)
      .flatMap(value => (Array.isArray(value) ? value : [value]))
      .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
      .map(value => value.trim());

    if (messages.length > 0) {
      return messages.join('\n');
    }
  }

  const message = error?.response?.data?.message;
  if (typeof message === 'string' && message.trim() !== '') {
    return message.trim();
  }

  if (typeof error?.message === 'string' && error.message.trim() !== '') {
    return error.message.trim();
  }

  return fallback;
};

const MAX_EXTRACTED_TEXT_LENGTH = 50000;

const clampExtractedText = (value: string) => {
  const text = value.trim();
  if (text.length <= MAX_EXTRACTED_TEXT_LENGTH) return text;
  return text.slice(0, MAX_EXTRACTED_TEXT_LENGTH);
};

const unwrapCollection = (payload: any) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.data)) return payload.data.data;
  if (Array.isArray(payload?.subjects)) return payload.subjects;
  if (Array.isArray(payload?.result)) return payload.result;
  return [];
};

const unwrapNestedArray = (value: any) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  return [];
};

const normalizeQuizPayload = (payload: any): Quiz | null => {
  if (!payload || typeof payload !== 'object') return null;
  return {
    ...payload,
    questions: unwrapNestedArray(payload.questions),
  };
};

const toSubjectOption = (item: any): SubjectOption | null => {
  const id = Number(item?.id ?? item?.subject_id);
  const nameCandidate = item?.name ?? item?.subject_name ?? item?.title;
  const name = typeof nameCandidate === 'string' ? nameCandidate.trim() : '';
  if (!Number.isFinite(id) || name === '') return null;

  return {
    id,
    name,
    semester_id: toNumberOrNull(item?.semester_id),
    semester: toNumberOrNull(item?.semester),
    academic_year: toNumberOrNull(item?.academic_year),
  };
};

const normalizeSubjects = (payload: any): SubjectOption[] => {
  const rows = unwrapCollection(payload);
  if (!Array.isArray(rows)) return [];
  const seen = new Set<number>();
  const normalized: SubjectOption[] = [];

  rows.forEach((item: any) => {
    const mapped = toSubjectOption(item);
    if (!mapped || seen.has(mapped.id)) return;
    seen.add(mapped.id);
    normalized.push(mapped);
  });

  return normalized;
};

const WINDOWS_1252_REVERSE: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87,
  'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e,
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

const repairUtf8Mojibake = (value?: string | null) => {
  if (typeof value !== 'string' || value === '') return value ?? '';

  // อาการที่พบบ่อยเมื่อ UTF-8 ภาษาไทยถูก decode เป็น Windows-1252/Latin-1
  // เช่น "ข้อความ" กลายเป็น "à¸‚à¹‰à¸­à¸„à¸§à¸²à¸¡"
  if (!/[ÃÂà¸à¹]/.test(value)) return value;

  try {
    const bytes = Uint8Array.from(Array.from(value, char => {
      const codePoint = char.codePointAt(0) ?? 0;
      if (codePoint <= 0xff) return codePoint;
      const windows1252Byte = WINDOWS_1252_REVERSE[char];
      if (windows1252Byte !== undefined) return windows1252Byte;
      throw new Error('Character cannot be mapped back to a single byte');
    }));

    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const beforeMarkers = (value.match(/[ÃÂà¸à¹]/g) ?? []).length;
    const afterMarkers = (decoded.match(/[ÃÂà¸à¹]/g) ?? []).length;
    return afterMarkers < beforeMarkers ? decoded : value;
  } catch {
    return value;
  }
};

const stripTrailingEllipsis = (value?: string | null) => {
  if (typeof value !== 'string') return '';
  return repairUtf8Mojibake(value).replace(/\s*\.\.\.\s*$/, '').trimEnd();
};

const formatPercent = (value?: number | null) => {
  if (!Number.isFinite(value)) return '-';
  return `${Math.round(Number(value))}%`;
};

const questionTypeOptions: { value: QuestionType; label: string }[] = [
  { value: 'multiple_choice', label: 'ปรนัย' },
  { value: 'true_false', label: 'ถูก/ผิด' },
  { value: 'short_answer', label: 'อัตนัย' },
];

const difficultyOptions: { value: Difficulty; label: string }[] = [
  { value: 'easy', label: 'ง่าย' },
  { value: 'medium', label: 'ปานกลาง' },
  { value: 'hard', label: 'ยาก' },
];


export const QuizLibraryPage = () => {
  const { success, error: showError } = useAppAlert();
  const { user } = useAuth();
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [quizSummary, setQuizSummary] = useState<QuizSummary | null>(null);
  const [searchParams, setSearchParams] = useAcademicSearchParams();
  const [fileTitle, setFileTitle] = useState('');
  const [fileDifficulty, setFileDifficulty] = useState<Difficulty>('medium');
  const [fileQuestionCount, setFileQuestionCount] = useState(5);
  const [fileQuestionTypes, setFileQuestionTypes] = useState<QuestionType[]>(['multiple_choice']);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [subjectFiles, setSubjectFiles] = useState<StoredStudyFile[]>([]);
  const [selectedStoredFileId, setSelectedStoredFileId] = useState('');
  const [isLoadingSubjectFiles, setIsLoadingSubjectFiles] = useState(false);
  const [isLoadingStoredFile, setIsLoadingStoredFile] = useState(false);
  const [fileStatus, setFileStatus] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isFileSubmitting, setIsFileSubmitting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewQuiz, setPreviewQuiz] = useState<Quiz | null>(null);
  const [attemptQuizId, setAttemptQuizId] = useState<number | null>(null);
  const [historyQuizId, setHistoryQuizId] = useState<number | null>(null);
  const [deletingQuizId, setDeletingQuizId] = useState<number | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const semesterOptions = useSemesterOptions();
  const [selectedSemesterKey, setSelectedSemesterKey] = useSharedSemesterSelection(semesterOptions);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const storedFileRequestRef = useRef(0);
  const openedStoredFileRef = useRef<string | null>(null);
  const previewContentRef = useRef<HTMLDivElement | null>(null);

  const fileInfo = useMemo(() => {
    if (!selectedFile) return null;
    return `${selectedFile.name} · ${formatFileSize(selectedFile.size)}`;
  }, [selectedFile]);
  const subjectNameMap = useMemo(
    () => new Map(subjects.map(subject => [subject.id, subject.name])),
    [subjects]
  );
  const filteredSubjects = useMemo(() => filterBySemester(subjects, selectedSemesterKey), [subjects, selectedSemesterKey]);
  const requestedSubjectId = Number(searchParams.get('subject'));
  // The subject comes from the shared "ข้อมูลการเรียน" selector.  Do not
  // require its semester metadata to match again here: older subject records
  // can lack that metadata in this response, which previously made a valid
  // selected subject become null and left the exercise list empty.
  const selectedSubject = subjects.find(subject => subject.id === requestedSubjectId)?.id
    ?? null;
  const setSelectedSubject = (subjectId: number) => {
    const next = new URLSearchParams(searchParams);
    next.set('subject', String(subjectId));
    setSearchParams(next);
  };
  const attemptedQuizCount = quizSummary?.attempt_count ?? 0;
  const averageScore = quizSummary?.average_score ?? null;
  const selectedSubjectName = useMemo(
    () => (selectedSubject ? subjectNameMap.get(selectedSubject) ?? 'ยังไม่ได้เลือกวิชา' : 'ยังไม่ได้เลือกวิชา'),
    [selectedSubject, subjectNameMap]
  );
  const hasSubjects = filteredSubjects.length > 0;
  const selectedSubjectFiles = useMemo(
    () => subjectFiles.filter(file => file.subjectId === selectedSubject),
    [subjectFiles, selectedSubject]
  );
  const hasSubjectFiles = selectedSubjectFiles.length > 0;

  const fetchSubjects = async (cancelledRef?: { current: boolean }) => {
    const requestConfigs =
      user?.role === 'admin'
        ? [{ params: { include_all: 1 } }, undefined]
        : [undefined];

    for (const client of apiFallbackClients) {
      for (const config of requestConfigs) {
        try {
          const res = await client.get('/subjects', config);
          const list = normalizeSubjects(res.data);

          if (cancelledRef?.current) return;

          setSubjects(list);
          return;
        } catch {
          // try next config / client
        }
      }
    }

    if (!cancelledRef?.current) {
      setSubjects([]);
    }
  };

  useEffect(() => {
    const cancelledRef = { current: false };
    void fetchSubjects(cancelledRef);
    const unsubscribe = subscribeSubjectsUpdated(() => {
      void fetchSubjects(cancelledRef);
    });
    return () => {
      cancelledRef.current = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setQuizzes([]);
    if (!selectedSubject) return;
    api.get(`/subjects/${selectedSubject}/quizzes`).then(res => {
      if (cancelled) return;
      const payload = Array.isArray(res.data) ? res.data : res.data?.data;
      setQuizzes(Array.isArray(payload) ? payload : []);
    }).catch(() => {
      if (!cancelled) setQuizzes([]);
    });
    return () => { cancelled = true; };
  }, [selectedSubject]);

  useEffect(() => {
    storedFileRequestRef.current += 1;
    setIsLoadingStoredFile(false);
    setSubjectFiles([]);
    setSelectedFile(null);
    setFileStatus(null);
    setFileError(null);
    setIsLoadingSubjectFiles(false);
    setSelectedStoredFileId('');
    if (!selectedSubject) return;

    let cancelled = false;
    setIsLoadingSubjectFiles(true);

    const loadSubjectFiles = async () => {
      try {
        const response = await api.get(`/subjects/${selectedSubject}/files`);
        return unwrapCollection(response.data) as StudyFile[];
      } catch (error: any) {
        // Older APIs expose attachments through study logs instead.
        if (![404, 405, 501].includes(error?.response?.status)) throw error;
        const response = await api.get(`/subjects/${selectedSubject}/study-logs`);
        return (unwrapCollection(response.data) as StudyLogEntry[])
          .flatMap(log => unwrapNestedArray(log.files) as StudyFile[]);
      }
    };

    loadSubjectFiles()
      .then(rows => {
        if (cancelled) return;
        const files = rows
          .filter(file => belongsToSubject(file, selectedSubject))
          .map(file => ({ ...file, subjectId: selectedSubject }))
          .filter(file => {
            const name = typeof file.original_name === 'string' ? file.original_name : '';
            const ext = name.split('.').pop()?.toLowerCase();
            return !!ext && allowedExtensions.includes(ext);
          })
          .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime());

        setSubjectFiles(files);
      })
      .catch(error => {
        if (cancelled) return;
        setSubjectFiles([]);
        setFileError(extractErrorMessage(error, 'โหลดไฟล์ของวิชาที่เลือกไม่สำเร็จ กรุณาลองใหม่'));
      })
      .finally(() => {
        if (!cancelled) setIsLoadingSubjectFiles(false);
      });

    return () => {
      cancelled = true;
      storedFileRequestRef.current += 1;
    };
  }, [selectedSubject]);

  const fetchQuizSummary = async () => {
    try {
      const res = await api.get<QuizSummary>('/quizzes/summary');
      setQuizSummary(res.data);
    } catch {
      setQuizSummary(null);
    }
  };

  useEffect(() => {
    void fetchQuizSummary();
  }, []);

  useEffect(() => {
    if (!previewOpen && attemptQuizId === null) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (attemptQuizId !== null) {
        setAttemptQuizId(null);
        return;
      }
      setPreviewOpen(false);
      setPreviewQuiz(null);
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [attemptQuizId, previewOpen]);

  useEffect(() => {
    if (!previewOpen) return;

    const frame = window.requestAnimationFrame(() => {
      previewContentRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [previewOpen, previewQuiz?.id]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    storedFileRequestRef.current += 1;
    setIsLoadingStoredFile(false);
    setSelectedStoredFileId('');
    if (!isAllowedFile(file)) {
      setFileError('รองรับเฉพาะไฟล์ PDF, DOC, DOCX หรือ TXT เท่านั้น');
      setFileStatus(null);
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
    setSelectedStoredFileId('');
    setFileError(null);
    setFileStatus(`เลือกไฟล์แล้ว: ${file.name}`);
    event.target.value = '';
  };

  const toggleQuestionType = (type: QuestionType) => {
    setFileQuestionTypes(prev => {
      if (prev.includes(type)) {
        return prev.length > 1 ? prev.filter(item => item !== type) : prev;
      }
      return [...prev, type];
    });
  };

  const selectStoredFile = async (fileId: string) => {
    const requestId = ++storedFileRequestRef.current;
    setSelectedStoredFileId(fileId);
    setSelectedFile(null);
    setFileStatus(null);
    setFileError(null);
    setIsLoadingStoredFile(false);
    if (!fileId) return;

    const storedFile = selectedSubjectFiles.find(file => String(file.id) === fileId);
    if (!storedFile) return;

    setIsLoadingStoredFile(true);
    setFileError(null);
    setFileStatus(`กำลังดึงไฟล์จากกระเป๋า: ${storedFile.original_name}`);

    try {
      const downloadedBlob = storedFile.file_path?.startsWith('supabase:')
        ? await downloadStudyFileBlob(storedFile.file_path)
        : null;

      // Read locally stored attachments through Laravel rather than its public
      // `/storage` link.  The link can be absent or stale on shared hosting,
      // in which case Apache returns index.html with a successful status.
      const blob = downloadedBlob ?? (await api.get(`/files/${storedFile.id}/download`, {
        responseType: 'blob',
      })).data as Blob;

      if (!blob) {
        throw new Error('ไม่สามารถดาวน์โหลดไฟล์จากกระเป๋าได้');
      }

      // A missing storage URL is commonly rewritten to the SPA's index.html.
      // Its filename still ends in .pdf/.docx, so without this guard the
      // server extracts `<!doctype html>` and creates unrelated questions.
      const header = new TextDecoder('latin1').decode(new Uint8Array(await blob.slice(0, 512).arrayBuffer())).trimStart().toLowerCase();
      if (header.startsWith('<!doctype html') || header.startsWith('<html') || header.includes('<head')) {
        throw new Error('ดาวน์โหลดไฟล์ต้นฉบับไม่สำเร็จ ระบบได้รับหน้าเว็บแทนเอกสาร กรุณาลองใหม่หรืออัปโหลดไฟล์จากเครื่อง');
      }

      const file = new File([blob], storedFile.original_name, {
        type: storedFile.mime_type || blob.type || 'application/octet-stream',
      });

      if (!isAllowedFile(file)) {
        throw new Error('ไฟล์ในกระเป๋ารายการนี้ไม่ใช่ PDF, DOC, DOCX หรือ TXT');
      }

      if (requestId !== storedFileRequestRef.current) return;
      setSelectedFile(file);
      setFileStatus(`เลือกไฟล์จากกระเป๋าแล้ว: ${storedFile.original_name}`);
    } catch (error) {
      if (requestId !== storedFileRequestRef.current) return;
      setSelectedFile(null);
      setSelectedStoredFileId('');
      const message = extractErrorMessage(error, 'ไม่สามารถดึงไฟล์จากกระเป๋าได้');
      setFileError(/failed to fetch|fetch failed|network|load failed/i.test(message)
        ? 'เชื่อมต่อที่เก็บไฟล์ไม่ได้ กรุณาลองใหม่ภายหลัง หรือเลือกอัปโหลดไฟล์ต้นฉบับจากเครื่อง'
        : message);
      setFileStatus(null);
    } finally {
      if (requestId === storedFileRequestRef.current) setIsLoadingStoredFile(false);
    }
  };

  const handleStoredFileSelect = (event: ChangeEvent<HTMLSelectElement>) => {
    void selectStoredFile(event.target.value);
  };

  // The storage page sends the chosen document here as ?subject=…&file=… .
  // Load it only once so re-renders do not download the same file repeatedly.
  useEffect(() => {
    const fileId = searchParams.get('file');
    if (!fileId || !selectedSubject || openedStoredFileRef.current === fileId) return;
    if (!selectedSubjectFiles.some(file => String(file.id) === fileId)) return;

    openedStoredFileRef.current = fileId;
    void selectStoredFile(fileId);
  }, [searchParams, selectedSubject, selectedSubjectFiles]);

  const handleFileSubmit = async (event?: FormEvent) => {
    event?.preventDefault();

    if (!selectedSubject) {
      setFileError('กรุณาเลือกวิชาที่ต้องการสร้างแบบฝึกหัดจากเอกสาร');
      setFileStatus(null);
      return;
    }

    if (!selectedFile) {
      setFileError('กรุณาเลือกไฟล์เอกสารก่อนสร้างแบบฝึกหัดจากเอกสาร');
      setFileStatus(null);
      return;
    }

    if (!isAllowedFile(selectedFile)) {
      setFileError('รองรับเฉพาะไฟล์ PDF, DOC, DOCX หรือ TXT เท่านั้น');
      setFileStatus(null);
      return;
    }

    const normalizedQuestionCount = Math.min(50, Math.max(3, Number(fileQuestionCount) || 5));
    if (normalizedQuestionCount !== fileQuestionCount) {
      setFileQuestionCount(normalizedQuestionCount);
    }

    if (fileQuestionTypes.length === 0) {
      setFileError('กรุณาเลือกชนิดคำถามอย่างน้อย 1 ชนิด');
      setFileStatus(null);
      return;
    }

    setIsFileSubmitting(true);
    setFileError(null);
    setFileStatus('กำลังเตรียมไฟล์และสร้างแบบฝึกหัดจากเอกสาร...');

    let pdfExtractionError = '';
    try {
      const formData = new FormData();
      if (selectedStoredFileId) {
        formData.append('file_id', selectedStoredFileId);
      } else {
        formData.append('file', selectedFile, selectedFile.name);
      }

      const trimmedTitle = fileTitle.trim();
      if (trimmedTitle) {
        formData.append('title', trimmedTitle);
      }

      formData.append('difficulty', fileDifficulty);
      formData.append('question_count', String(normalizedQuestionCount));

      fileQuestionTypes.forEach(type => {
        formData.append('question_types[]', type);
      });

      const fileExtension = selectedFile.name.split('.').pop()?.toLowerCase();
      if (fileExtension === 'pdf') {
        setFileStatus('กำลังอ่านข้อความจาก PDF...');

        try {
          const extractedText = await extractPdfTextInBrowser(selectedFile, setFileStatus);
          const safeExtractedText = clampExtractedText(repairUtf8Mojibake(extractedText));

          if (safeExtractedText) {
            formData.append('extracted_text', safeExtractedText);
            setFileStatus(
              extractedText.length > MAX_EXTRACTED_TEXT_LENGTH
                ? 'อ่านข้อความ PDF สำเร็จ และย่อเนื้อหาให้อยู่ในขนาดที่ระบบรองรับ กำลังสร้างแบบฝึกหัด...'
                : 'อ่านข้อความ PDF สำเร็จ กำลังสร้างแบบฝึกหัด...'
            );
          } else {
            setFileStatus('ไม่พบข้อความที่เลือกคัดลอกได้ใน PDF กำลังส่งไฟล์ให้ระบบตรวจสอบต่อ...');
          }
        } catch (pdfError) {
          console.warn('PDF text extraction failed; continuing with the original file.', pdfError);
          pdfExtractionError = extractErrorMessage(pdfError, 'ไม่สามารถอ่านข้อความจาก PDF ได้');
          setFileStatus(
            /ไม่ใช่ไฟล์ PDF ที่สมบูรณ์/.test(pdfExtractionError)
              ? 'ไฟล์ในกระเป๋ามีนามสกุล PDF แต่ข้อมูลไฟล์ไม่สมบูรณ์ ระบบจะสร้างแบบฝึกหัดเบื้องต้นแทน'
              : 'ไม่สามารถอ่านข้อความ PDF ในเบราว์เซอร์ได้ กำลังส่งไฟล์ต้นฉบับให้ระบบตรวจสอบต่อ...'
          );
        }
      }

      // ไม่กำหนด Content-Type เอง เพื่อให้ browser/Axios ใส่ multipart boundary ให้ถูกต้อง
      const response = await api.post<Quiz & { message?: string }>(
        `/subjects/${selectedSubject}/quizzes/from-file`,
        formData
      );

      const createdQuiz = normalizeQuizPayload(response.data) ?? response.data;

      if (!createdQuiz || !Number.isFinite(Number(createdQuiz.id))) {
        throw new Error('ระบบสร้างแบบฝึกหัดสำเร็จแต่ข้อมูลที่ตอบกลับไม่สมบูรณ์');
      }

      const fallbackMessage = createdQuiz.metadata?.fallback_message;
      setFileStatus(
        typeof response.data.message === 'string' && response.data.message.trim() !== ''
          ? response.data.message.trim()
          : fallbackMessage || 'สร้างแบบฝึกหัดจากเอกสารเรียบร้อยแล้ว'
      );

      setSelectedFile(null);
      setSelectedStoredFileId('');
      setFileTitle('');

      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      if (selectedSubject === createdQuiz.subject_id) {
        setQuizzes(prev => [createdQuiz, ...prev.filter(item => item.id !== createdQuiz.id)]);
      } else {
        const res = await api.get(`/subjects/${selectedSubject}/quizzes`);
        const payload = Array.isArray(res.data) ? res.data : res.data?.data;
        setQuizzes(Array.isArray(payload) ? payload : []);
      }

      void fetchQuizSummary();
      setAttemptQuizId(Number(createdQuiz.id));
    } catch (error: any) {
      const status = error?.response?.status;
      const backendData = error?.response?.data;

      console.error('Create quiz from file failed:', {
        status,
        data: backendData,
        subjectId: selectedSubject,
        fileName: selectedFile?.name,
        fileType: selectedFile?.type,
        fileSize: selectedFile?.size,
        difficulty: fileDifficulty,
        questionCount: normalizedQuestionCount,
        questionTypes: fileQuestionTypes,
      });

      const message = extractErrorMessage(
        error,
        status === 422
          ? 'ข้อมูลที่ส่งไปไม่ผ่านการตรวจสอบของระบบ กรุณาตรวจสอบไฟล์และค่าที่เลือก'
          : 'ไม่สามารถสร้างแบบฝึกหัดจากเอกสารได้'
      );

      const detail = status === 422 && pdfExtractionError
        ? `${message}\nรายละเอียดการอ่าน PDF: ${pdfExtractionError}`
        : message;
      setFileError(detail);
      setFileStatus(null);
    } finally {
      setIsFileSubmitting(false);
    }
  };

  const openPreview = async (quizId: number) => {
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await api.get(`/quizzes/${quizId}`);
      const payload = res.data?.data ?? res.data;
      setPreviewQuiz(normalizeQuizPayload(payload));
    } catch (error) {
      setPreviewError(extractErrorMessage(error, 'ไม่สามารถโหลดแบบฝึกหัดจากเอกสารได้'));
      setPreviewQuiz(null);
    } finally {
      setPreviewLoading(false);
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

  const deleteQuiz = async (quiz: Quiz) => {
    openConfirmDialog({
      title: 'ลบแบบฝึกหัด',
      description: `ต้องการลบแบบฝึกหัด "${repairUtf8Mojibake(quiz.title)}" ใช่หรือไม่?`,
      confirmLabel: 'ลบแบบฝึกหัด',
      onConfirm: async () => {
        setDeletingQuizId(quiz.id);
        setPreviewError(null);
        try {
          await api.delete(`/quizzes/${quiz.id}`);
          setQuizzes(prev => prev.filter(item => item.id !== quiz.id));
          void fetchQuizSummary();
          if (previewQuiz?.id === quiz.id) {
            setPreviewQuiz(null);
            setPreviewOpen(false);
          }
          success('ลบแบบฝึกหัดเรียบร้อยแล้ว');
        } catch (error) {
          showError(extractErrorMessage(error, 'ลบแบบฝึกหัดไม่สำเร็จ'));
        } finally {
          setDeletingQuizId(null);
        }
      },
    });
  };

  const handlePrintQuiz = () => {
    if (!previewQuiz) return;
    window.print();
  };

  return (
    <div>
      <div className="hidden print:block">
        <h1 className="text-2xl font-semibold">{repairUtf8Mojibake(previewQuiz?.title) || 'แบบฝึกหัด'}</h1>
        {normalizeQuizDescription(previewQuiz?.description) ? (
          <p className="mt-2 text-sm">{repairUtf8Mojibake(normalizeQuizDescription(previewQuiz?.description))}</p>
        ) : null}
        <ol className="mt-6 space-y-6 text-sm">
          {(previewQuiz?.questions ?? []).map((question, index) => (
            <li key={question.id} className="space-y-3">
              <p className="font-semibold">{index + 1}. {stripTrailingEllipsis(question.question_text)}</p>
              {question.question_type === 'multiple_choice' && (
                <div className="space-y-2">
                  {(question.options ?? []).map((option, optionIndex) => (
                    <div key={option} className="flex items-start gap-2">
                      <span className="mt-1 inline-block h-3 w-3 shrink-0 rounded border border-slate-400"></span>
                      <span className="shrink-0 font-semibold">{String.fromCharCode(97 + optionIndex)}.</span>
                      <span className="min-w-0 whitespace-pre-wrap break-words">{stripTrailingEllipsis(option)}</span>
                    </div>
                  ))}
                </div>
              )}
              {question.question_type === 'true_false' && (
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-3 w-3 rounded border border-slate-400"></span>
                    <span>ถูก</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-3 w-3 rounded border border-slate-400"></span>
                    <span>ผิด</span>
                  </div>
                </div>
              )}
              {question.question_type === 'short_answer' && (
                <div className="space-y-2">
                  <div className="border-b border-slate-300 pb-6"></div>
                  <div className="border-b border-slate-300 pb-6"></div>
                </div>
              )}
            </li>
          ))}
        </ol>
      </div>

      <div className="quiz-library-page px-4 pb-10 pt-4 print:hidden sm:px-0 sm:pt-0 lg:pb-0">
        <div className="w-full space-y-6">
          <section className="quiz-hero quiz-fade-in rounded-[1.75rem] p-5 shadow-soft md:p-6">
            <div className="grid gap-4 lg:grid-cols-[1.25fr,0.9fr] lg:items-end">
              <div className="space-y-3">
                <span className="quiz-hero__label">Practice Studio</span>
                <div className="space-y-2">
                  <h2 className="text-2xl font-bold leading-tight tracking-[-0.03em] md:text-4xl">
                    แบบฝึกหัดจากวิชาและเอกสารที่พร้อมทำทันที
                  </h2>
           
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-muted md:text-sm">
                  <span className="quiz-hero__chip">วิชาที่เลือก: {selectedSubjectName}</span>
                  <span className="quiz-hero__chip">แบบฝึกหัดทั้งหมด {quizzes.length} ชุด</span>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                <div className="quiz-stat p-3 md:p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted">วิชาที่พร้อมใช้</p>
                  <p className="mt-1.5 text-2xl font-bold text-[color:var(--text)]">{filteredSubjects.length}</p>
                </div>
                <div className="quiz-stat p-3 md:p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted">ทำแบบฝึกหัดแล้ว</p>
                  <p className="mt-1.5 text-2xl font-bold text-[color:var(--text)]">{attemptedQuizCount}</p>
                </div>
                <div className="quiz-stat p-3 md:p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted">คะแนนเฉลี่ย</p>
                  <p className="mt-1.5 text-2xl font-bold text-[color:var(--text)]">{formatPercent(averageScore)}</p>
                </div>
              </div>
            </div>
          </section>

          <div className="grid gap-6">
            <section className="quiz-fade-in-delayed">
              <form onSubmit={handleFileSubmit} className="space-y-6">
                <div className="grid gap-6 lg:grid-cols-2 lg:items-stretch">
                  <div className="quiz-card rounded-[2.25rem] p-6 md:p-8">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-2xl font-bold tracking-[-0.03em] text-[color:var(--text)]">ตั้งค่าแบบฝึกหัด</h3>
                   
                      </div>
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[color:var(--border)] bg-[color:rgba(var(--accent-rgb),0.08)] text-accent shadow-sm">
                        <SlidersHorizontal className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
                      </div>
                    </div>

                    <div className="mt-6 grid gap-5">
                      <div className="hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-2)] px-4 py-3 md:block">
                        <p className="text-sm text-muted">{selectedSubject ? 'แบบฝึกหัดนี้จะสร้างให้กับวิชา' : 'เลือกวิชาที่ต้องการสร้างแบบฝึกหัด'}</p>
                        <p className="mt-1 break-words text-lg font-semibold text-[color:var(--text)]">{selectedSubject ? selectedSubjectName : 'ยังไม่ได้เลือกวิชา'}</p>
                        <div className="mt-3 border-t border-[color:var(--border)] pt-3 text-sm leading-relaxed">
                          <p className="font-semibold">{selectedSubject ? 'วิธีเปลี่ยนวิชา' : 'วิธีเลือกวิชา'}</p>
                          <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted">
                            <li>เปิดเมนู <strong className="font-medium text-[color:var(--text)]">ข้อมูลการเรียน</strong> ทางซ้าย</li>
                            <li>เลือกปีการศึกษาและภาคเรียนที่ต้องการ</li>
                            <li>ที่ช่อง <strong className="font-medium text-[color:var(--text)]">รายวิชา</strong> เลือกวิชาที่ต้องการสร้างแบบฝึกหัด</li>
                          </ol>
                        </div>
                      </div>
                      <div className="grid gap-4 md:hidden">
                        <div>
                          <label className="mb-1.5 block text-sm font-semibold text-muted">ภาคเรียน</label>
                          <select
                            className="w-full rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-2)] px-4 py-3 text-sm text-[color:var(--text)] shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                            value={selectedSemesterKey}
                            onChange={event => setSelectedSemesterKey(event.target.value)}
                          >
                            {semesterOptions.map(option => (
                              <option key={option.key} value={option.key}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="mb-1.5 block text-sm font-semibold text-muted">รายวิชา</label>
                          <select
                            className="w-full rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-2)] px-4 py-3 text-sm text-[color:var(--text)] shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                            value={selectedSubject ?? ''}
                            onChange={event => setSelectedSubject(Number(event.target.value))}
                            disabled={!hasSubjects}
                          >
                            <option value="" disabled>{hasSubjects ? 'เลือกรายวิชา' : 'ไม่พบรายวิชา'}</option>
                            {filteredSubjects.map(subject => (
                              <option key={subject.id} value={subject.id}>
                                {subject.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-sm font-semibold text-muted">ชื่อแบบฝึกหัด (ทางเลือก)</label>
                        <input
                          className="w-full rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-2)] px-4 py-3 text-sm text-[color:var(--text)] shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                          value={fileTitle}
                          onChange={event => setFileTitle(event.target.value)}
                          placeholder="เช่น สรุปเนื้อหาก่อนสอบ Midterm บทที่ 1-3"
                        />
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <label className="mb-1.5 block text-sm font-semibold text-muted">ระดับความยาก</label>
                          <div className="grid w-full grid-cols-3 items-center gap-1 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-2)] p-1 shadow-sm">
                            {difficultyOptions.map(option => {
                              const isActive = fileDifficulty === option.value;
                              return (
                                <button
                                  key={option.value}
                                  type="button"
                                  onClick={() => setFileDifficulty(option.value)}
                                  className={`min-w-0 w-full whitespace-nowrap rounded-xl px-1.5 py-2 text-center text-[11px] font-semibold leading-none transition sm:px-3 sm:py-2.5 sm:text-sm ${
                                    isActive
                                      ? 'bg-accent text-[color:var(--on-accent)] shadow-sm ring-2 ring-inset ring-[color:var(--accent)]'
                                      : 'text-muted hover:bg-[color:var(--surface)] hover:text-[color:var(--text)]'
                                  }`}
                                  aria-pressed={isActive}
                                >
                                  {option.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div>
                          <label className="mb-1.5 block text-sm font-semibold text-muted">จำนวนข้อ</label>
                          <input
                            type="number"
                            min={3}
                            max={50}
                            className="w-full rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-2)] px-4 py-3 text-center text-sm font-semibold text-[color:var(--text)] shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                            value={fileQuestionCount}
                            onChange={event => setFileQuestionCount(Number(event.target.value))}
                          />
                        </div>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-sm font-semibold text-muted">ชนิดคำถาม</label>
                        <div className="grid w-full grid-cols-3 items-center gap-1 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-2)] p-1 shadow-sm">
                          {questionTypeOptions.map(option => {
                            const isActive = fileQuestionTypes.includes(option.value);
                            return (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => toggleQuestionType(option.value)}
                                className={`min-w-0 w-full rounded-xl px-2 py-2 text-center text-xs font-semibold leading-none transition sm:px-3 sm:py-2.5 sm:text-sm ${
                                  isActive
                                    ? 'bg-accent text-[color:var(--on-accent)] shadow-sm ring-2 ring-inset ring-[color:var(--accent)]'
                                    : 'text-muted hover:bg-[color:var(--surface)] hover:text-[color:var(--text)]'
                                }`}
                                aria-pressed={isActive}
                              >
                                {option.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="quiz-card rounded-[2.25rem] p-4 md:p-6">
                    <div className="h-full rounded-[2rem] border-2 border-dashed p-6 md:p-8" style={{ borderColor: 'rgba(var(--accent-rgb),0.35)', background: 'color-mix(in srgb, var(--surface-2) 88%, rgba(var(--accent-rgb),0.08))' }}>
                      <div className="flex h-full flex-col items-center justify-center text-center">
                        <div className="flex h-20 w-20 items-center justify-center rounded-[1.5rem] bg-[color:rgba(var(--accent-rgb),0.10)] text-accent shadow-soft md:h-24 md:w-24 md:rounded-[1.75rem]">
                          <svg viewBox="0 0 24 24" className="h-11 w-11" fill="none" stroke="currentColor" strokeWidth={1.8}>
                            <path
                              d="M8 18h8a4 4 0 1 0-.8-7.9 5 5 0 0 0-9.4 1.5A3.5 3.5 0 0 0 8 18Z"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </div>

                        <h4 className="mt-6 text-3xl font-black tracking-[-0.03em] text-[color:var(--text)] md:mt-7 md:text-4xl">อัปโหลดไฟล์</h4>
                        <p className="mt-3 max-w-sm text-base text-muted">
                          ลากไฟล์มาวาง หรือ{' '}
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="font-semibold text-accent underline decoration-[color:rgba(var(--accent-rgb),0.5)] underline-offset-2"
                          >
                            คลิกเพื่อเลือก
                          </button>
                          <br />
                          รองรับรูปแบบ PDF, DOCX
                        </p>

                        <div className="mt-8 flex flex-col items-center gap-2">
                          <div className="w-full max-w-sm text-left">
                            <label htmlFor="quiz-subject-file" className="mb-1.5 block text-xs font-semibold text-muted">ไฟล์จากวิชา: {selectedSubjectName}</label>
                            <select
                              id="quiz-subject-file"
                              className="w-full rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-3 text-sm text-[color:var(--text)] shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                              value={selectedStoredFileId}
                              onChange={handleStoredFileSelect}
                              disabled={!selectedSubject || isLoadingSubjectFiles || isLoadingStoredFile || !hasSubjectFiles}
                            >
                              <option value="">
                                {!selectedSubject
                                  ? 'กรุณาเลือกวิชาก่อน'
                                  : isLoadingSubjectFiles
                                  ? 'กำลังโหลดไฟล์...'
                                  : hasSubjectFiles
                                    ? 'เลือกไฟล์จากกระเป๋าเก็บไฟล์'
                                    : 'ยังไม่มีไฟล์เอกสารในวิชานี้'}
                              </option>
                              {selectedSubjectFiles.map(file => (
                                <option key={file.id} value={file.id}>
                                  {file.original_name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <input
                            ref={fileInputRef}
                            type="file"
                            accept=".pdf,.doc,.docx,.txt"
                            className="hidden"
                            onChange={handleFileChange}
                          />
                          <p className="mt-1 text-xs text-muted">ระบบจะวิเคราะห์เนื้อหาก่อนสร้างคำถามอัตโนมัติ</p>
                          {fileInfo ? (
                            <p className="mt-2 rounded-full border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-2 text-xs font-semibold text-[color:var(--text)]">
                              {fileInfo}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {fileStatus ? (
                  <div className="rounded-2xl border border-primary/20 bg-primary/10 p-4 text-sm text-primary">
                    {fileStatus}
                  </div>
                ) : null}

                {fileError ? (
                  <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-500">
                    {fileError}
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={isFileSubmitting || isLoadingStoredFile}
                  className="mb-2 inline-flex w-full items-center justify-center gap-3 rounded-[1.5rem] bg-[color:var(--accent)] px-8 py-4 text-base font-semibold text-[color:var(--on-accent)] shadow-[0_18px_40px_rgba(var(--accent-rgb),0.22)] transition hover:-translate-y-0.5 hover:shadow-glow disabled:cursor-not-allowed disabled:opacity-70 sm:mb-0"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M12 2l1.6 6.2L20 10l-6.4 1.8L12 18l-1.6-6.2L4 10l6.4-1.8L12 2Z" strokeLinejoin="round" />
                    <path d="M19 15l.9 3.5L23 20l-3.1.9L19 24l-.9-3.1L15 20l3.1-1.5L19 15Z" strokeLinejoin="round" />
                  </svg>
                  <span>
                    {isFileSubmitting
                      ? 'กำลังสร้าง...'
                      : 'สร้างแบบฝึกหัดจากเอกสาร'}
                  </span>
                </button>
              </form>
            </section>
          </div>

          <section className="space-y-4 quiz-fade-in-delayed-2" id="quiz-list" style={{ marginTop: '1rem' }}>
            <h3 className="text-2xl font-bold text-[color:var(--text)]">แบบฝึกหัดล่าสุด</h3>

            <div className="grid gap-4 md:grid-cols-2">
          {quizzes.map(quiz => (
            <article key={quiz.id} className="quiz-card rounded-[2rem] p-6 transition hover:-translate-y-1 hover:shadow-glow">
              <header>
                <p className="text-lg font-medium tracking-normal text-primary/60">
                  {subjectNameMap.get(quiz.subject_id) ?? `วิชา ${quiz.subject_id}`}
                </p>
                <h4 className="mt-2 text-lg font-semibold text-[color:var(--text)]">{repairUtf8Mojibake(quiz.title)}</h4>
                {quizSourceFileName(quiz) ? (
                  <p className="mt-2 break-all text-xs text-muted">ไฟล์ต้นทาง: {repairUtf8Mojibake(quizSourceFileName(quiz))}</p>
                ) : null}
                {normalizeQuizDescription(quiz.description) ? (
                  <p className="mt-1 text-sm text-muted">{normalizeQuizDescription(quiz.description)}</p>
                ) : null}
              </header>
              {quiz.latest_attempt ? (
                <div className="mt-4 flex items-center justify-between rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary">
                  <span>คะแนนล่าสุด: {quiz.latest_attempt.score} / {quiz.latest_attempt.total}</span>
                  <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold">
                    {quiz.latest_attempt.percentage}%
                  </span>
                </div>
              ) : (
                <p className="mt-4 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-2)] px-4 py-3 text-sm text-muted">ยังไม่ได้ทำแบบฝึกหัดนี้</p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => setHistoryQuizId(quiz.id)} className="quiz-outline-btn text-sm">ประวัติการทำข้อสอบ</button>
                <button
                  type="button"
                  onClick={() => openPreview(quiz.id)}
                  className="quiz-outline-btn inline-flex w-fit items-center text-sm"
                >
                  <span>เฉลย</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAttemptQuizId(quiz.id)}
                  className="inline-flex w-fit items-center space-x-2 rounded-full bg-[color:var(--accent)] px-4 py-2 text-sm font-medium text-[color:var(--on-accent)] shadow-soft transition hover:-translate-y-0.5 hover:shadow-glow"
                >
                  <span>ทำแบบฝึกหัด</span>
                </button>
                <button
                  type="button"
                  onClick={() => void deleteQuiz(quiz)}
                  disabled={deletingQuizId === quiz.id}
                  className="inline-flex w-fit items-center rounded-full border border-rose-400/30 bg-rose-400/10 px-4 py-2 text-sm font-medium text-rose-300 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span>{deletingQuizId === quiz.id ? 'กำลังลบ...' : 'ลบ'}</span>
                </button>
              </div>
            </article>
          ))}
          {quizzes.length === 0 && (
            <article className="quiz-card md:col-span-2 rounded-[2rem] p-12 text-center">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[color:rgba(var(--accent-rgb),0.12)] text-accent">
                <svg viewBox="0 0 24 24" className="h-9 w-9" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M8 3h6l5 5v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M14 3v5h5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M9 13h6" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M9 17h4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h4 className="mt-5 text-2xl font-bold text-[color:var(--text)]">ยังไม่มีแบบฝึกหัดล่าสุด</h4>
        
            </article>
          )}
            </div>
          </section>
        </div>
      </div>
      {previewOpen && (<ModalOverlay className="fixed inset-0 flex items-end justify-center overflow-y-auto bg-slate-950/60 px-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-6 backdrop-blur-md sm:items-center sm:px-4 sm:pb-8 sm:pt-10">
          <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-[1.75rem] border border-muted surface p-4 shadow-glow sm:rounded-3xl sm:p-6">
            <div className="flex shrink-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-primary/80 sm:text-xs sm:tracking-[0.35em]">Quiz Preview</p>
                <h3 className="mt-2 break-words text-2xl font-bold leading-tight text-[color:var(--text)] sm:text-2xl sm:font-semibold">
                  {repairUtf8Mojibake(previewQuiz?.title) || 'แบบฝึกหัด'}
                </h3>
                {normalizeQuizDescription(previewQuiz?.description) ? (
                  <p className="mt-2 text-[15px] leading-6 text-muted sm:mt-1 sm:text-sm">{repairUtf8Mojibake(normalizeQuizDescription(previewQuiz?.description))}</p>
                ) : null}
                {quizSourceFileName(previewQuiz) ? (
                  <p className="mt-2 break-all text-xs text-muted">ไฟล์ต้นทาง: {repairUtf8Mojibake(quizSourceFileName(previewQuiz))}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrintQuiz}
                  className="min-h-10 rounded-full border border-primary/20 bg-primary/10 px-4 py-2 text-xs font-bold leading-tight text-[color:var(--text)] transition hover:bg-primary/15 sm:min-h-0 sm:border-white/10 sm:bg-white/5 sm:px-3 sm:py-1 sm:font-semibold sm:hover:bg-white/10"
                >
                  พิมพ์แบบฝึกหัด
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPreviewOpen(false);
                    setPreviewQuiz(null);
                  }}
                  className="min-h-10 rounded-full border border-muted surface-2 px-4 py-2 text-xs font-bold text-muted hover:text-[color:var(--text)] sm:min-h-0 sm:px-3 sm:py-1 sm:font-semibold"
                >
                  ปิด
                </button>
              </div>
            </div>

            <div
              ref={previewContentRef}
              className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pb-1 pr-1 text-[15px] leading-6 text-muted sm:mt-5 sm:pr-2 sm:text-sm sm:leading-normal"
            >
              {previewLoading ? (
                <div className="rounded-2xl border border-muted surface-2 px-4 py-6 text-center text-[15px] text-muted sm:text-sm">
                  กำลังโหลดแบบฝึกหัดจากเอกสาร...
                </div>
              ) : previewError ? (
                <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-[15px] text-rose-500 sm:text-sm">
                  {previewError}
                </div>
              ) : previewQuiz?.questions?.length ? (
                previewQuiz.questions.map((question, index) => (
                  <div key={question.id} className="rounded-2xl border border-muted surface-2 px-4 py-4 sm:px-4 sm:py-4">
                    <p className="text-xs font-bold uppercase tracking-widest text-muted">ข้อที่ {index + 1}</p>
                    <p className="mt-2 whitespace-pre-wrap break-words text-[15px] font-bold leading-7 text-[color:var(--text)] sm:text-sm sm:font-medium sm:leading-normal">
                      {stripTrailingEllipsis(question.question_text)}
                    </p>
                    {question.question_type === 'multiple_choice' && (
                      <div className="mt-3 space-y-2.5 text-[15px] leading-6 text-muted sm:space-y-2 sm:text-sm sm:leading-normal">
                        {(question.options ?? []).map((option, optionIndex) => (
                          <div key={option} className={`flex items-start gap-2 rounded-xl p-2 ${option === question.correct_answer ? 'bg-emerald-500/10 text-emerald-600' : ''}`}>
                            <span className="shrink-0 font-semibold text-primary">{String.fromCharCode(97 + optionIndex)}.</span>
                            <span className="min-w-0 whitespace-pre-wrap break-words">
                              {stripTrailingEllipsis(option)}
                              {option === question.correct_answer && <strong className="ml-2">✓ คำตอบที่ถูกต้อง</strong>}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {question.question_type === 'true_false' && (
                      <div className="mt-3 flex items-center gap-4 text-[15px] text-muted sm:text-sm">
                        <span>ถูก</span>
                        <span>ผิด</span>
                      </div>
                    )}
                    {question.question_type === 'short_answer' && (
                      <div className="mt-3 rounded-xl border border-dashed border-muted surface px-3 py-3 text-sm text-muted sm:text-xs">
                        คำตอบแบบเขียน
                      </div>
                    )}
                    {question.correct_answer ? (
                      <div className="mt-3 rounded-xl border border-primary/25 bg-primary/10 px-3 py-3 text-sm text-primary sm:bg-primary/5 sm:py-2">
                        <p className="text-xs font-bold uppercase tracking-widest text-primary/75 sm:font-normal">คำตอบ</p>
                        <p className="mt-1 whitespace-pre-wrap break-words text-[15px] font-semibold leading-6 text-[color:var(--text)] sm:text-sm sm:font-normal sm:leading-normal">
                          {displayQuizAnswer(stripTrailingEllipsis(question.correct_answer), question.question_type)}
                        </p>
                      </div>
                    ) : null}
                    {question.explanation ? (
                      <div className="mt-2 rounded-xl border border-muted bg-white/5 px-3 py-2 text-sm text-muted sm:border-white/10 sm:text-xs">
                        {stripTrailingEllipsis(question.explanation)}
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-muted surface-2 px-4 py-6 text-center text-[15px] text-muted sm:text-sm">
                  ไม่มีคำถามในแบบฝึกหัดนี้
                </div>
              )}
            </div>
          </div>
        </ModalOverlay>)}
      {historyQuizId !== null && <ModalOverlay className="fixed inset-0 flex items-center justify-center bg-black/60 p-4">
        <div className="surface w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-3xl p-6">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h3 className="text-xl font-semibold">ประวัติการทำข้อสอบ</h3>
            <button
              type="button"
              onClick={() => setHistoryQuizId(null)}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-600 text-sm font-semibold text-white transition hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
              aria-label="ปิดประวัติการทำข้อสอบ"
            >
              ปิด
            </button>
          </div>
          <QuizHistory quizId={historyQuizId} />
        </div>
      </ModalOverlay>}
      {attemptQuizId !== null && (<ModalOverlay
          className="fixed inset-0 flex items-end justify-center bg-slate-950/60 px-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-6 backdrop-blur-md sm:items-center sm:px-4 sm:pb-8 sm:pt-10"
          role="dialog"
          aria-modal="true"
          aria-label="ทำแบบฝึกหัด"
          onMouseDown={event => {
            if (event.currentTarget === event.target) setAttemptQuizId(null);
          }}
        >
          <div className="relative max-h-full w-full max-w-6xl overflow-y-auto rounded-[1.75rem] border border-muted surface p-3 shadow-glow sm:rounded-3xl sm:p-5">
            <button
              type="button"
              onClick={() => setAttemptQuizId(null)}
              className="absolute right-4 top-4 z-30 flex h-9 w-9 items-center justify-center rounded-full border border-muted surface-2 text-lg font-semibold text-muted transition hover:text-[color:var(--text)]"
              aria-label="ปิดแบบฝึกหัด"
            >
              ×
            </button>
            <QuizAttemptPage
              quizId={attemptQuizId}
              embedded
              onClose={() => setAttemptQuizId(null)}
              onAttemptComplete={() => {
                void fetchQuizSummary();
                if (!selectedSubject) return;
                api.get(`/subjects/${selectedSubject}/quizzes`).then(res => {
                  const payload = Array.isArray(res.data) ? res.data : res.data?.data;
                  setQuizzes(Array.isArray(payload) ? payload : []);
                });
              }}
            />
          </div>
        </ModalOverlay>)}
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
