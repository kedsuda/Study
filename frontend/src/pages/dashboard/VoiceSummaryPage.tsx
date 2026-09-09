import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format, isValid, parseISO } from 'date-fns';
import { th } from 'date-fns/locale';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { api } from '../../services/api';
import { getLastSubjectKey } from '../../constants/storage';
import { aiApi } from "../../services/aiApi";
import { useAuth } from '../../context/AuthContext';
import { useDefaultSemesterSelection, useSemesterOptions } from '../../hooks/useSemesterOptions';
import { filterBySemester, toNumberOrNull } from '../../utils/semester';
import { subscribeSubjectsUpdated } from '../../utils/subjectSync';

type VoiceSummaryResponse = {
  transcript?: string;
  summary?: string;
  analysis?: string;
};

type ResultBucket = {
  source: Exclude<ProcessingSource, null>;
  data: VoiceSummaryResponse | null;
};

type SubjectOption = {
  id: number;
  name: string;
  semester_id?: number | null;
  semester?: number | null;
  academic_year?: number | null;
};

type MoodOption = {
  value: string;
  label: string;
};

type ProcessingSource = 'upload' | 'record' | null;

type SavedAudioSummary = {
  id: number;
  study_log_id?: number | null;
  summary: string;
  transcript?: string;
  created_at?: string;
  title?: string;
  subject?: string;
  source_mode?: 'upload' | 'record' | null;
};

type VoiceSummaryPageProps = {
  embedded?: boolean;
  initialSection?: 'upload' | 'record';
  summaryPeriod?: SummaryPeriod;
  onSummaryPeriodChange?: (period: SummaryPeriod) => void;
  onSummaryReady?: (payload: {
    summary: string;
    transcript?: string;
    source: Exclude<ProcessingSource, null>;
  }) => void;
};

type ConfirmState = {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
};

const voiceSummaryListEndpoint = '/ai/summaries/audio';
const voiceSummaryPeriodStorageKey = 'slt::voice-summary-period';
const summaryPeriodOptions = [
  { value: 'daily', label: 'รายวัน' },
  { value: 'weekly', label: 'รายสัปดาห์' },
  { value: 'monthly', label: 'รายเดือน' },
] as const;
const moodOptions: MoodOption[] = [
  { value: 'สนุก', label: 'สนุก' },
  { value: 'เฉย ๆ', label: 'เฉย ๆ' },
  { value: 'เครียด', label: 'เครียด' },
];
type SummaryPeriod = (typeof summaryPeriodOptions)[number]['value'];
const LARGE_UPLOAD_THRESHOLD_BYTES = 8 * 1024 * 1024; // 8MB
const DIRECT_AUDIO_UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024;
const RECORDING_TIMESLICE_MS = 1000;

const formatTimer = (value: number) => {
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const formatFileSize = (bytes: number) => {
  if (bytes <= 0) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
};

const extensionFromMimeType = (mimeType?: string) => {
  const normalized = (mimeType ?? '').toLowerCase();
  if (normalized.includes('ogg')) return 'ogg';
  if (normalized.includes('mp4')) return 'm4a';
  if (normalized.includes('mpeg')) return 'mp3';
  if (normalized.includes('wav')) return 'wav';
  return 'webm';
};

const formatSummaryTime = (value?: string) => {
  if (!value) return '';
  const parsed = parseISO(value);
  if (!isValid(parsed)) return value;
  return format(parsed, 'd MMM yyyy HH:mm', { locale: th });
};

const toSingleLine = (value: string) => value.replace(/\s+/g, ' ').trim();
const truncateText = (value: string, max = 160) => {
  const normalized = toSingleLine(value);
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 3))}...`;
};
const splitTranscriptSegments = (value: string) => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const roughSegments = normalized
    .split(/(?<=[.!?。])\s+|\n+/g)
    .map(item => item.trim())
    .filter(Boolean);

  const segments = roughSegments.length > 1
    ? roughSegments
    : normalized
        .split(/(?:ครับ|ค่ะ|นะครับ|นะคะ|แล้วก็|จากนั้น|ต่อมา|เพราะฉะนั้น|ดังนั้น)/g)
        .map(item => item.trim())
        .filter(Boolean);

  return segments
    .map(item => item.replace(/\s+/g, ' ').trim())
    .filter(item => item.length >= 12);
};

const makeAudioArchiveKey = (title?: string | null, summary?: string | null, transcript?: string | null) =>
  `${(title ?? 'สรุปจากเสียง').trim()}::${((summary ?? '').trim() || (transcript ?? '').trim())}`;

const uniqueLatestSegments = (segments: string[], limit: number) => {
  const seen = new Set<string>();
  const latest: string[] = [];

  for (let index = segments.length - 1; index >= 0 && latest.length < limit; index -= 1) {
    const segment = segments[index];
    const key = segment.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 80);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    latest.unshift(segment);
  }

  return latest;
};

const buildDocumentStyleSummaryFallback = (value: string) => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  const segments = splitTranscriptSegments(normalized);
  const overviewSegments = segments.slice(0, 2);
  const latestSegments = uniqueLatestSegments(segments, 5);
  if (!segments.length) return normalized.slice(0, 260);

  return [
    'สรุปภาพรวม:',
    overviewSegments.length ? overviewSegments.join(' ') : normalized.slice(0, 220),
    '',
    'ใจความสำคัญล่าสุด:',
    ...latestSegments.map(segment => `- ${segment}`),
  ].join('\n');
};

const isGooglePayloadLimitError = (message?: string | null) => {
  const value = (message ?? '').toLowerCase();
  if (!value) return false;
  return (
    value.includes('payload size exceeds the limit') ||
    value.includes('10485760') ||
    value.includes('google speech request failed (400)')
  );
};

const isGoogleMonoChannelError = (message?: string | null) => {
  const value = (message ?? '').toLowerCase();
  if (!value) return false;
  return (
    value.includes('single channel (mono)') ||
    value.includes('wav header indicates') ||
    value.includes('2 channels')
  );
};

const isLowConfidenceTranscriptError = (message?: string | null) => {
  const value = (message ?? '').toLowerCase();
  if (!value) return false;
  return (
    value.includes('low-confidence') ||
    value.includes('ไม่สามารถถอดเสียง') ||
    value.includes('returned an empty transcript') ||
    value.includes('ถอดเสียงจากไฟล์ไม่สำเร็จ')
  );
};

const encodeWavChunk = (audioBuffer: AudioBuffer, startSample: number, endSample: number) => {
  const channels = 1;
  const sampleRate = audioBuffer.sampleRate;
  const frameCount = endSample - startSample;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = frameCount * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = startSample; i < endSample; i += 1) {
    let mixed = 0;
    const sourceChannels = audioBuffer.numberOfChannels;
    for (let channel = 0; channel < sourceChannels; channel += 1) {
      mixed += audioBuffer.getChannelData(channel)[i] ?? 0;
    }
    const sample = mixed / Math.max(1, sourceChannels);
    const clamped = Math.max(-1, Math.min(1, sample));
    const intSample = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(offset, intSample, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
};

type ExpandableTextProps = {
  text: string;
  previewChars?: number;
  className?: string;
  buttonClassName?: string;
  emptyText?: string;
};

const ExpandableText = ({
  text,
  className = '',
  emptyText = '-',
}: ExpandableTextProps) => {
  const normalizedText = text?.trim() ?? '';

  return <p className={className}>{normalizedText || emptyText}</p>;
};

export const VoiceSummaryPage = ({
  embedded = false,
  initialSection,
  summaryPeriod: controlledSummaryPeriod,
  onSummaryPeriodChange,
  onSummaryReady,
}: VoiceSummaryPageProps) => {
  const { user } = useAuth();
  const [isRecording, setIsRecording] = useState(false);
  const [timer, setTimer] = useState(0);
  const [statusText, setStatusText] = useState('อัปโหลดไฟล์เสียงที่บันทึกไว้ หรือกดอัดใหม่เพื่อเริ่มสรุป');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<VoiceSummaryResponse | null>(null);
  const [recordResult, setRecordResult] = useState<VoiceSummaryResponse | null>(null);
  const [isRecorderSupported, setIsRecorderSupported] = useState(true);
  const [isLiveRecognitionSupported, setIsLiveRecognitionSupported] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [processingSource, setProcessingSource] = useState<ProcessingSource>(null);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [recordedBytes, setRecordedBytes] = useState(0);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [selectedSemesterKey, setSelectedSemesterKey] = useState('all');
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [analysisType, setAnalysisType] = useState<'summary' | 'career'>('summary');
  const [selectedMood, setSelectedMood] = useState('');
  const [summaryPeriod, setSummaryPeriod] = useState<SummaryPeriod>(() => {
    const saved = localStorage.getItem(voiceSummaryPeriodStorageKey);
    return summaryPeriodOptions.some(option => option.value === saved) ? saved as SummaryPeriod : 'daily';
  });
  const activeSummaryPeriod = controlledSummaryPeriod ?? summaryPeriod;
  

const [isMoodDropdownOpen, setIsMoodDropdownOpen] = useState(false);
  const moodDropdownRef = useRef<HTMLDivElement | null>(null);



  const [savedSummaries, setSavedSummaries] = useState<SavedAudioSummary[]>([]);
  const [archivedSummaryKeys, setArchivedSummaryKeys] = useState<Set<string>>(() => new Set());
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [deletingSummaryId, setDeletingSummaryId] = useState<number | null>(null);
  const [archivingSummaryId, setArchivingSummaryId] = useState<number | null>(null);
  const [isDarkTheme, setIsDarkTheme] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const lastSubjectKey = useMemo(() => getLastSubjectKey(user?.id), [user?.id]);
  const semesterOptions = useSemesterOptions();
  useDefaultSemesterSelection(semesterOptions, selectedSemesterKey, setSelectedSemesterKey);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const speechRecognitionRef = useRef<any>(null);
  const timerRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordedBytesRef = useRef(0);
  const recorderMimeTypeRef = useRef('audio/webm');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const liveTranscriptRef = useRef('');
  const committedSpeechTranscriptRef = useRef('');

  const filteredSubjects = useMemo(() => filterBySemester(subjects, selectedSemesterKey), [subjects, selectedSemesterKey]);
  const selectableSubjects = useMemo(
    () => (filteredSubjects.length > 0 ? filteredSubjects : subjects),
    [filteredSubjects, subjects]
  );
  const uploadedSummaries = useMemo(
    () => savedSummaries.filter(item => (item.source_mode ?? 'upload') !== 'record'),
    [savedSummaries]
  );
  const recordedSummaries = useMemo(
    () => savedSummaries.filter(item => item.source_mode === 'record'),
    [savedSummaries]
  );

  useEffect(() => {
    const supported =
      typeof window !== 'undefined' &&
      typeof window.MediaRecorder !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia;
    const speechRecognitionCtor =
      typeof window !== 'undefined'
        ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
        : null;
    setIsRecorderSupported(supported);
    setIsLiveRecognitionSupported(Boolean(speechRecognitionCtor));
    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
      }
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
        mediaRecorderRef.current = null;
      }
      if (speechRecognitionRef.current) {
        try {
          speechRecognitionRef.current.stop();
        } catch {
          // ignore
        }
        speechRecognitionRef.current = null;
      }
    };
  }, []);





useEffect(() => {
    if (!isMoodDropdownOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (moodDropdownRef.current?.contains(event.target as Node)) return;
      setIsMoodDropdownOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isMoodDropdownOpen]);




  useEffect(() => {
    if (typeof window === 'undefined' || !window.location.hash) return;
    const targetId = window.location.hash.replace(/^#/, '');
    const target = document.getElementById(targetId);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  useEffect(() => {
    if (!embedded || !initialSection) return;
    const target = document.getElementById(initialSection);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [embedded, initialSection]);

  const cardClass = embedded
    ? 'rounded-3xl border bg-[color:var(--surface)]/92 p-5 shadow-xl backdrop-blur-2xl'
    : 'doc-summary-card rounded-[30px] border border-[color:var(--border)] bg-[color:var(--surface)]/95 p-6 shadow-[0_16px_34px_rgba(15,23,42,0.10)] backdrop-blur-xl';
  const shellClass = embedded
    ? 'rounded-3xl border bg-[color:var(--surface)]/92 shadow-xl backdrop-blur-2xl'
    : 'doc-summary-card rounded-[30px] border border-[color:var(--border)] bg-[color:var(--surface)]/95 shadow-[0_16px_34px_rgba(15,23,42,0.10)] backdrop-blur-xl';
  const activeClass = embedded
    ? 'border-[color:rgba(var(--accent-rgb),0.35)] ring-2 ring-[color:rgba(var(--accent-rgb),0.15)]'
    : 'border-[color:rgba(var(--accent-rgb),0.35)] ring-2 ring-[color:rgba(var(--accent-rgb),0.15)]';
  const fieldClass = embedded
    ? 'w-full appearance-none rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] px-4 py-3 text-sm font-semibold text-[color:var(--text)] shadow-sm outline-none transition focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:rgba(var(--accent-rgb),0.25)]'
    : 'w-full rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface-2)] px-4 py-3 text-sm font-semibold text-[color:var(--text)] shadow-sm outline-none transition focus:border-[color:var(--accent)] focus:ring-4 focus:ring-[color:rgba(var(--accent-rgb),0.12)]';
  const showUploadSection = !embedded || initialSection !== 'record';
  const showRecordSection = !embedded || initialSection !== 'upload';

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const syncTheme = () => {
      const dark =
        document.documentElement.classList.contains('theme-dark') ||
        document.body.classList.contains('theme-dark');
      setIsDarkTheme(dark);
    };

    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  const leftPanelLayoutClass = embedded
    ? 'grid gap-6'
    : 'space-y-6';
  const mainLayoutClass = embedded
    ? 'grid gap-6'
    : 'grid gap-6';

  const fetchSubjects = async () => {
    try {
      const res = await api.get('/subjects');
      const payload = Array.isArray(res.data) ? res.data : res.data?.data;
      const list = Array.isArray(payload)
        ? payload.map((item: any) => ({
            id: item.id,
            name: item.name,
            semester_id: toNumberOrNull(item.semester_id),
            semester: toNumberOrNull(item.semester),
            academic_year: toNumberOrNull(item.academic_year),
          }))
        : [];
      setSubjects(list);

      const storedId = localStorage.getItem(lastSubjectKey);
      if (storedId && list.some(subject => String(subject.id) === storedId)) {
        setSelectedSubjectId(storedId);
        return;
      }

      if (list[0]?.id) {
        const fallbackId = String(list[0].id);
        setSelectedSubjectId(fallbackId);
        localStorage.setItem(lastSubjectKey, fallbackId);
        return;
      }

      setSelectedSubjectId('');
      localStorage.removeItem(lastSubjectKey);
    } catch (err) {
      setSubjects([]);
      setSelectedSubjectId('');
      localStorage.removeItem(lastSubjectKey);
    }
  };

  useEffect(() => {
    void fetchSubjects();
    return subscribeSubjectsUpdated(() => {
      void fetchSubjects();
    });
  }, [lastSubjectKey]);

  useEffect(() => {
    localStorage.setItem(voiceSummaryPeriodStorageKey, activeSummaryPeriod);
  }, [activeSummaryPeriod]);

  useEffect(() => {
    if (selectedSubjectId && selectableSubjects.some(subject => String(subject.id) === selectedSubjectId)) return;
    const fallback = selectableSubjects[0];
    if (!fallback) {
      setSelectedSubjectId('');
      return;
    }
    const fallbackId = String(fallback.id);
    setSelectedSubjectId(fallbackId);
    localStorage.setItem(lastSubjectKey, fallbackId);
  }, [selectableSubjects, lastSubjectKey, selectedSubjectId]);

  const fetchSavedSummaries = useCallback(async (subjectId?: string) => {
    setSavedLoading(true);
    setSavedError(null);
    try {
      const res = await api.get(voiceSummaryListEndpoint, {
        params: subjectId ? { subject_id: subjectId } : undefined,
      });
      const payload = Array.isArray(res.data) ? res.data : res.data?.data;
      const remote = Array.isArray(payload) ? (payload as SavedAudioSummary[]) : [];

      setSavedSummaries(remote.slice(0, 30));
    } catch (err: any) {
      setSavedError(err.response?.data?.message ?? 'โหลดสรุปจากเสียงไม่สำเร็จ');
    } finally {
      setSavedLoading(false);
    }
  }, []);

  const saveBrowserAudioSummary = async (
    result: VoiceSummaryResponse,
    source: Exclude<ProcessingSource, null>,
    title?: string | null
  ) => {
    if (!selectedSubjectId || analysisType === 'career') return null;

    const summary = String(result.summary ?? result.analysis ?? '').trim();
    const transcript = String(result.transcript ?? '').trim();
    if (!summary && !transcript) return null;

    try {
      const response = await api.post<SavedAudioSummary>('/ai/summaries/audio', {
        subject_id: selectedSubjectId,
        source_mode: source,
        title: title?.trim() || (source === 'record' ? 'สรุปจากการอัดสด' : selectedFileName || 'สรุปจากไฟล์เสียง'),
        transcript,
        summary,
        summary_period: activeSummaryPeriod,
        mood: selectedMood || null,
      });
      const saved = response.data;
      setSavedSummaries(prev => [saved, ...prev.filter(item => item.id !== saved.id)].slice(0, 30));
      return saved;
    } catch (err: any) {
      setSavedError(err.response?.data?.message ?? 'บันทึกสรุปจากเสียงไม่สำเร็จ');
      return null;
    }
  };

  useEffect(() => {
    if (!selectedSubjectId) {
      setSavedSummaries([]);
      setPendingFile(null);
      setSelectedFileName(null);
      setUploadResult(null);
      setRecordResult(null);
      return;
    }

    setSavedSummaries([]);
    setPendingFile(null);
    setSelectedFileName(null);
    setUploadResult(null);
    setRecordResult(null);
    fetchSavedSummaries(selectedSubjectId);
  }, [selectedSubjectId, fetchSavedSummaries]);

  useEffect(() => {
    if (!selectedSubjectId) {
      setArchivedSummaryKeys(new Set());
      return;
    }

    let cancelled = false;
    const loadArchivedAudioSummaries = async () => {
      try {
        const response = await api.get(`/subjects/${selectedSubjectId}/summary-archives`);
        const payload = Array.isArray(response.data) ? response.data : response.data?.data;
        const items = Array.isArray(payload) ? payload : [];
        if (cancelled) return;

        setArchivedSummaryKeys(new Set(
          items.map((item: any) => makeAudioArchiveKey(item?.name, item?.description))
        ));
      } catch {
        if (!cancelled) setArchivedSummaryKeys(new Set());
      }
    };

    void loadArchivedAudioSummaries();
    return () => {
      cancelled = true;
    };
  }, [selectedSubjectId]);

  useEffect(() => {
    if (embedded) return;
    if (!selectedSubjectId) return;
    if (isLoading || savedLoading) return;

    const syncLatestResult = (
      latest: SavedAudioSummary | undefined,
      current: VoiceSummaryResponse | null,
      setter: (value: VoiceSummaryResponse | null) => void
    ) => {
      if (!latest) return false;

      const nextSummary = latest.summary ?? '';
      const nextTranscript = latest.transcript ?? '';
      const currSummary = current?.summary ?? '';
      const currTranscript = current?.transcript ?? '';

      if (current) {
        return false;
      }

      if (nextSummary === currSummary && nextTranscript === currTranscript) {
        return false;
      }

      setter({ summary: latest.summary, transcript: latest.transcript });
      return true;
    };

    const syncedUpload = syncLatestResult(uploadedSummaries[0], uploadResult, setUploadResult);
    const syncedRecord = syncLatestResult(recordedSummaries[0], recordResult, setRecordResult);

    if (syncedUpload || syncedRecord) {
      setError(null);
      setSelectedFileName(null);
      setTimer(0);
      setStatusText('แสดงสรุปจากเสียงล่าสุดแล้ว');
    }
  }, [embedded, selectedSubjectId, isLoading, savedLoading, uploadedSummaries, recordedSummaries]);

  const triggerFileSelect = () => {
    if (isLoading) return;
    fileInputRef.current?.click();
  };

  const updateLiveTranscript = (value: string) => {
    const normalized = value.replace(/\s+/g, ' ').trim();
    liveTranscriptRef.current = normalized;
    setLiveTranscript(normalized);
  };

  const resetLiveTranscript = () => {
    liveTranscriptRef.current = '';
    committedSpeechTranscriptRef.current = '';
    setLiveTranscript('');
  };

  const pushBellNotification = async (input: { title: string; message: string }) => {
    try {
      const payload: Record<string, any> = {
        type: 'voice_summary',
        title: input.title,
        message: input.message,
        notify_at: new Date().toISOString(),
      };
      if (selectedSubjectId) {
        payload.subject_id = selectedSubjectId;
      }
      await api.post('/notifications', payload);
      window.dispatchEvent(new Event('slt:archive-refresh'));
    } catch {
      // ignore
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

  const deleteSavedSummary = async (item: SavedAudioSummary) => {
    openConfirmDialog({
      title: 'ลบสรุปจากเสียง',
      description: `ต้องการลบ "${item.title ?? 'สรุปจากเสียง'}" ใช่หรือไม่?`,
      confirmLabel: 'ลบสรุป',
      onConfirm: async () => {
        setDeletingSummaryId(item.id);
        setSavedError(null);
        try {
          if (item.id < 0) {
            setSavedSummaries(prev => prev.filter(summary => summary.id !== item.id));
          } else {
            await api.delete(`/ai/summaries/audio/${item.id}`);
            setSavedSummaries(prev => prev.filter(summary => summary.id !== item.id));
          }

          const targetSetter = item.source_mode === 'record' ? setRecordResult : setUploadResult;
          const targetResult = item.source_mode === 'record' ? recordResult : uploadResult;
          if (
            targetResult &&
            (targetResult.summary ?? '') === (item.summary ?? '') &&
            (targetResult.transcript ?? '') === (item.transcript ?? '')
          ) {
            targetSetter(null);
          }
          setStatusText('ลบสรุปจากเสียงเรียบร้อยแล้ว');
        } catch (err: any) {
          setSavedError(err.response?.data?.message ?? 'ลบสรุปจากเสียงไม่สำเร็จ');
        } finally {
          setDeletingSummaryId(null);
        }
      },
    });
  };

  const clearResult = (source: Exclude<ProcessingSource, null>) => {
    if (source === 'record') {
      setRecordResult(null);
      resetLiveTranscript();
    } else {
      setUploadResult(null);
    }
    setError(null);
    setStatusText('ล้างผลลัพธ์เรียบร้อยแล้ว');
  };

  const archiveAudioSummary = async (item: {
    id?: number | null;
    title?: string | null;
    summary?: string | null;
    transcript?: string | null;
  }) => {
    if (!selectedSubjectId) {
      setSavedError('กรุณาเลือกวิชาก่อนเก็บถาวร');
      setError('กรุณาเลือกวิชาก่อนเก็บถาวร');
      setStatusText('กรุณาเลือกวิชา ก่อนเก็บสรุปถาวร');
      return;
    }

    const content = (item.summary ?? '').trim() || (item.transcript ?? '').trim();
    if (!content) {
      setSavedError('ยังไม่มีเนื้อหาสำหรับเก็บถาวร');
      setError('ยังไม่มีเนื้อหาสำหรับเก็บถาวร');
      setStatusText('ยังไม่มีเนื้อหาสำหรับเก็บถาวร');
      return;
    }

    const archiveTitle = item.title?.trim() || 'สรุปจากเสียง';
    const archiveContentKey = makeAudioArchiveKey(archiveTitle, content);
    if (archivedSummaryKeys.has(archiveContentKey)) {
      setStatusText('สรุปจากเสียงนี้ถูกเก็บถาวรแล้ว');
      return;
    }

    const archiveKey = Number.isFinite(Number(item.id)) ? Number(item.id) : -1;
    setArchivingSummaryId(archiveKey);
    setSavedError(null);
    setError(null);
    try {
      const response = await api.post(`/subjects/${selectedSubjectId}/summary-archives`, {
        name: archiveTitle,
        description: content,
      });
      const archived = response.data?.data ?? response.data;
      if (!archived?.id) {
        throw new Error('ระบบยังไม่ยืนยันการบันทึกลงคลังเก็บถาวร');
      }
      setArchivedSummaryKeys(prev => new Set(prev).add(archiveContentKey));
      window.dispatchEvent(new Event('slt:archive-refresh'));
      setStatusText('เก็บถาวรสรุปจากเสียงเรียบร้อยแล้ว');
      if (!embedded) {
        window.location.href = '/document-summary?tab=archived';
      }
    } catch (err: any) {
      setSavedError(err.response?.data?.message ?? err.message ?? 'เก็บถาวรสรุปจากเสียงไม่สำเร็จ');
    } finally {
      setArchivingSummaryId(null);
    }
  };

  const handleFileSelected = (file: File) => {
    if (!file.type.startsWith('audio/')) {
      setError('กรุณาเลือกไฟล์เสียงเท่านั้น');
      setStatusText('ไฟล์ที่อัปโหลดไม่ใช่เสียง กรุณาลองใหม่');
      return;
    }

    if (!selectedSubjectId) {
      setError('กรุณาเลือกวิชาเพื่อบันทึกเสียงลงฐานข้อมูล');
      setStatusText('กรุณาเลือกวิชา ก่อนเริ่มสรุปเสียง');
      return;
    }

    setSelectedFileName(file.name);
    setPendingFile(file);
    setError(null);
    setUploadResult(null);
    setStatusText('ไฟล์พร้อมสรุปแล้ว กดปุ่ม “สรุปไฟล์นี้” เพื่อเริ่มประมวลผล');
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      handleFileSelected(file);
    }
    event.target.value = '';
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (isLoading) return;
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      handleFileSelected(file);
    }
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
  };

  const summarizePendingFile = () => {
    if (!pendingFile || isLoading) return;
    if (!selectedSubjectId) {
      setError('กรุณาเลือกวิชาเพื่อบันทึกเสียงลงฐานข้อมูล');
      setStatusText('กรุณาเลือกวิชา ก่อนเริ่มสรุปเสียง');
      return;
    }
    setStatusText('กำลังอัปโหลดและสรุปจากไฟล์เสียง...');
    processAudio(pendingFile, 'upload');
  };

  const toggleRecording = async () => {
    if (isRecording) {
      stopRecording();
    } else {
      await startRecording();
    }
  };

  const startRecording = async () => {
    if (!isRecorderSupported) {
      setError('เบราว์เซอร์นี้ไม่รองรับการบันทึกเสียงด้วย MediaRecorder');
      return;
    }

    if (!selectedSubjectId) {
      setError('กรุณาเลือกวิชาเพื่อบันทึกเสียงลงฐานข้อมูล');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredMimeTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/ogg',
      ];
      const supportedMimeType = preferredMimeTypes.find(type =>
        typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)
      );
      const recorder = supportedMimeType
        ? new MediaRecorder(stream, { mimeType: supportedMimeType })
        : new MediaRecorder(stream);
      const recorderMimeType = recorder.mimeType || supportedMimeType || 'audio/webm';
      const SpeechRecognitionCtor =
        (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
      chunksRef.current = [];
      recordedBytesRef.current = 0;
      recorderMimeTypeRef.current = recorderMimeType;
      setRecordedBytes(0);

      recorder.ondataavailable = event => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
          recordedBytesRef.current += event.data.size;
          setRecordedBytes(recordedBytesRef.current);
        }
      };

      recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        mediaRecorderRef.current = null;
        if (chunksRef.current.length) {
          const audioBlob = new Blob(chunksRef.current, { type: recorderMimeTypeRef.current });
          const extension = extensionFromMimeType(recorderMimeTypeRef.current);
          const recordedFile = new File([audioBlob], `recording.${extension}`, {
            type: recorderMimeTypeRef.current,
          });
          processAudio(recordedFile, 'record');
        } else {
          setStatusText('ไม่พบข้อมูลเสียงที่บันทึก กรุณาลองอัดใหม่');
        }
      };

      recorder.start(RECORDING_TIMESLICE_MS);
      mediaRecorderRef.current = recorder;
      resetLiveTranscript();
      if (SpeechRecognitionCtor) {
        try {
          const recognition = new SpeechRecognitionCtor();
          recognition.lang = 'th-TH';
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.onresult = (event: any) => {
            let committed = committedSpeechTranscriptRef.current;
            const interimParts: string[] = [];

            for (let index = event.resultIndex ?? 0; index < (event.results?.length ?? 0); index += 1) {
              const result = event.results[index];
              const transcript = String(result?.[0]?.transcript ?? '').replace(/\s+/g, ' ').trim();
              if (!transcript) continue;

              if (result.isFinal) {
                committed = [committed, transcript].filter(Boolean).join(' ');
              } else {
                interimParts.push(transcript);
              }
            }

            committed = committed.replace(/\s+/g, ' ').trim();
            committedSpeechTranscriptRef.current = committed;
            updateLiveTranscript([committed, ...interimParts].filter(Boolean).join(' '));
          };
          recognition.onerror = () => {
            setStatusText('กำลังบันทึกเสียง... (ถอดเสียงเรียลไทม์ใช้งานไม่ได้ชั่วคราว)');
          };
          recognition.onend = () => {
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
              try {
                recognition.start();
              } catch {
                // ignore restart errors
              }
            }
          };
          recognition.start();
          speechRecognitionRef.current = recognition;
        } catch {
          speechRecognitionRef.current = null;
        }
      }

      setIsRecording(true);
      setTimer(0);
      setError(null);
      setRecordResult(null);
      setSelectedFileName(null);
      setStatusText('กำลังบันทึกและถอดเสียงแบบเรียลไทม์... กดอีกครั้งเพื่อหยุดและบันทึก');

      timerRef.current = window.setInterval(() => {
        setTimer(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error(err);
      setError('ไม่สามารถเข้าถึงไมโครโฟนได้ กรุณาอนุญาตการใช้งานไมโครโฟน');
    }
  };

  const stopRecording = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.stop();
      } catch {
        // ignore
      }
      speechRecognitionRef.current = null;
    }

    setIsRecording(false);
    setStatusText('กำลังประมวลผลเสียงจากไมโครโฟน...');
  };

  const summarizeTranscriptLikeDocument = async (transcript: string) => {
    const text = transcript.trim();
    if (!text) return '';

    const formData = new FormData();
    formData.append('text', text);

    try {
      const response = await api.post('/ai/summarize/document', formData);
      const payload = response.data ?? {};
      const summary = String(payload.summary ?? payload.text ?? '').trim();
      return summary || buildDocumentStyleSummaryFallback(text);
    } catch {
      return buildDocumentStyleSummaryFallback(text);
    }
  };

  const transcribeLargeAudioByChunks = async (blob: Blob) => {
    const AudioContextCtor =
      (window as any).AudioContext ?? (window as any).webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error('เบราว์เซอร์ไม่รองรับการแบ่งไฟล์เสียงอัตโนมัติ');
    }

    const audioContext = new AudioContextCtor();
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      const targetBytesPerChunk = 4 * 1024 * 1024; // 4MB
      const bytesPerSample = 2;
      const bytesPerFrame = decoded.numberOfChannels * bytesPerSample;
      const samplesPerChunk = Math.max(
        1,
        Math.floor(targetBytesPerChunk / Math.max(1, bytesPerFrame))
      );
      const totalSamples = decoded.length;
      const totalChunks = Math.ceil(totalSamples / samplesPerChunk);

      const transcripts: string[] = [];
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
        const startSample = chunkIndex * samplesPerChunk;
        const endSample = Math.min(totalSamples, startSample + samplesPerChunk);
        const wavBlob = encodeWavChunk(decoded, startSample, endSample);

        const formData = new FormData();
        formData.append('file', wavBlob, `audio-chunk-${chunkIndex + 1}.wav`);

        setStatusText(`กำลังถอดเสียงช่วงที่ ${chunkIndex + 1}/${totalChunks}...`);
        try {
          const response = await api.post('/ai/transcribe/audio', formData);
          const text = String(response.data?.text ?? '').trim();
          if (text) transcripts.push(text);
        } catch (err: any) {
          const message =
            err?.response?.data?.message ||
            err?.response?.data?.detail ||
            err?.message ||
            '';

          if (isLowConfidenceTranscriptError(message)) {
            console.warn('voice-summary skipped low-confidence audio chunk', {
              chunk: chunkIndex + 1,
              total: totalChunks,
              message,
            });
            continue;
          }

          throw err;
        }
      }

      const mergedTranscript = transcripts.join('\n').trim();
      if (!mergedTranscript) {
        throw new Error('ถอดเสียงจากไฟล์ไม่สำเร็จ');
      }

      const docStyleSummary = await summarizeTranscriptLikeDocument(mergedTranscript);

      return {
        transcript: mergedTranscript,
        summary: docStyleSummary || buildDocumentStyleSummaryFallback(mergedTranscript),
      };
    } finally {
      try {
        await audioContext.close();
      } catch {
        // ignore
      }
    }
  };

  const processAudio = async (blob: Blob, source: ProcessingSource) => {
    setIsLoading(true);
    setProcessingSource(source);
    setError(null);
    const finishProcessing = () => {
      setIsLoading(false);
      setProcessingSource(null);
      setTimer(0);
    };
    const fallbackTranscript = source === 'record' ? liveTranscriptRef.current.trim() : '';
    if (source !== 'record') {
      resetLiveTranscript();
    }
    if (source === 'record') {
      setRecordResult(null);
    } else {
      setUploadResult(null);
    }

    if (source === 'record' && fallbackTranscript) {
      try {
        setStatusText('กำลังสรุปข้อความที่ถอดเสียงแบบเรียลไทม์...');
        const summary = await summarizeTranscriptLikeDocument(fallbackTranscript);
        const nextResult = {
          transcript: fallbackTranscript,
          summary: summary || buildDocumentStyleSummaryFallback(fallbackTranscript),
        };
        setRecordResult(nextResult);
        finishProcessing();
        void saveBrowserAudioSummary(nextResult, 'record', 'สรุปจากการอัดสด');
        onSummaryReady?.({
          summary: nextResult.summary,
          transcript: nextResult.transcript,
          source: 'record',
        });
        setStatusText('สรุปจากเสียงสดเรียบร้อยแล้ว');
        return;
      } catch {
        // Continue with audio-file processing if transcript summarization is unavailable.
      }
    }

    const formData = new FormData();
    const fileName = blob instanceof File ? blob.name : `recording.${extensionFromMimeType(blob.type)}`;
    const isCareer = analysisType === 'career';
    const shouldUseChunkMode = !isCareer && (source === 'upload' || blob.size >= LARGE_UPLOAD_THRESHOLD_BYTES);
    const canAttemptDirectUpload = blob.size < DIRECT_AUDIO_UPLOAD_LIMIT_BYTES;

    if (shouldUseChunkMode) {
      try {
        if (source === 'record' && !canAttemptDirectUpload && fallbackTranscript) {
          setStatusText('เสียงที่อัดยาวมาก ระบบกำลังสรุปจากข้อความที่ถอดสดไว้...');
          const fallbackSummary = await summarizeTranscriptLikeDocument(fallbackTranscript);
          const nextResult = {
            transcript: fallbackTranscript,
            summary: fallbackSummary || buildDocumentStyleSummaryFallback(fallbackTranscript),
          };
          setRecordResult(nextResult);
          updateLiveTranscript(fallbackTranscript);
          finishProcessing();
          void saveBrowserAudioSummary(nextResult, 'record', 'สรุปจากการอัดสด');
          onSummaryReady?.({
            summary: nextResult.summary,
            transcript: nextResult.transcript,
            source: 'record',
          });
          setStatusText('สรุปเสร็จแล้วจากข้อความที่ถอดสดไว้');
          return;
        }

        setStatusText(
          blob.size >= LARGE_UPLOAD_THRESHOLD_BYTES
            ? 'ไฟล์ขนาดใหญ่ ระบบกำลังแบ่งไฟล์และถอดเสียงอัตโนมัติ...'
            : 'ระบบกำลังแบ่งไฟล์เสียงเป็นช่วงสั้น ๆ เพื่อถอดเสียงให้เสถียรขึ้น...'
        );
        const chunked = await transcribeLargeAudioByChunks(blob);
        const nextResult = {
          transcript: chunked.transcript,
          summary: chunked.summary,
        };
        if (source === 'record') {
          setRecordResult(nextResult);
        } else {
          setUploadResult(nextResult);
        }
        setLiveTranscript(chunked.transcript);
        finishProcessing();
        void saveBrowserAudioSummary(nextResult, source === 'record' ? 'record' : 'upload', source === 'upload' ? fileName : 'สรุปจากการอัดสด');
        onSummaryReady?.({
          summary: chunked.summary,
          transcript: chunked.transcript,
          source: source === 'record' ? 'record' : 'upload',
        });
        setPendingFile(null);
        setStatusText('สรุปเสร็จแล้ว (โหมดแบ่งไฟล์อัตโนมัติ)');
        return;
      } catch (chunkErr: any) {
        if (source === 'record' && fallbackTranscript) {
          setStatusText('แบ่งไฟล์อัตโนมัติไม่สำเร็จ ระบบกำลังสรุปจากข้อความที่ถอดสดไว้...');
          const fallbackSummary = await summarizeTranscriptLikeDocument(fallbackTranscript);
          const nextResult = {
            transcript: fallbackTranscript,
            summary: fallbackSummary || buildDocumentStyleSummaryFallback(fallbackTranscript),
          };
          setRecordResult(nextResult);
          updateLiveTranscript(fallbackTranscript);
          finishProcessing();
          void saveBrowserAudioSummary(nextResult, 'record', 'สรุปจากการอัดสด');
          onSummaryReady?.({
            summary: nextResult.summary,
            transcript: nextResult.transcript,
            source: 'record',
          });
          setStatusText('สรุปเสร็จแล้วจากข้อความที่ถอดสดไว้');
          return;
        }

        if (!canAttemptDirectUpload) {
          const chunkMessage =
            chunkErr?.response?.data?.message ||
            chunkErr?.message ||
            'แบ่งไฟล์อัตโนมัติไม่สำเร็จ';
          setError(chunkMessage);
          setStatusText('ไฟล์เสียงยาวเกินกว่าจะส่งตรง ระบบแบ่งไฟล์อัตโนมัติไม่สำเร็จ');
          return;
        }

        setStatusText('แบ่งไฟล์อัตโนมัติไม่สำเร็จ ระบบกำลังลองส่งไฟล์ตรง...');
      }
    }

    const fileField = isCareer ? 'audio' : 'file';
    formData.append(fileField, blob, fileName);
    if (selectedSubjectId) {
      formData.append('subject_id', selectedSubjectId);
    }
    if (source) {
      formData.append('source_mode', source);
    }
    if (!isCareer) {
      formData.append('summary_period', activeSummaryPeriod);
      if (selectedMood) formData.append('mood', selectedMood);
    }

    const endpoint = isCareer ? '/ai/analyze/career/audio' : '/ai/summarize/audio';
    const client = isCareer ? aiApi : api;

    try {
      const response = await client.post(endpoint, formData);
      const payload = response.data ?? {};
      let resolvedSummary = String(payload.summary ?? payload.analysis ?? '').trim();
      const resolvedTranscript = String(payload.transcript ?? payload.text ?? fallbackTranscript).trim();

      if (!resolvedSummary && resolvedTranscript) {
        resolvedSummary = await summarizeTranscriptLikeDocument(resolvedTranscript);
      }

      if (!resolvedSummary && !resolvedTranscript) {
        throw new Error('ไม่สามารถถอดเสียงหรือสรุปจากไฟล์นี้ได้ กรุณาลองไฟล์อื่นหรืออัปโหลดใหม่');
      }

      const nextResult = {
        transcript: resolvedTranscript,
        summary: resolvedSummary
      };
      if (source === 'record') {
        setRecordResult(nextResult);
      } else {
        setUploadResult(nextResult);
      }
      setPendingFile(null);
      updateLiveTranscript(resolvedTranscript);
      finishProcessing();
      setStatusText('สรุปเสร็จแล้ว! เลือกไฟล์ใหม่หรือลองอัดอีกครั้งได้เลย');
      onSummaryReady?.({
        summary: resolvedSummary || buildDocumentStyleSummaryFallback(resolvedTranscript),
        transcript: resolvedTranscript,
        source: source === 'record' ? 'record' : 'upload',
      });
      const title = 'สรุปจากเสียงเสร็จแล้ว';
      const message = truncateText(resolvedSummary || resolvedTranscript || 'สรุปจากเสียงเสร็จแล้ว');
      void pushBellNotification({ title, message });
      if (selectedSubjectId) {
        fetchSavedSummaries(selectedSubjectId);
      }
    } catch (err) {
      const serverMessage = (err as any)?.response?.data?.message;
      const serverDetail = (err as any)?.response?.data?.detail;
      const serverErrors = (err as any)?.response?.data?.errors;
      const firstError = serverErrors ? serverErrors[Object.keys(serverErrors)[0]]?.[0] : null;
      const message =
        (typeof serverMessage === 'string' && serverMessage.trim() !== '' && serverMessage) ||
        (typeof serverDetail === 'string' && serverDetail.trim() !== '' && serverDetail) ||
        (typeof firstError === 'string' && firstError.trim() !== '' && firstError) ||
        (err instanceof Error ? err.message : 'เกิดข้อผิดพลาดระหว่างการประมวลผล');

      if (source === 'record' && fallbackTranscript) {
        try {
          setStatusText('เสียงจากไฟล์ประมวลผลไม่สำเร็จ ระบบกำลังสรุปจากข้อความที่ถอดสดไว้...');
          const fallbackSummary = await summarizeTranscriptLikeDocument(fallbackTranscript);
          const nextResult = {
            transcript: fallbackTranscript,
            summary: fallbackSummary || buildDocumentStyleSummaryFallback(fallbackTranscript),
          };
          setRecordResult(nextResult);
          updateLiveTranscript(fallbackTranscript);
          finishProcessing();
          void saveBrowserAudioSummary(nextResult, 'record', 'สรุปจากการอัดสด');
          onSummaryReady?.({
            summary: nextResult.summary,
            transcript: nextResult.transcript,
            source: 'record',
          });
          setStatusText('สรุปเสร็จแล้วจากข้อความที่ถอดสดไว้');
          const title = 'สรุปจากเสียงเสร็จแล้ว';
          const notificationMessage = truncateText(nextResult.summary || nextResult.transcript);
          void pushBellNotification({ title, message: notificationMessage });
          return;
        } catch {
          // Fall through to the original error message when transcript fallback also fails.
        }
      }

      if (
        source === 'upload' &&
        (isGooglePayloadLimitError(message) || isGoogleMonoChannelError(message) || isLowConfidenceTranscriptError(message))
      ) {
        try {
          setError(null);
          setStatusText('ระบบกำลังแบ่งไฟล์และถอดเสียงอัตโนมัติ...');
          const chunked = await transcribeLargeAudioByChunks(blob);
          const nextResult = {
            transcript: chunked.transcript,
            summary: chunked.summary,
          };
          setUploadResult(nextResult);
          setLiveTranscript(chunked.transcript);
          finishProcessing();
          void saveBrowserAudioSummary(nextResult, 'upload', fileName);
          onSummaryReady?.({
            summary: chunked.summary,
            transcript: chunked.transcript,
            source: 'upload',
          });
          setPendingFile(null);
          setStatusText('สรุปเสร็จแล้ว (โหมดแบ่งไฟล์อัตโนมัติ)');
          return;
        } catch (chunkErr: any) {
          const chunkMessage =
            chunkErr?.response?.data?.message ||
            chunkErr?.message ||
            'แบ่งไฟล์อัตโนมัติไม่สำเร็จ';
          setError(chunkMessage);
          setStatusText('เกิดข้อผิดพลาดในการแบ่งไฟล์เสียงอัตโนมัติ');
          return;
        }
      }

      setError(message);
      setStatusText('เกิดข้อผิดพลาดในการประมวลผลเสียง กรุณาลองอีกครั้ง');
    } finally {
      setIsLoading(false);
      setProcessingSource(null);
      setTimer(0);
    }
  };

  const renderResultPanel = ({ source, data }: ResultBucket) => {
    if (!data) return null;

    const title = source === 'record' ? 'ผลการสรุปจากการบันทึกสด' : 'ผลการสรุปจากไฟล์เสียง';
    const description =
      source === 'record'
        ? 'ระบบจะแสดงผลสรุปจากเสียงที่อัดสดในส่วนนี้โดยเฉพาะ'
        : 'ระบบจะแสดงผลสรุปจากไฟล์เสียงที่อัปโหลดในส่วนนี้โดยเฉพาะ';
    const archiveId = source === 'record' ? -2 : 0;
    const archiveTitle =
      source === 'record'
        ? 'สรุปจากการอัดสด'
        : selectedFileName || 'สรุปจากไฟล์เสียง';

    return (
      <section className={`doc-result-panel ${shellClass} ${source === 'upload' ? 'border-l-[4px] border-l-[color:var(--accent)]' : 'border-l-[4px] border-l-[color:var(--border)]'}`}>
        <div className="flex flex-col gap-3 border-b border-[color:var(--border)] px-6 py-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-[-0.03em] text-[color:var(--text)]">{title}</h2>
            <p className="text-sm text-muted">{description}</p>
          </div>
          <div className="flex items-center gap-2">
            {data ? (
              <button
                type="button"
                onClick={() =>
                  void archiveAudioSummary({
                    id: archiveId,
                    title: archiveTitle,
                    summary: data.summary,
                    transcript: data.transcript,
                  })
                }
                disabled={archivingSummaryId === archiveId || !selectedSubjectId || archivedSummaryKeys.has(makeAudioArchiveKey(archiveTitle, data.summary, data.transcript))}
                className={`doc-toolbar-btn rounded-full px-4 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  embedded
                    ? 'border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--accent)] hover:opacity-90'
                    : 'border border-[color:rgba(var(--accent-rgb),0.24)] bg-[color:var(--surface)] text-[color:var(--accent)] hover:bg-[color:rgba(var(--accent-rgb),0.08)]'
                }`}
              >
                {archivingSummaryId === archiveId ? 'กำลังเก็บถาวร...' : archivedSummaryKeys.has(makeAudioArchiveKey(archiveTitle, data.summary, data.transcript)) ? 'เก็บถาวรแล้ว' : 'เก็บถาวร'}
              </button>
            ) : null}
            {data ? (
              <button
                type="button"
                onClick={() => clearResult(source)}
                className={`doc-toolbar-btn rounded-full border px-4 py-2 text-xs font-semibold transition ${
                  embedded
                    ? 'border-[color:var(--border)] bg-[color:var(--surface)] text-muted hover:opacity-90'
                    : 'border-[color:var(--border)] bg-[color:var(--surface-2)] text-muted hover:opacity-85'
                }`}
              >
                ล้างผลลัพธ์
              </button>
            ) : null}
          </div>
        </div>

        <div className="space-y-4 px-6 py-6">
          <div className={`rounded-[24px] p-5 ${embedded ? 'border border-[color:rgba(var(--accent-rgb),0.18)] bg-[color:rgba(var(--accent-rgb),0.08)]' : 'border border-[color:rgba(var(--accent-rgb),0.18)] bg-[color:rgba(var(--accent-rgb),0.08)]'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-[color:var(--text)]">
              {source === 'record' ? 'ข้อความจากการอัดสด' : 'ใจความสำคัญล่าสุด'}
            </p>
            </div>
            <ExpandableText
              text={data?.summary || data?.transcript || ''}
              previewChars={420}
              className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[color:var(--text)]/90"
              buttonClassName={`mt-3 text-sm font-semibold transition hover:opacity-80 text-[color:var(--accent)]`}
              emptyText="ยังไม่มีข้อมูล กรุณาเริ่มสรุปเสียงในส่วนนี้ก่อน"
            />
          </div>

          <div className="doc-result-empty rounded-2xl border border-dashed border-[color:var(--border)] bg-[color:var(--surface-2)] p-6 text-center text-sm text-muted">
            ระบบจะแยกผลลัพธ์ของแต่ละโหมดออกจากกันเพื่อให้ดูง่ายขึ้น
          </div>
        </div>
      </section>
    );
  };

  return (
    <div className={`ai-summary-theme voice-summary-page doc-summary-page ${embedded ? 'space-y-6' : 'relative min-h-screen overflow-hidden space-y-6 pb-16 bg-transparent font-sans'}`}>
      <div className={embedded ? '' : 'relative z-10 mx-auto max-w-7xl space-y-8 px-4 pb-4 pt-2 md:p-8'}>
      {!embedded ? (
        <header className="doc-summary-header mb-8 flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <div className="doc-summary-header-icon flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl shadow-lg" style={{ background: 'linear-gradient(135deg, var(--accent), rgba(var(--accent-rgb),0.72))', boxShadow: '0 18px 38px rgba(var(--accent-rgb),0.30)' }}>
              <svg viewBox="0 0 24 24" className="h-7 w-7 text-white" fill="none" aria-hidden="true">
                <path d="M12 1v11M8 5a4 4 0 1 1 8 0v7a4 4 0 1 1-8 0V5ZM19 10v2a7 7 0 0 1-14 0v-2M12 19v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <span className="mb-2 inline-flex items-center rounded-full border border-[color:rgba(var(--accent-rgb),0.22)] bg-[color:rgba(var(--accent-rgb),0.12)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
                Voice Summary
              </span>
              <h1 className="text-2xl font-bold tracking-wide text-[color:var(--text)] md:text-3xl">สรุปจากเสียงด้วย AI</h1>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">อัปโหลดหรืออัดเสียง แล้วจัดเก็บสรุปแยกตามวิชาและช่วงเวลา</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="doc-summary-chip"><span className="h-2 w-2 rounded-full" style={{ background: 'var(--accent)' }} />{subjects.find(subject => String(subject.id) === selectedSubjectId)?.name ?? 'ยังไม่เลือกวิชา'}</span>
            <span className="doc-summary-chip">{savedSummaries.length} สรุป</span>
          </div>
        </header>
      ) : null}
        <div className={mainLayoutClass}>
        <div className={leftPanelLayoutClass}>
          {!embedded ? (
          <section className={`doc-summary-card ${shellClass} xl:col-span-2`}>
            <div className="px-6 py-6">
              <div className="mb-5 flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-[color:var(--on-accent)]" style={{ background: 'var(--accent)' }}>1</span>
                <div>
                  <p className="text-xs font-bold" style={{ color: 'var(--accent)' }}>ขั้นที่ 1</p>
                  <h2 className="text-lg font-black tracking-[-0.02em] text-[color:var(--text)]">เลือกบริบท <span className="font-medium text-muted">เทอม / วิชา</span></h2>
                </div>
              </div>
              <div className="grid w-full gap-5 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-xs font-semibold text-muted">ภาคเรียน</label>
                  <select
                    value={selectedSemesterKey}
                    onChange={event => setSelectedSemesterKey(event.target.value)}
                    className={fieldClass}
                  >
                    {semesterOptions.map(option => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-2 block text-xs font-semibold text-muted">วิชาที่เกี่ยวข้อง</label>
                  <select
                    value={selectedSubjectId}
                    onChange={event => {
                      const value = event.target.value;
                      setSelectedSubjectId(value);
                      if (value) localStorage.setItem(lastSubjectKey, value);
                    }}
                    className={fieldClass}
                  >
                    <option value="">เลือกวิชา</option>
                    {selectableSubjects.map(subject => (
                      <option key={subject.id} value={subject.id}>
                        {subject.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {subjects.length === 0 ? (
                <p className="text-xs text-muted">
                  ยังไม่มีวิชาในระบบ <a href="/subjects" className="font-semibold text-[color:var(--accent)]">ไปเพิ่มวิชา</a>
                </p>
              ) : filteredSubjects.length === 0 && selectedSemesterKey !== 'all' ? (
                <p className="text-xs text-[color:var(--accent)]">เทอมนี้ยังไม่มีวิชาที่ผูกไว้ ระบบแสดงวิชาทั้งหมดให้เลือกแทน</p>
              ) : null}
            </div>
          </section>
          ) : null}
          {showUploadSection ? (
          <section
            id="upload"
            className={`${cardClass} ${initialSection === 'upload' ? activeClass : ''} ${embedded ? 'order-2 border-dashed p-5' : ''}`}
            style={
              embedded
                ? {
                    borderColor: isDarkTheme ? 'rgba(255,255,255,0.14)' : 'var(--border)',
                    background: 'color-mix(in srgb, var(--surface) 92%, transparent)',
                    boxShadow: isDarkTheme ? '0 18px 36px rgba(0,0,0,0.45)' : undefined
                  }
                : undefined
            }
          >
            <div className="mb-5 flex items-center gap-3">
              {embedded ? (
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[color:rgba(var(--accent-rgb),0.12)] text-accent">
                  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M9 18V5l12-2v13" />
                    <circle cx="6" cy="18" r="3" />
                    <circle cx="18" cy="16" r="3" />
                  </svg>
                </span>
              ) : (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-[color:var(--on-accent)]" style={{ background: 'var(--accent)' }}>2</span>
              )}
              <div>
                {!embedded ? <p className="text-xs font-bold" style={{ color: 'var(--accent)' }}>ขั้นที่ 2</p> : null}
                <h2 className="text-xl font-black tracking-[-0.03em] text-[color:var(--text)]">ใส่เนื้อหา <span className="font-medium text-muted">ไฟล์เสียง</span></h2>
                <p className="mt-1 text-sm text-muted">{embedded ? 'อัปโหลดไฟล์เพื่อสรุปทันที' : 'เลือกไฟล์เสียงที่มีอยู่แล้ว แล้วให้ระบบถอดและสรุปใจความทันที'}</p>
              </div>
            </div>
            {!embedded ? (
              <div className="mb-5 flex w-full max-w-md rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] p-1">
                <a href="/document-summary" className="flex-1 rounded-lg px-4 py-2 text-center text-sm font-semibold text-muted transition hover:bg-[color:var(--surface)]">เอกสาร</a>
                <span className="flex-1 rounded-lg px-4 py-2 text-center text-sm font-semibold shadow-[0_6px_16px_rgba(var(--accent-rgb),0.25)]" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>ไฟล์เสียง</span>
              </div>
            ) : null}


   

          {!embedded ? (
            <section className={`doc-summary-card ${shellClass} xl:col-span-2`}>
              <div className="px-6 py-6">
                <div className="mb-5 flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-[color:var(--on-accent)]" style={{ background: 'var(--accent)' }}>3</span>
                  <div>
                    <p className="text-xs font-bold" style={{ color: 'var(--accent)' }}>ขั้นที่ 3</p>
                    <h2 className="text-lg font-black tracking-[-0.02em] text-[color:var(--text)]">
                      ตั้งค่าการสรุป <span className="font-medium text-muted">รูปแบบ / อารมณ์</span>
                    </h2>
                  </div>
                </div>
                
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  <label className="text-sm font-semibold text-[color:var(--text)] whitespace-nowrap">
                    รูปแบบการสรุป:
                  </label>
                  <div className="flex w-full sm:w-max rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] p-1">
                    {summaryPeriodOptions.map(option => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          setSummaryPeriod(option.value);
                          if (onSummaryPeriodChange) {
                            onSummaryPeriodChange(option.value);
                          }
                        }}
                        className={`flex-1 sm:flex-none rounded-lg px-6 py-2 text-center text-sm font-semibold transition ${
                          activeSummaryPeriod === option.value
                            ? 'shadow-[0_4px_12px_rgba(var(--accent-rgb),0.25)] text-[color:var(--on-accent)]'
                            : 'text-muted hover:bg-[color:var(--surface)]'
                        }`}
                        style={
                          activeSummaryPeriod === option.value
                            ? { background: 'var(--accent)' }
                            : undefined
                        }
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>

                  {/* Dropdown อารมณ์ */}
                  <div className="relative z-20 w-full sm:w-[260px]" ref={moodDropdownRef}>
                    <button
                      type="button"
                      className="flex w-full items-center rounded-xl pl-4 pr-10 py-2.5 text-left text-sm text-[color:var(--text)] transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]"
                      style={{
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)'
                      }}
                      aria-haspopup="listbox"
                      aria-expanded={isMoodDropdownOpen}
                      onClick={() => setIsMoodDropdownOpen(open => !open)}
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {moodOptions.find(o => o.value === selectedMood)?.label ?? 'เลือกอารมณ์ก่อนบันทึกสรุป'}
                      </span>
                    </button>
                    <span className={`pointer-events-none absolute right-3 top-[19px] text-xs text-muted transition-transform ${isMoodDropdownOpen ? 'rotate-180' : ''}`}>▼</span>

                    {isMoodDropdownOpen && (
                      <div
                        className="absolute left-0 right-0 top-full mt-1 overflow-hidden rounded-lg py-1 text-sm shadow-xl ring-1 ring-[color:var(--border)]"
                        style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
                        role="listbox"
                      >
                        <button
                          type="button"
                          className={`flex w-full items-center px-4 py-2 text-left font-semibold transition-colors ${selectedMood === '' ? 'text-[color:var(--on-accent)]' : 'text-[color:var(--text)] hover:bg-[color:var(--surface)]'}`}
                          style={selectedMood === '' ? { background: 'var(--accent)' } : undefined}
                          role="option"
                          aria-selected={selectedMood === ''}
                          onClick={() => {
                            setSelectedMood('');
                            setIsMoodDropdownOpen(false);
                          }}
                        >
                          <span className="truncate">เลือกอารมณ์ก่อนบันทึกสรุป</span>
                        </button>
                        {moodOptions.map(option => (
                          <button
                            key={option.value}
                            type="button"
                            className={`flex w-full items-center px-4 py-2 text-left font-semibold transition-colors ${selectedMood === option.value ? 'text-[color:var(--on-accent)]' : 'text-[color:var(--text)] hover:bg-[color:var(--surface)]'}`}
                            style={selectedMood === option.value ? { background: 'var(--accent)' } : undefined}
                            role="option"
                            aria-selected={selectedMood === option.value}
                            onClick={() => {
                              setSelectedMood(option.value);
                              setIsMoodDropdownOpen(false);
                            }}
                          >
                            <span className="truncate">{option.label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>
          ) : null}







            

            <div
              className={`doc-upload-zone mt-5 rounded-[28px] border-2 border-dashed px-6 py-10 text-center transition ${
                isDragging
                  ? 'border-[color:var(--accent)] bg-[color:rgba(var(--accent-rgb),0.12)]'
                  : 'border-[color:var(--border)] bg-[color:var(--surface-2)]'
              } ${embedded ? 'px-4 py-8' : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <div className={`mx-auto flex h-24 w-24 items-center justify-center rounded-full ${embedded ? 'bg-[color:rgba(var(--accent-rgb),0.12)] text-[color:var(--accent)]' : 'bg-[color:rgba(var(--accent-rgb),0.12)] text-[color:var(--accent)]'}`}>
                <svg viewBox="0 0 24 24" className="h-12 w-12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
              </div>
              <h3 className={`mt-5 font-black tracking-[-0.03em] text-[color:var(--text)] ${embedded ? 'text-lg' : 'text-2xl'}`}>
                {selectedFileName ? 'พร้อมสรุปไฟล์เสียงที่เลือกแล้ว' : 'ลากและวางไฟล์เสียง หรือคลิกเพื่อเลือก'}
              </h3>
              <p className="mt-2 text-sm text-muted">
                {selectedFileName || 'ลากและวางไฟล์ MP3, WAV, M4A หรือคลิกเพื่อเลือก'}
              </p>
              <p className="mt-1 text-xs text-muted">
                ไฟล์ใหญ่เกิน 8MB ระบบจะสลับเป็นโหมดแบ่งไฟล์อัตโนมัติเพื่อถอดเสียงให้
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={triggerFileSelect}
                  disabled={isLoading}
                  className={`doc-toolbar-btn rounded-2xl border px-6 py-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    embedded
                      ? 'border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text)] shadow-sm hover:border-[color:rgba(var(--accent-rgb),0.22)] hover:text-[color:var(--accent)]'
                      : 'border-[color:var(--border)] bg-[color:var(--surface)] px-8 text-base font-black text-[color:var(--text)] shadow-sm hover:border-[color:rgba(var(--accent-rgb),0.22)] hover:text-[color:var(--accent)]'
                  }`}
                >
                  เลือกไฟล์จากเครื่อง
                </button>
                  <button
                    type="button"
                    onClick={summarizePendingFile}
                    disabled={isLoading || !pendingFile}
                    className={`doc-primary-action rounded-2xl transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      embedded
                        ? 'bg-[color:var(--accent)] px-5 py-3 text-sm font-black text-[color:var(--on-accent)] shadow-[0_16px_32px_rgba(var(--accent-rgb),0.22)] hover:opacity-95'
                        : 'bg-[color:var(--accent)] px-6 py-3 text-base font-bold text-[color:var(--on-accent)] shadow-[0_16px_32px_rgba(var(--accent-rgb),0.22)] hover:opacity-95'
                    }`}
                  >
                    {processingSource === 'upload' && isLoading ? 'กำลังประมวลผล...' : 'สร้างสรุปจากไฟล์'}
                  </button>
              </div>
              <input ref={fileInputRef} type="file" accept="audio/*" className="hidden" onChange={handleFileChange} />
            </div>
            <p className={`mt-4 flex items-center justify-center gap-2 text-xs font-medium text-muted ${embedded ? 'text-center' : ''}`}>
              {processingSource === 'upload' && isLoading ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-[color:rgba(var(--accent-rgb),0.24)] border-t-[color:var(--accent)]"></span>
              ) : null}
              ไฟล์จะถูกอัปโหลดอย่างปลอดภัยและประมวลผลทันที
            </p>
            <p className="mt-1 text-center text-xs text-muted">
              รองรับไฟล์เสียงสูงสุด 50MB (โดยทั่วไปประมาณ 1-2 ชั่วโมง ขึ้นกับคุณภาพเสียง)
            </p>

            {processingSource === 'upload' && isLoading ? (
              <div className={`mt-4 rounded-2xl px-4 py-3 text-sm ${embedded ? 'border border-[color:rgba(var(--accent-rgb),0.16)] bg-[color:rgba(var(--accent-rgb),0.08)] text-[color:var(--text)]' : 'border border-[color:rgba(var(--accent-rgb),0.16)] bg-[color:rgba(var(--accent-rgb),0.08)] text-[color:var(--text)]'}`}>
                กำลังอัปโหลดและถอดใจความจากไฟล์เสียง...
              </div>
            ) : null}
          </section>
          ) : null}

          {showRecordSection ? (
          <section
            id="record"
            className={`${cardClass} ${initialSection === 'record' ? activeClass : ''} ${embedded ? 'order-1 p-5' : ''}`}
            style={
              embedded
                ? {
                    borderColor: isDarkTheme ? 'rgba(255,255,255,0.14)' : 'var(--border)',
                    boxShadow: isDarkTheme ? '0 18px 36px rgba(0,0,0,0.45)' : undefined
                  }
                : undefined
            }
          >
            <div className="mb-4 flex items-center gap-3">
              <span className={`flex h-10 w-10 items-center justify-center rounded-2xl ${embedded ? 'bg-[color:rgba(var(--accent-rgb),0.12)] text-[color:var(--accent)]' : 'bg-[color:rgba(var(--accent-rgb),0.12)] text-[color:var(--accent)]'}`}>
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 1v11" />
                  <path d="M8 5a4 4 0 1 1 8 0v7a4 4 0 1 1-8 0V5Z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <path d="M12 19v4" />
                </svg>
              </span>
              <div>
                <h2 className="text-xl font-black tracking-[-0.03em] text-[color:var(--text)]">บันทึกสด</h2>
                <div className="mt-1 flex items-center gap-2">
                  <p className="text-sm text-muted">พร้อมเริ่มบันทึกใหม่</p>
                  {embedded ? (
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: 'rgba(var(--accent-rgb),0.16)', color: 'var(--accent)' }}>
                      Live
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            <div className={`doc-upload-zone rounded-[28px] border px-6 py-10 text-center ${embedded ? 'border-dashed border-[color:var(--border)] bg-[color:var(--surface-2)]' : 'border-dashed border-[color:var(--border)] bg-[color:var(--surface-2)]'}`}>
              <div className={`mx-auto flex h-24 w-24 items-center justify-center rounded-full ${embedded ? 'relative bg-[color:rgba(var(--accent-rgb),0.12)] text-[color:var(--accent)]' : 'bg-[color:rgba(var(--accent-rgb),0.12)] text-[color:var(--accent)]'}`}>
                {embedded ? (
                  <>
                    <span className="pointer-events-none absolute -inset-3 rounded-full border border-[color:rgba(var(--accent-rgb),0.24)]" />
                    <span className="pointer-events-none absolute -inset-6 rounded-full border border-[color:rgba(var(--accent-rgb),0.18)]" />
                  </>
                ) : null}
                <svg viewBox="0 0 24 24" className="h-12 w-12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 1v11" />
                  <path d="M8 5a4 4 0 1 1 8 0v7a4 4 0 1 1-8 0V5Z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <path d="M12 19v4" />
                </svg>
              </div>

            <div className="mt-6 flex flex-col items-center gap-4">
              <button
                type="button"
                onClick={toggleRecording}
                disabled={!isRecorderSupported || isLoading}
                className={`flex h-24 w-24 items-center justify-center rounded-full transition focus:outline-none ${
                  embedded
                    ? `text-[color:var(--on-accent)] shadow-[0_18px_36px_rgba(var(--accent-rgb),0.25)] focus:ring-4 focus:ring-[color:rgba(var(--accent-rgb),0.16)] ${isRecording ? 'animate-pulse bg-[color:var(--accent)]' : 'bg-[color:var(--accent)] hover:scale-105'}`
                    : `text-[color:var(--on-accent)] shadow-[0_18px_36px_rgba(var(--accent-rgb),0.25)] focus:ring-4 focus:ring-[color:rgba(var(--accent-rgb),0.16)] ${isRecording ? 'animate-pulse bg-[color:var(--accent)]' : 'bg-[color:var(--accent)] hover:scale-105'}`
                } ${(!isRecorderSupported || isLoading) && 'cursor-not-allowed opacity-60'}`}
              >
                {isRecording ? (
                  <svg viewBox="0 0 24 24" className="h-10 w-10" fill="currentColor" aria-hidden="true">
                    <rect x="7" y="7" width="10" height="10" rx="2" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 1v11" />
                    <path d="M8 5a4 4 0 1 1 8 0v7a4 4 0 1 1-8 0V5Z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <path d="M12 19v4" />
                  </svg>
                )}
              </button>

              <div className="text-center">
                <p className={`${embedded ? 'text-4xl' : 'text-5xl'} font-mono font-black text-[color:var(--text)]`}>{formatTimer(timer)}</p>
                <p className="mt-2 text-sm text-muted">{isRecording ? 'กำลังบันทึกเสียง...' : 'พร้อมเริ่มบันทึกใหม่'}</p>
                <p className="mt-1 text-xs text-muted">
                  {isRecording || recordedBytes > 0
                    ? `บันทึกแล้วประมาณ ${formatFileSize(recordedBytes)} ระบบจะแบ่งเสียงเป็นช่วงสั้น ๆ ตอนสรุป`
                    : 'อัดสดได้นานขึ้น ระบบจะแบ่งเสียงเป็นช่วงสั้น ๆ ตอนสรุป'}
                </p>
              </div>
              {embedded ? (
                <button
                  type="button"
                  onClick={toggleRecording}
                  disabled={!isRecorderSupported || isLoading}
                  className="doc-toolbar-btn rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] px-6 py-3 text-base font-black text-[color:var(--text)] shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isRecording ? 'หยุดและประมวลผล' : 'เริ่มบันทึก'}
                </button>
              ) : null}
            </div>
            </div>

            {!isRecorderSupported ? (
              <div className="mt-4 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-2)] p-4 text-sm text-muted">
                เบราว์เซอร์ของคุณไม่รองรับการใช้งาน MediaRecorder กรุณาเปลี่ยนเบราว์เซอร์หรืออัปเดตเวอร์ชันล่าสุด
              </div>
            ) : null}
            {isRecorderSupported && !isLiveRecognitionSupported ? (
              <div className="mt-4 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-2)] p-4 text-sm text-muted">
                เบราว์เซอร์นี้ยังไม่รองรับถอดเสียงสดระหว่างอัด ระบบจะสรุปให้อัตโนมัติหลังหยุดอัดเสียง
              </div>
            ) : null}

            {processingSource === 'record' && isLoading ? (
              <div className={`mt-4 rounded-2xl px-4 py-3 text-sm ${embedded ? 'border border-[color:rgba(var(--accent-rgb),0.16)] bg-[color:rgba(var(--accent-rgb),0.08)] text-[color:var(--text)]' : 'border border-[color:rgba(var(--accent-rgb),0.16)] bg-[color:rgba(var(--accent-rgb),0.08)] text-[color:var(--text)]'}`}>
                กำลังประมวลผลเสียงที่บันทึก...
              </div>
            ) : null}
            {isRecording ? (
              <div className="mt-4 rounded-2xl border border-[color:rgba(var(--accent-rgb),0.16)] bg-[color:rgba(var(--accent-rgb),0.08)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-[color:var(--text)]">
                    ข้อความที่ถอดเสียงแบบเรียลไทม์
                  </p>
                  {liveTranscript ? (
                    <button
                      type="button"
                      onClick={() =>
                        void archiveAudioSummary({
                          id: -3,
                          title: 'บันทึกการอัดเสียงสด',
                          summary: liveTranscript,
                          transcript: liveTranscript,
                        })
                      }
                      disabled={archivingSummaryId === -3 || !selectedSubjectId}
                      className="rounded-full border border-[color:rgba(var(--accent-rgb),0.24)] bg-[color:var(--surface)] px-3 py-1.5 text-xs font-semibold text-[color:var(--accent)] transition hover:bg-[color:rgba(var(--accent-rgb),0.08)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {archivingSummaryId === -3 ? 'กำลังเก็บถาวร...' : 'เก็บถาวร'}
                    </button>
                  ) : null}
                </div>
                <p className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap pr-2 text-sm text-muted">
                  {liveTranscript || 'กำลังรอเสียงพูด...'}
                </p>
              </div>
            ) : null}
          </section>
          ) : null}

          {!embedded && showRecordSection && recordResult ? renderResultPanel({ source: 'record', data: recordResult }) : null}

          <div className={`doc-status-banner rounded-2xl border border-[color:rgba(var(--accent-rgb),0.16)] bg-[color:rgba(var(--accent-rgb),0.08)] p-4 text-sm font-medium text-[color:var(--text)] xl:col-span-2 ${embedded ? 'hidden' : ''}`}>
            {statusText}
          </div>

          {error ? (
            <div className={`rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300 xl:col-span-2 ${embedded ? 'hidden' : ''}`}>{error}</div>
          ) : null}
        </div>

        <div className={`${embedded ? 'space-y-5' : 'space-y-6'}`}>
          {!embedded && showUploadSection && uploadResult ? renderResultPanel({ source: 'upload', data: uploadResult }) : null}
        </div>
        </div>

      {embedded ? (
        <div className="space-y-3">
          <div className="rounded-2xl border border-[color:rgba(var(--accent-rgb),0.16)] bg-[color:rgba(var(--accent-rgb),0.08)] px-4 py-3 text-sm font-medium text-[color:var(--text)]">
            {statusText}
          </div>
          {error ? (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
          ) : null}
        </div>
      ) : null}
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
