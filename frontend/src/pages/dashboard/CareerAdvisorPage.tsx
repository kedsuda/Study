
import axios from 'axios';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Moon, Palette, Star, Sun, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useDefaultSemesterSelection, useSemesterOptions } from '../../hooks/useSemesterOptions';
import { filterBySemester, toNumberOrNull } from '../../utils/semester';
import { emitSubjectsUpdated, subscribeSubjectsUpdated } from '../../utils/subjectSync';

// --- Types ---
type ApiRecommendation = { id?: number; career: string; skills: string; subjects: string; score: number; reason?: string | null; created_at?: string | null; analysis_provider?: string | null; analysis_generated_at?: string | null; analysis_run_id?: string | null; };
type RecommendationCard = { title: string; skills: string; subjects: string; score: number; source: 'history' | 'generated'; reason?: string | null; analysisProvider?: string | null; analysisGeneratedAt?: string | null; analysisRunId?: string | null; };
type TopSubject = { id: number; subject_name: string; summary_count: number; study_log_count?: number; study_hours: number; avg_mood_score?: number; quiz_attempt_count?: number; avg_quiz_score?: number | null; latest_quiz_score?: number | null; max_quiz_score?: number; is_latest_top_score?: boolean; passed_count?: number; };
type WeakSubject = { id: number; subject_name: string; hint: string; next_steps: string[]; };
type LatestQuizInsight = { quiz_title: string; subject_name: string; score: number; total: number; percentage: number; passed: boolean; created_at?: string | null; };
type SubjectOption = { id: number; name: string; semester_id?: number | null; semester?: number | null; academic_year?: number | null; };
type ChatMessage = { id: number; user_id: string; room_id: string; sender_type: 'user' | 'assistant' | string; message: string; attachment_url?: string | null; is_deleted?: boolean; created_at?: string | null; };
type ChatRoomMeta = { id: string; title: string; updated_at: string; last_message?: string; };
type CareerAdvisorPageProps = { mode?: 'career' | 'home'; };
type BrowserSpeechRecognition = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; onresult: ((event: any) => void) | null; onerror: ((event: any) => void) | null; onend: (() => void) | null; };

// --- Helpers ---
const normalizeAssistantFallback = (message: string) => {
  const text = (message || '').trim();
  if (!text) return text;
  const legacyPatterns = ['Gemini API ของระบบยังไม่ได้เปิดใช้งานในโปรเจกต์นี้', 'ระบบ AI ตอบกลับไม่ได้ชั่วคราว', 'Gemini ของระบบใช้โควต้าครบแล้ว', 'Gemini ของระบบถูกบล็อกการเรียกใช้งานอยู่', 'Gemini ของระบบตั้งค่า model ไม่ตรงกับ endpoint'];
  if (legacyPatterns.some(pattern => text.includes(pattern))) return 'ตอนนี้ระบบ AI ภายนอกมีปัญหาชั่วคราว แต่ยังใช้งานผู้ช่วยได้ตามปกติค่ะ บอกหัวข้อที่อยากสรุป/วางแผนอ่าน/ทำแบบฝึกหัดได้เลยค่ะ';
  return text;
};
const normalizeCareerErrorMessage = (error: unknown, fallback: string) => {
  const axiosMessage = axios.isAxiosError(error) ? String(error.response?.data?.message ?? error.message ?? '').trim() : error instanceof Error ? error.message.trim() : '';
  const normalized = axiosMessage.toLowerCase();
  if (normalized.includes('invalid api key') || normalized.includes('api key') || normalized.includes('unauthorized') || normalized.includes('authentication') || normalized.includes('groq_api_key') || normalized.includes('gemini api key')) return 'ระบบวิเคราะห์อาชีพยังไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่ภายหลัง';
  if (normalized.includes('rate limit') || normalized.includes('quota') || normalized.includes('resource exhausted') || normalized.includes('high demand')) return 'ระบบวิเคราะห์อาชีพกำลังมีผู้ใช้งานจำนวนมาก กรุณาลองใหม่อีกครั้งภายหลัง';
  if (axiosMessage !== '') return axiosMessage;
  return fallback;
};
const normalizeCareerInfoMessage = (message?: string | null) => {
  const text = String(message ?? '').trim();
  if (!text) return null;
  const normalized = text.toLowerCase();
  if (normalized.includes('invalid api key') || normalized.includes('api key') || normalized.includes('unauthorized') || normalized.includes('authentication') || normalized.includes('groq_api_key') || normalized.includes('gemini api key')) return 'ระบบวิเคราะห์อาชีพยังไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่ภายหลัง';
  if (normalized.includes('rate limit') || normalized.includes('quota') || normalized.includes('resource exhausted') || normalized.includes('high demand') || normalized.includes('please retry in')) return 'ระบบวิเคราะห์อาชีพกำลังมีผู้ใช้งานจำนวนมาก กรุณาลองใหม่อีกครั้งภายหลัง';
  return text;
};
const formatAnalysisTime = (value?: string | null) => {
  if (!value) return null;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('th-TH');
};
const formatAssistantPromptDate = (date: Date) =>
  date.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' });
const formatAssistantPromptWeekday = (date: Date) =>
  date.toLocaleDateString('th-TH', { weekday: 'long' });
const formatAssistantPromptTime = (date: Date) =>
  date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });
const ASSISTANT_INPUT_MAX_HEIGHT = 160;

const isEmptyChatRoom = (room: ChatRoomMeta) => !room.last_message?.trim();

const formatChatMessageTime = (value?: string | null) => {
  if (!value) return '';
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
};
const normalizeAssistantErrorMessage = (error: unknown, fallback: string) => {
  const rawMessage = axios.isAxiosError(error)
    ? String((error.response?.data as { message?: string } | undefined)?.message ?? error.message ?? '').trim()
    : error instanceof Error
    ? error.message.trim()
    : '';
  const normalized = rawMessage.toLowerCase();

  if (
    normalized.includes('sqlstate') ||
    normalized.includes('connection refused') ||
    normalized.includes('could not connect') ||
    normalized.includes('personal_access_tokens') ||
    normalized.includes('mysql')
  ) {
    return 'เชื่อมต่อฐานข้อมูลไม่ได้ชั่วคราว กรุณาเปิด MySQL/XAMPP แล้วลองใหม่อีกครั้ง';
  }

  if (normalized.includes('network error') || normalized.includes('failed to fetch')) {
    return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบว่า backend ยังทำงานอยู่';
  }

  if (normalized.includes('unauthenticated') || normalized.includes('unauthorized') || normalized.includes('401')) {
    return 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่';
  }

  return rawMessage || fallback;
};

// --- Color Conversions ---
const hexToRgbObj = (hex: string) => {
  let r = parseInt(hex.slice(1, 3), 16) || 0;
  let g = parseInt(hex.slice(3, 5), 16) || 0;
  let b = parseInt(hex.slice(5, 7), 16) || 0;
  return { r, g, b };
};

export const CareerAdvisorPage = ({ mode = 'career' }: CareerAdvisorPageProps) => {
  const navigate = useNavigate();
  const { user, token, loading: authLoading } = useAuth();
  const [recommendations, setRecommendations] = useState<RecommendationCard[]>([]);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [selectedSemesterKey, setSelectedSemesterKey] = useState('all');
  const [semesterMenuOpen, setSemesterMenuOpen] = useState(false);
  const [topSubjects, setTopSubjects] = useState<TopSubject[]>([]);
  const [weakSubjects, setWeakSubjects] = useState<WeakSubject[]>([]);
  const [latestQuiz, setLatestQuiz] = useState<LatestQuizInsight | null>(null);
  const [, setInsightsStatus] = useState<'idle' | 'loaded' | 'failed'>('idle');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [analysisProvider, setAnalysisProvider] = useState<string | null>(null);
  const [, setAnalysisRunId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [lastUserPrompt, setLastUserPrompt] = useState('');
  const [assistantMessage, setAssistantMessage] = useState('พร้อมเพิ่มตารางเรียนค่ะ พิมพ์ชื่อวิชา วันที่ เวลา ห้อง และภาคเรียนได้เลย');
  const [isThinking, setIsThinking] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [chatRooms, setChatRooms] = useState<ChatRoomMeta[]>([]);
  const [activeChatRoomId, setActiveChatRoomId] = useState('default');
  const [chatRoomSearch, setChatRoomSearch] = useState('');
  const [currentTime, setCurrentTime] = useState(() => new Date());

  const [selectedTool, setSelectedTool] = useState<'บันทึกเรียน' | 'สรุปบทเรียน' | 'ถามการบ้าน'>('บันทึกเรียน');
  const [attachedFileName, setAttachedFileName] = useState('');
  const [attachmentTrayOpen, setAttachmentTrayOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmState, setConfirmState] = useState<{ title: string; description: string; confirmLabel: string; onConfirm: () => Promise<void> | void } | null>(null);
  const [voiceInputSupported, setVoiceInputSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const attachmentTrayRef = useRef<HTMLDivElement | null>(null);
  const semesterMenuRef = useRef<HTMLDivElement | null>(null);
  const assistantInputRef = useRef<HTMLTextAreaElement | null>(null);
  const homeScrollRef = useRef<HTMLDivElement | null>(null);
  const historyScrollRef = useRef<HTMLDivElement | null>(null);
  const historyInputRef = useRef<HTMLTextAreaElement | null>(null);
  const speechRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const speechRecognitionCtorRef = useRef<any>(null);
  const speechTranscriptBaseRef = useRef('');
  const voiceInputSilenceTimerRef = useRef<number | null>(null);
  const voiceInputAcceptResultsRef = useRef(false);
  const semesterOptions = useSemesterOptions();
  useDefaultSemesterSelection(semesterOptions, selectedSemesterKey, setSelectedSemesterKey);

  const userId = user?.id ?? 0;
  const isAuthenticated = userId > 0;
  const hasAuthToken = Boolean(token);
  const currentAssistantPromptDate = formatAssistantPromptDate(currentTime);
  const currentAssistantPromptWeekday = formatAssistantPromptWeekday(currentTime);
  const currentAssistantPromptTime = formatAssistantPromptTime(currentTime);
  const currentAssistantPromptEndTime = formatAssistantPromptTime(new Date(currentTime.getTime() + 3 * 60 * 60 * 1000));
  const currentAssistantPromptExample = `เพิ่มวิชา คณิต ${currentAssistantPromptWeekday} วันที่ ${currentAssistantPromptDate} ${currentAssistantPromptTime}-${currentAssistantPromptEndTime} ห้อง 102 ภาคเรียนที่ 1 ปีการศึกษา ${currentTime.toLocaleDateString('th-TH', { year: 'numeric' })}`;
  const currentAssistantPromptMultipleExample = 'เพิ่มวิชา ประวัติ วันเสาร์ 12:00-13:00 ห้อง 1235 ภาคเรียนที่ 1 ปีการศึกษา 2569\nและ ชีวะ วันอาทิตย์ 12:00-13:00 ห้อง 1235 ภาคเรียนที่ 1 ปีการศึกษา 2569';

  const activeTheme = useMemo(() => {
    const customHex = '#8b5cf6';
    const rgb = hexToRgbObj(customHex);
    return {
      id: 'custom',
      name: 'Custom',
      accent: customHex,
      accentRgb: `${rgb.r},${rgb.g},${rgb.b}`,
      accentSoft: `rgba(${rgb.r},${rgb.g},${rgb.b},0.12)`,
      accentStrong: customHex,
      surface: 'rgba(255,255,255,0.97)',
      surface2: 'rgba(247,248,255,0.96)',
      text: '#1e293b',
      muted: '#64748b',
      preview: customHex,
      wheel: 'none',
    };
  }, []);

  const mapApiRecommendations = (items: ApiRecommendation[], source: RecommendationCard['source']): RecommendationCard[] =>
    items.map(item => ({
      title: item.career,
      skills: item.skills,
      subjects: item.subjects,
      score: Math.round(item.score ?? 0),
      source,
      reason: item.reason ?? null,
      analysisProvider: item.analysis_provider ?? null,
      analysisGeneratedAt: item.analysis_generated_at ?? item.created_at ?? null,
      analysisRunId: item.analysis_run_id ?? null,
    }));

  const fetchRecommendations = async () => {
    setLoading(true); setError(null); setInfo(null);
    try {
      const response = await api.post<ApiRecommendation[]>('/career/recommendations');
      const items = response.data ?? [];
      const mapped = items.length ? mapApiRecommendations(items, 'history') : [];
      setRecommendations(mapped);
      const latest = mapped[0];
      setLastUpdated(formatAnalysisTime(latest?.analysisGeneratedAt) ?? null);
      setAnalysisProvider(latest?.analysisProvider ?? null);
      setAnalysisRunId(latest?.analysisRunId ?? null);
      return mapped;
    } catch (err) {
      console.error(err); setError(normalizeCareerErrorMessage(err, 'เกิดข้อผิดพลาดในการดึงข้อมูล'));
      return [];
    } finally { setLoading(false); }
  };

  const fetchInsights = async () => {
    try {
      const response = await api.get<{ top_subjects?: TopSubject[]; weak_subjects?: WeakSubject[]; latest_quiz?: LatestQuizInsight | null }>('/career/insights');
      setTopSubjects(response.data?.top_subjects ?? []); setWeakSubjects(response.data?.weak_subjects ?? []); setLatestQuiz(response.data?.latest_quiz ?? null);
      setInsightsStatus('loaded');
    } catch { setInsightsStatus('failed'); }
  };

  const analyzeNow = async () => {
    setLoading(true); setError(null); setInfo(null);
    try {
      const response = await api.post<{ recommendations?: ApiRecommendation[]; top_subjects?: TopSubject[]; weak_subjects?: WeakSubject[]; latest_quiz?: LatestQuizInsight | null; message?: string; analysis_provider?: string | null; analysis_generated_at?: string | null; analysis_run_id?: string | null }>('/career/analyze');
      const recs = response.data?.recommendations ?? [];
      const mapped = recs.length ? mapApiRecommendations(recs, 'generated') : [];
      setRecommendations(mapped);
      setTopSubjects(response.data?.top_subjects ?? []); setWeakSubjects(response.data?.weak_subjects ?? []); setLatestQuiz(response.data?.latest_quiz ?? null);
      const generatedAt = response.data?.analysis_generated_at ?? mapped[0]?.analysisGeneratedAt ?? null;
      const provider = response.data?.analysis_provider ?? mapped[0]?.analysisProvider ?? null;
      const runId = response.data?.analysis_run_id ?? mapped[0]?.analysisRunId ?? null;
      setLastUpdated(formatAnalysisTime(generatedAt) ?? null);
      setAnalysisProvider(provider);
      setAnalysisRunId(runId);
      setInfo(normalizeCareerInfoMessage(response.data?.message)); 
      return mapped;
    } catch (err) {
      console.error(err); setError(normalizeCareerErrorMessage(err, 'เกิดข้อผิดพลาดในการวิเคราะห์'));
      return [];
    } finally { setLoading(false); }
  };

  useEffect(() => {
    if (!userId) return;

    const loadCareerData = async () => {
      void fetchInsights();
      await analyzeNow();
    };

    void loadCareerData();
  }, [userId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(chatRoomStorageKey);
      const parsed = raw ? (JSON.parse(raw) as ChatRoomMeta[]) : [];
      const valid = Array.isArray(parsed) ? parsed.filter(room => room && typeof room.id === 'string' && room.id.trim() !== '') : [];
      if (valid.length > 0) { setChatRooms(valid); setActiveChatRoomId(valid[0].id); } else {
        setChatRooms([{ id: 'default', title: 'แชทหลัก', updated_at: new Date().toISOString() }]); setActiveChatRoomId('default');
      }
    } catch {
      setChatRooms([{ id: 'default', title: 'แชทหลัก', updated_at: new Date().toISOString() }]); setActiveChatRoomId('default');
    }
  }, []); 

  useEffect(() => {
    if (mode !== 'home' || typeof window === 'undefined') return;
    const tick = () => setCurrentTime(new Date());
    tick();
    const intervalId = window.setInterval(tick, 1000);
    return () => window.clearInterval(intervalId);
  }, [mode]);

  const loadSubjects = async () => {
    try {
      const res = await api.get('/subjects');
      const payload = Array.isArray(res.data) ? res.data : res.data?.data;
      const list: SubjectOption[] = Array.isArray(payload) ? payload.map((item: any) => ({ id: Number(item.id), name: String(item.name ?? item.subject_name ?? ''), semester_id: toNumberOrNull(item.semester_id), semester: toNumberOrNull(item.semester), academic_year: toNumberOrNull(item.academic_year) })) : [];
      setSubjects(list.filter(item => Number.isFinite(item.id) && item.name.trim() !== ''));
    } catch { setSubjects([]); }
  };

  useEffect(() => {
    void loadSubjects();
    return subscribeSubjectsUpdated(() => { void loadSubjects(); });
  }, []);

  const filteredSubjects = useMemo(() => filterBySemester(subjects, selectedSemesterKey), [subjects, selectedSemesterKey]);
  const filteredSubjectNameSet = useMemo(() => new Set(filteredSubjects.map(subject => subject.name.trim().toLowerCase()).filter(Boolean)), [filteredSubjects]);

  const displayedRecommendations = recommendations.filter(rec => {
    if (selectedSemesterKey === 'all') return true;
    const recSubjects = rec.subjects.split(',').map(subject => subject.trim().toLowerCase()).filter(Boolean);
    return recSubjects.some(subject => filteredSubjectNameSet.has(subject));
  });

  const primaryRecommendation = displayedRecommendations.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0] ?? null;
  const prioritizedSkills = Array.from(new Set((primaryRecommendation ? [primaryRecommendation, ...displayedRecommendations] : displayedRecommendations).flatMap(rec => (rec.skills ?? '').split(',').map(skill => skill.trim()).filter(Boolean)))).slice(0, 10);

  const recommendationTone = (() => {
    return {
      track: 'bg-[color:var(--surface-2)]',
      fill: 'bg-[color:var(--accent)]',
      label: 'text-[color:var(--muted)]',
      title: 'text-[color:var(--accent-ink)]'
    };
  })();

  const filteredChatRooms = chatRooms.filter(room => {
    const q = chatRoomSearch.trim().toLowerCase();
    if (!q) return true;
    return (room.title.toLowerCase().includes(q) || (room.last_message ?? '').toLowerCase().includes(q));
  });

  const chatRoomStorageKey = `smartroom-chat-rooms-${userId || 'guest'}`;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const worthKeeping = chatRooms.filter(room => !isEmptyChatRoom(room));
    window.localStorage.setItem(chatRoomStorageKey, JSON.stringify(worthKeeping));
  }, [chatRoomStorageKey, chatRooms]);

  const upsertChatRoomMeta = (
    roomId: string,
    patch: Partial<Pick<ChatRoomMeta, 'title' | 'last_message' | 'updated_at'>>,
    options?: { touch?: boolean }
  ) => {
    const touch = options?.touch ?? true;
    setChatRooms(prev => {
      const nowIso = patch.updated_at ?? new Date().toISOString();
      const next = [...prev];
      const index = next.findIndex(room => room.id === roomId);
      const cleanTitle = patch.title?.trim();
      if (index >= 0) {
        const keptTimestamp = touch ? nowIso : next[index].updated_at;
        next[index] = {
          ...next[index],
          ...(cleanTitle ? { title: cleanTitle } : {}),
          ...(patch.last_message !== undefined ? { last_message: patch.last_message } : {}),
          updated_at: keptTimestamp,
        };
      } else {
        next.push({ id: roomId, title: cleanTitle || `แชท ${prev.length + 1}`, updated_at: nowIso, last_message: patch.last_message });
      }
      return next.slice().sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    });
  };
  const canSendChat = inputText.trim().length > 0 && !isThinking && hasAuthToken;

  useEffect(() => {
    if (!historyOpen) return;
    const container = historyScrollRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [historyOpen, activeChatRoomId, chatMessages, chatLoading]);

  useEffect(() => {
    if (!historyOpen || typeof window === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHistoryOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [historyOpen]);

  useEffect(() => {
    [assistantInputRef.current, historyInputRef.current].forEach(field => {
      if (!field) return;
      field.style.height = 'auto';
      field.style.height = `${Math.min(field.scrollHeight, ASSISTANT_INPUT_MAX_HEIGHT)}px`;
    });
  }, [inputText, historyOpen]);

  useEffect(() => {
    if (mode !== 'home') return;
    const container = homeScrollRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [chatMessages, isThinking, mode]);

  const appendAssistantTemplate = (template: string) => {
    setInputText(previous => previous.trim() ? `${previous}\n${template}` : template);
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        const input = assistantInputRef.current;
        if (!input) return;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      });
    }
  };

  // A timetable entry needs a weekday and a time range.  Keep those fields in
  // every template; otherwise the API can only create an unscheduled subject.
  const scheduleTemplate = 'เพิ่มวิชา ประวัติ วันเสาร์ 12:00-13:00 ห้อง 1235 ภาคเรียนที่ 1 ปีการศึกษา 2569';
  const multipleScheduleTemplate = 'เพิ่มวิชา ประวัติ วันเสาร์ 12:00-13:00 ห้อง 1235 ภาคเรียนที่ 1 ปีการศึกษา 2569\nและ ชีวะ วันอาทิตย์ 12:00-13:00 ห้อง 1235 ภาคเรียนที่ 1 ปีการศึกษา 2569';

  const deleteChatHistoryFromServer = async (roomId: string) => {
    try {
      await api.delete('/assistant/chat/history', { params: { room_id: roomId } });
    } catch (deleteError) {
      await api.post('/assistant/chat/history/delete', { room_id: roomId }).catch(() => {
        throw deleteError;
      });
    }
  };
  
  const quickActions = [
    { id: 'study-digest', label: 'สรุปการเรียน', to: '/study-digest', iconClassName: 'text-white', tileStyle: { backgroundColor: '#059669' }, icon: (<svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="#ffffff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 5h14" /><path d="M5 12h14" /><path d="M5 19h9" /><path d="M18 17v4" /><path d="M16 19h4" /></svg>) }
  ];
  const storageAction = { id: 'study-storage', label: 'กระเป๋าเก็บไฟล์', to: '/study-storage', iconClassName: 'text-white', tileStyle: { background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' }, icon: (<svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" /><path d="M10 12h4" /></svg>) };
  const quickActionItems = [...quickActions, storageAction];
  const [smartMenuOffset, setSmartMenuOffset] = useState({ x: 0, y: 0 });
  const [isDraggingSmartMenu, setIsDraggingSmartMenu] = useState(false);
  const smartMenuDragStartRef = useRef<{ x: number; y: number; pointerX: number; pointerY: number } | null>(null);
  const [isDesktopLike, setIsDesktopLike] = useState(() => typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)').matches : true);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false);
  const lowFxMode = !isDesktopLike || prefersReducedMotion;

  const clearVoiceInputSilenceTimer = () => {
    if (typeof window === 'undefined' || voiceInputSilenceTimerRef.current === null) return;
    window.clearTimeout(voiceInputSilenceTimerRef.current);
    voiceInputSilenceTimerRef.current = null;
  };

  useEffect(() => {
    if (!isDraggingSmartMenu) return;
    const handlePointerMove = (event: PointerEvent) => {
      const dragStart = smartMenuDragStartRef.current;
      if (!dragStart) return;
      const nextX = dragStart.x + (event.clientX - dragStart.pointerX);
      const nextY = dragStart.y + (event.clientY - dragStart.pointerY);
      setSmartMenuOffset({ x: nextX, y: nextY });
    };
    const handlePointerUp = () => { setIsDraggingSmartMenu(false); smartMenuDragStartRef.current = null; };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => { window.removeEventListener('pointermove', handlePointerMove); window.removeEventListener('pointerup', handlePointerUp); };
  }, [isDraggingSmartMenu]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(min-width: 1024px)');
    const apply = () => setIsDesktopLike(media.matches);
    apply();
    if (typeof media.addEventListener === 'function') { media.addEventListener('change', apply); return () => media.removeEventListener('change', apply); }
    media.addListener(apply); return () => media.removeListener(apply);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setPrefersReducedMotion(media.matches);
    apply();
    if (typeof media.addEventListener === 'function') { media.addEventListener('change', apply); return () => media.removeEventListener('change', apply); }
    media.addListener(apply); return () => media.removeListener(apply);
  }, []);

  const stopVoiceInput = () => {
    clearVoiceInputSilenceTimer(); voiceInputAcceptResultsRef.current = false; speechTranscriptBaseRef.current = '';
    if (!speechRecognitionRef.current) { setIsListening(false); return; }
    try { speechRecognitionRef.current.stop(); } catch { /* ignore */ }
  };

  const scheduleVoiceInputSilenceTimer = () => {
    if (typeof window === 'undefined') return;
    clearVoiceInputSilenceTimer();
    voiceInputSilenceTimerRef.current = window.setTimeout(() => { stopVoiceInput(); }, 3000);
  };

  const submitAssistantPrompt = async (prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed || isThinking || !hasAuthToken) return;
    if (/เพิ่ม\s*วิชา/iu.test(trimmed) && /\[[^\]\r\n]+\]/u.test(trimmed)) {
      setChatError('กรุณาแทนที่ข้อความในวงเล็บ [ ] ให้ครบก่อนส่ง เช่น วันจันทร์ วันที่ 26/08/2569 และเวลา 09:00-12:00');
      return;
    }
    stopVoiceInput();
    const attachmentUrl = attachedFileName.trim() !== '' ? attachedFileName.trim() : null;
    const optimisticUserMessage: ChatMessage = {
      id: -Date.now(),
      user_id: String(userId || 'guest'),
      room_id: activeChatRoomId,
      sender_type: 'user',
      message: trimmed,
      attachment_url: attachmentUrl,
      created_at: new Date().toISOString(),
    };
    setLastUserPrompt(trimmed);
    setChatMessages(prev => [...prev, optimisticUserMessage]);
    setInputText(''); setIsThinking(true); setChatError(null);
    try {
      const response = await api.post<{ room_id: string; messages?: ChatMessage[]; assistant_message?: ChatMessage; schedule_updated?: boolean; subjects_updated?: boolean; }>('/assistant/chat/message', { room_id: activeChatRoomId, message: trimmed, tool: selectedTool, attachment_url: attachmentUrl });
      const nextMessages = response.data?.messages ?? [];
      setChatMessages(nextMessages.length > 0 ? nextMessages : response.data?.assistant_message ? [optimisticUserMessage, response.data.assistant_message] : [optimisticUserMessage]);
      upsertChatRoomMeta(activeChatRoomId, { title: trimmed.slice(0, 28) || undefined, last_message: trimmed });
      const latestAssistant = response.data?.assistant_message ?? [...nextMessages].reverse().find(message => message.sender_type === 'assistant');
      const nextAssistantMessage = normalizeAssistantFallback(latestAssistant?.message ?? '') || 'ตอบกลับเรียบร้อยแล้วครับ มีอะไรให้ช่วยต่อได้อีกไหม?';
      setAssistantMessage(nextAssistantMessage);
      if (response.data?.subjects_updated) {
        emitSubjectsUpdated({ revealSchedule: response.data.schedule_updated });
      }
      if (response.data?.schedule_updated) {
        navigate('/overview');
      }
      setAttachedFileName(''); setAttachmentTrayOpen(false);
    } catch (err) {
      console.error(err);
      setChatError(normalizeAssistantErrorMessage(err, 'ไม่สามารถส่งข้อความได้ในขณะนี้'));
      setAssistantMessage('ส่งข้อความไม่สำเร็จ ลองอีกครั้งได้เลยครับ');
    } finally { setIsThinking(false); }
  };


  const clearChatHistory = async () => {
    if (clearingHistory) return;
        setConfirmState({
      title: 'ลบประวัติการสนทนา',
      description: 'ต้องการลบประวัติการสนทนาทั้งหมดในห้องนี้ใช่หรือไม่?',
      confirmLabel: 'ลบประวัติ',
      onConfirm: async () => {
        setClearingHistory(true);
        setChatError(null);
        try {
          await deleteChatHistoryFromServer(activeChatRoomId);
          setChatMessages([]);
          setLastUserPrompt('');
          setAssistantMessage('เครื่องมือเพิ่มตารางเรียนพร้อมใช้งานค่ะ พิมพ์เพิ่มวิชาพร้อมวัน วันที่ เวลา ห้อง และภาคเรียนได้เลย หรือพิมพ์หลายวิชาแยกคนละบรรทัดค่ะ');
          upsertChatRoomMeta(activeChatRoomId, { last_message: '' });
        } catch (err) {
          console.error(err);
          setChatError(normalizeAssistantErrorMessage(err, 'ลบประวัติการสนทนาไม่สำเร็จ'));
        } finally {
          setClearingHistory(false);
          setConfirmState(null);
        }
      },
    });
  };

  const deleteChatRoom = async (roomId: string) => {
    const room = chatRooms.find(item => item.id === roomId);
    if (!room) return;
    setChatError(null);

    const remainingRooms = chatRooms.filter(item => item.id !== roomId);
    if (remainingRooms.length > 0) {
      setChatRooms(remainingRooms);
      if (activeChatRoomId === roomId) {
        setActiveChatRoomId(remainingRooms[0].id);
        setChatMessages([]);
        setLastUserPrompt('');
      }
    } else {
      const fallbackRoom: ChatRoomMeta = { id: `room-${Date.now()}`, title: 'แชทใหม่', updated_at: new Date().toISOString(), last_message: '' };
      setChatRooms([fallbackRoom]);
      setActiveChatRoomId(fallbackRoom.id);
      setChatMessages([]);
      setLastUserPrompt('');
    }

    try {
      await deleteChatHistoryFromServer(roomId);
    } catch (err) {
      console.error(err);
      setChatError('ลบหัวข้อออกจากรายการแล้ว แต่ลบประวัติบนเซิร์ฟเวอร์ไม่สำเร็จ');
    }
  };

  const handleConfirmDialogCancel = () => {
    setConfirmState(null);
  };

  const handleConfirmDialogConfirm = async () => {
    if (!confirmState) return;
    try {
      console.log('Confirm clicked:', { title: confirmState.title, description: confirmState.description });
      setConfirmBusy(true);
      await confirmState.onConfirm();
      console.log('Confirm handler finished for:', { title: confirmState.title });
    } finally {
      setConfirmBusy(false);
    }
  };

  const handleAssistantSubmit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); submitAssistantPrompt(inputText); };

 

  const resetChatComposerState = () => {
    setChatMessages([]);
    setInputText('');
    setLastUserPrompt('');
    setAttachedFileName('');
    setAssistantMessage('เริ่มแชทใหม่แล้วค่ะ พิมพ์รูปแบบเพิ่มตารางเรียน หรือพิมพ์หลายวิชาแยกคนละบรรทัดได้เลย');
    setChatError(null);
  };

  const createNewChatRoom = () => {
    const activeRoom = chatRooms.find(room => room.id === activeChatRoomId);

    // Already sitting in a blank room - reuse it instead of stacking up more.
    if (activeRoom && isEmptyChatRoom(activeRoom) && chatMessages.length === 0) {
      resetChatComposerState();
      return;
    }

    const roomId = `room-${Date.now()}`;
    setChatRooms(prev => {
      const used = prev.filter(room => !isEmptyChatRoom(room) || room.id === activeChatRoomId);
      const stillUsed = used.filter(room => !isEmptyChatRoom(room));
      return [
        { id: roomId, title: `แชทใหม่ ${stillUsed.length + 1}`, updated_at: new Date().toISOString(), last_message: '' },
        ...stillUsed,
      ];
    });
    setActiveChatRoomId(roomId);
    resetChatComposerState();
  };

  const startVoiceInput = () => {
    if (typeof window === 'undefined' || !speechRecognitionCtorRef.current || isThinking) return;
    setChatError(null); speechTranscriptBaseRef.current = inputText.trim(); voiceInputAcceptResultsRef.current = true;
    try {
      const recognition: BrowserSpeechRecognition = new speechRecognitionCtorRef.current();
      recognition.lang = 'th-TH'; recognition.continuous = true; recognition.interimResults = true;
      recognition.onresult = (event: any) => {
        if (!voiceInputAcceptResultsRef.current || speechRecognitionRef.current !== recognition) return;
        const transcript = Array.from(event.results ?? []).map((item: any) => item?.[0]?.transcript ?? '').join(' ').replace(/\s+/g, ' ').trim();
        const base = speechTranscriptBaseRef.current;
        const nextText = transcript ? [base, transcript].filter(Boolean).join(base ? ' ' : '') : base;
        setInputText(nextText); scheduleVoiceInputSilenceTimer();
      };
      recognition.onerror = () => { clearVoiceInputSilenceTimer(); voiceInputAcceptResultsRef.current = false; setChatError('ไม่สามารถใช้งานไมค์เพื่อแปลงเสียงเป็นข้อความได้ในขณะนี้'); setIsListening(false); speechRecognitionRef.current = null; };
      recognition.onend = () => { clearVoiceInputSilenceTimer(); voiceInputAcceptResultsRef.current = false; setIsListening(false); speechRecognitionRef.current = null; };
      recognition.start(); speechRecognitionRef.current = recognition; setIsListening(true); scheduleVoiceInputSilenceTimer();
    } catch { clearVoiceInputSilenceTimer(); voiceInputAcceptResultsRef.current = false; setChatError('อุปกรณ์หรือเบราว์เซอร์นี้ไม่รองรับการพูดเป็นข้อความ'); setIsListening(false); speechRecognitionRef.current = null; }
  };

  useEffect(() => {
    if (!attachmentTrayOpen || typeof document === 'undefined') return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (attachmentTrayRef.current?.contains(target)) return;
      setAttachmentTrayOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown); document.addEventListener('touchstart', handlePointerDown);
    return () => { document.removeEventListener('mousedown', handlePointerDown); document.removeEventListener('touchstart', handlePointerDown); };
  }, [attachmentTrayOpen]);

  useEffect(() => {
    if (!semesterMenuOpen || typeof document === 'undefined') return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (target && !semesterMenuRef.current?.contains(target)) setSemesterMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSemesterMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [semesterMenuOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const SpeechRecognitionCtor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null;
    speechRecognitionCtorRef.current = SpeechRecognitionCtor; setVoiceInputSupported(Boolean(SpeechRecognitionCtor));
    return () => { stopVoiceInput(); };
  }, []);

  useEffect(() => {
    if (mode !== 'home' || !hasAuthToken) return;
    let cancelled = false;
    const loadChatHistory = async () => {
      setChatLoading(true); setChatError(null);
      try {
        const response = await api.get<{ messages?: ChatMessage[] }>('/assistant/chat/history', { params: { room_id: activeChatRoomId, limit: 50 } });
        if (cancelled) return;
        const messages = response.data?.messages ?? [];
        setChatMessages(messages);
        const latestMessage = [...messages].reverse().find(message => (message.message ?? '').trim() !== '');
        const firstUserMessage = messages.find(message => message.sender_type === 'user' && message.message?.trim());
        const latestUserMessage = [...messages].reverse().find(message => message.sender_type === 'user' && message.message?.trim());
        setLastUserPrompt(latestUserMessage?.message?.trim() ?? '');
        upsertChatRoomMeta(
          activeChatRoomId,
          { title: firstUserMessage?.message?.trim()?.slice(0, 28), last_message: latestMessage?.message?.trim() || '' },
          { touch: false }
        );
        const latestAssistant = [...messages].reverse().find(message => message.sender_type === 'assistant');
        if (latestAssistant?.message?.trim()) { setAssistantMessage(normalizeAssistantFallback(latestAssistant.message)); } else { setAssistantMessage('พร้อมเพิ่มตารางเรียนค่ะ พิมพ์ชื่อวิชา วัน วันที่ เวลา ห้อง และภาคเรียนได้เลย'); }
      } catch (err) {
        if (cancelled) return; console.error(err);
        setChatError(normalizeAssistantErrorMessage(err, 'โหลดประวัติการคุยไม่สำเร็จ'));
      } finally { if (!cancelled) setChatLoading(false); }
    };
    void loadChatHistory(); return () => { cancelled = true; };
  }, [activeChatRoomId, hasAuthToken, mode]);

  useEffect(() => {
    if (mode !== 'home' || typeof window === 'undefined') return;
    const handleHomeMenuClose = () => { setAttachmentTrayOpen(false); setHistoryOpen(false); };
    window.addEventListener('smartroom:home-menu-pressed', handleHomeMenuClose);
    return () => { window.removeEventListener('smartroom:home-menu-pressed', handleHomeMenuClose); };
  }, [mode]);

  if (mode === 'home') {
    return (
      <div
        className="smart-home-root relative flex h-[calc(100dvh-13rem)] min-h-[520px] flex-col overflow-hidden md:h-full"
      >
        <style>{`
          @keyframes save-wiggle { 0%, 100% { transform: translateY(0) rotate(0deg) scale(1); } 10% { transform: translateY(-3px) rotate(-2.4deg) scale(1.02); } 20% { transform: translateY(2px) rotate(2.4deg) scale(1.04); } 30% { transform: translateY(-2px) rotate(-1.8deg) scale(1.02); } 40% { transform: translateY(1px) rotate(1.2deg) scale(1.01); } 50%, 90% { transform: translateY(0) rotate(0deg) scale(1); } }
          .smart-home-root { -webkit-font-smoothing: antialiased; }
          .smart-home-scroll { scrollbar-gutter: stable; scroll-behavior: smooth; overscroll-behavior-y: contain; }
          @keyframes welcomeIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
          .smart-home-welcome { animation: welcomeIn .5s cubic-bezier(0.22, 1, 0.36, 1) both; }
          .smart-home-root button, .smart-home-root a, .smart-home-root summary {
            transition-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
          }
          .smart-home-root .schedule-guide { transition: box-shadow .4s cubic-bezier(0.22, 1, 0.36, 1); }
          @media (prefers-reduced-motion: reduce) {
            .smart-home-welcome { animation: none; }
            .smart-home-scroll { scroll-behavior: auto; }
          }
          .smart-home-input-shell { transition: box-shadow .3s ease, border-color .3s ease; }
          .smart-home-input-shell:focus-within { box-shadow: 0 0 0 4px rgba(var(--accent-rgb), 0.15) !important; border-color: var(--accent) !important; }
          @media (max-width: 640px) {
            .schedule-assistant-message { font-size: 15px; line-height: 1.7rem; }
            .schedule-helper-text { font-size: 12px; }
            .schedule-examples { font-size: 12px; line-height: 1.55rem; }
          }
          @media (min-width: 641px) {
            .schedule-assistant-message { font-size: 15px; line-height: 1.75rem; }
            .schedule-helper-text { font-size: 12px; }
            .schedule-examples { font-size: 12.5px; line-height: 1.6rem; }
          }
        `}</style>
        <div className="absolute inset-0" style={{ background: 'var(--bg)' }} />
        <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(rgba(0,0,0,0.03) 1px, transparent 1px)', backgroundSize: '32px 32px' }} />

        {historyOpen && typeof document !== 'undefined' ? createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-stretch justify-center bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.92),_rgba(236,238,255,0.94)_42%,_rgba(225,230,255,0.88)_100%)] backdrop-blur-md md:items-center md:p-4"
            style={{ background: 'rgba(0,0,0,0.28)' }}
            onClick={() => setHistoryOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label="ประวัติการสนทนา"
          >
            <div
              className="flex h-[100dvh] w-full max-w-[1440px] flex-col overflow-hidden border border-black/5 md:h-[88dvh] md:flex-row md:rounded-[2rem]"
              style={{ background: 'var(--surface)', boxShadow: '0 24px 80px rgba(0,0,0,0.18)' }}
              onClick={event => event.stopPropagation()}
            >
              <aside className="w-full border-b md:max-w-[340px] md:border-b-0 md:border-r" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
                <div className="flex h-full flex-col px-5 pb-5 pt-[max(1.35rem,env(safe-area-inset-top))] md:px-6 md:pt-6">
                  <div className="mb-4 flex items-center justify-between">
                    <p className="text-[18px] font-semibold tracking-tight text-[color:var(--text)]">แชทของฉัน</p>
                    <button type="button" onClick={() => setHistoryOpen(false)} className="grid h-9 w-9 place-items-center rounded-full border border-black/5 bg-white text-[color:var(--muted)] transition hover:text-[color:var(--text)]" style={{ boxShadow: 'var(--shadow-soft)' }} aria-label="ปิดล็อบบี้">
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                    </button>
                  </div>
                  <button type="button" onClick={createNewChatRoom} className="mb-4 inline-flex w-full items-center justify-center gap-2 rounded-full px-4 py-3 text-[14px] font-medium transition active:scale-95" style={{ background: 'var(--accent)', color: '#ffffff', boxShadow: '0 4px 14px rgba(var(--accent-rgb),0.25)' }}>
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14" /><path d="M5 12h14" /></svg> เริ่มแชทใหม่
                  </button>
                  <div className="mb-4 flex items-center gap-2 rounded-full border border-black/5 bg-white px-4 py-2.5" style={{ boxShadow: 'var(--shadow-soft)' }}>
                    <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
                    <input value={chatRoomSearch} onChange={event => setChatRoomSearch(event.target.value)} placeholder="ค้นหาแชท" className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400" />
                  </div>
                  <div className="mb-3 flex items-center justify-between px-1">
                    <span className="text-[11px] font-medium text-[color:var(--muted)]">{filteredChatRooms.length} หัวข้อ</span>
                    {chatRoomSearch ? (<button type="button" onClick={() => setChatRoomSearch('')} className="text-[11px] font-medium text-[color:var(--muted)] transition hover:text-[color:var(--accent)]">ล้างค้นหา</button>) : null}
                  </div>
                  <div className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain px-1 pb-2 pr-4 md:mx-0 md:block md:max-h-[calc(92dvh-16rem)] md:space-y-2 md:overflow-y-auto md:overscroll-contain md:px-0 md:pb-0 md:pr-1">
                    {filteredChatRooms.map(room => (
                      <div key={room.id} className={`group flex min-w-[min(78vw,18rem)] snap-start items-center gap-3 rounded-2xl border p-3 transition md:min-w-0 ${room.id === activeChatRoomId ? 'border-[color:rgba(var(--accent-rgb),0.35)]' : 'border-black/5 hover:bg-white'}`} style={{ background: room.id === activeChatRoomId ? 'rgba(var(--accent-rgb),0.08)' : 'var(--surface)' }}>
                        <button type="button" onClick={() => { setActiveChatRoomId(room.id); setChatError(null); }} className="min-w-0 flex-1 px-1.5 py-1.5 text-left">
                          <p className="truncate text-[14px] font-medium text-[color:var(--text)]">{room.title || 'แชทไม่มีชื่อ'}</p>
                          <p className="mt-1 truncate text-[12px] text-slate-500">{room.last_message || 'ยังไม่มีข้อความ'}</p>
                        </button>
                        <button type="button" onClick={(event) => { event.stopPropagation(); void deleteChatRoom(room.id); }} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-500 md:h-8 md:w-8 md:bg-white/70 md:opacity-100" aria-label={`ลบหัวข้อ ${room.title || 'แชทไม่มีชื่อ'}`} title="ลบหัวข้อแชท">
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="m19 6-1 14H6L5 6" /><path d="M10 11v5M14 11v5" /></svg>
                        </button>
                      </div>
                    ))}
                    {filteredChatRooms.length === 0 ? (<div className="w-full shrink-0 rounded-[1.25rem] border border-dashed border-white/80 bg-white/70 px-3 py-6 text-center text-xs text-slate-500 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">ไม่พบหัวข้อแชท</div>) : null}
                  </div>

                  <div className="mt-auto hidden rounded-2xl border border-black/5 p-4 md:block" style={{ background: 'var(--surface-2)' }}>
                    <div className="flex items-center gap-3">
                      <div className="grid h-12 w-12 place-items-center rounded-2xl" style={{ background: 'var(--accent)', color: '#ffffff' }}>
                        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" /><path d="M8 9h8M8 13h5" /></svg>
                      </div>
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-[color:var(--text)]">เริ่มการสนทนาใหม่</p>
                        <p className="mt-1 text-[12px] leading-5 text-slate-500">พิมพ์ข้อความแล้วให้ผู้ช่วยช่วยคิดต่อได้เลย</p>
                      </div>
                      <button type="button" onClick={createNewChatRoom} className="ml-auto rounded-full border border-black/5 bg-white px-3 py-2 text-[12px] font-medium text-[color:var(--accent)] transition hover:bg-slate-50">เริ่ม</button>
                    </div>
                  </div>
                </div>
              </aside>

              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="flex shrink-0 items-center gap-4 border-b px-5 py-4 md:px-7 md:py-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[color:var(--muted)]">Chat History</p>
                    <h3 className="mt-1 truncate text-lg font-semibold tracking-tight text-[color:var(--text)] md:text-[22px]">{chatRooms.find(room => room.id === activeChatRoomId)?.title ?? 'ประวัติการสนทนา'}</h3>
                    <p className="mt-0.5 text-[12px] text-[color:var(--muted)]">{chatMessages.length > 0 ? `${chatMessages.length} ข้อความ` : 'ยังไม่มีข้อความ'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setHistoryOpen(false)}
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-black/5 bg-white text-[color:var(--muted)] transition hover:bg-slate-50 hover:text-[color:var(--text)]"
                    style={{ boxShadow: 'var(--shadow-soft)' }}
                    aria-label="ปิดประวัติการสนทนา"
                    title="ปิด"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                  </button>
                </div>

                <div ref={historyScrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8" style={{ scrollbarGutter: 'stable' }}>
                  {chatLoading ? (
                    <div className="rounded-2xl border border-black/5 bg-white px-4 py-4 text-[13px] text-[color:var(--muted)]" style={{ boxShadow: 'var(--shadow-soft)' }}>กำลังโหลดประวัติการคุย...</div>
                  ) : chatMessages.length === 0 ? (
                    <div className="mx-auto mt-8 max-w-md rounded-3xl border border-black/5 bg-white px-6 py-10 text-center" style={{ boxShadow: 'var(--shadow-float)' }}>
                      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl text-[color:var(--accent)]" style={{ background: 'rgba(var(--accent-rgb),0.12)' }}><svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" /></svg></div>
                      <p className="mt-4 text-[18px] font-semibold tracking-tight text-[color:var(--text)]">เริ่มบทสนทนาใหม่</p>
                    <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">เพิ่มหลายวิชาได้ในข้อความเดียว: พิมพ์แยกบรรทัดหรือใช้รายการเลขลำดับ แล้วกด Shift + Enter เพื่อขึ้นบรรทัดใหม่</p>
                    </div>
                  ) : (
                    <div className="mx-auto max-w-4xl space-y-5">
                      {chatMessages.slice(-40).map(message => {
                        const isAssistant = message.sender_type === 'assistant';
                        return (
                          <div key={message.id} className={`group flex items-start gap-3 ${isAssistant ? 'justify-start' : 'justify-end'}`}>
                            {isAssistant ? (<div className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-medium" style={{ background: 'var(--accent)', color: '#ffffff' }}>AI</div>) : null}
                            <div className="max-w-[85%] md:max-w-[68%]">
                              <div className={`relative w-fit min-w-[5rem] rounded-2xl px-4 py-2.5 text-left ${isAssistant ? 'rounded-bl-md border border-black/5 bg-white text-[color:var(--text)] shadow-[var(--shadow-soft)]' : 'ml-auto rounded-br-md'}`} style={isAssistant ? undefined : { background: 'var(--accent)' }}>
                                <p className="whitespace-pre-wrap break-words text-[14px] leading-7 md:text-[15px]">{isAssistant ? normalizeAssistantFallback(message.message) : message.message}</p>
                                <p className="mt-1.5 text-[10px]" style={isAssistant ? { color: 'var(--muted)' } : { color: 'rgba(255,255,255,0.75)' }}>{formatChatMessageTime(message.created_at)}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {isThinking ? (
                        <div className="flex items-start gap-3">
                          <div className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-medium" style={{ background: 'var(--accent)', color: '#ffffff' }}>AI</div>
                          <div className="flex items-center gap-1.5 rounded-3xl rounded-bl-lg border border-black/5 bg-white px-4 py-4 shadow-[var(--shadow-soft)]">
                            <span className="h-2 w-2 animate-bounce rounded-full bg-[color:var(--accent)] opacity-40 [animation-delay:-0.2s]" />
                            <span className="h-2 w-2 animate-bounce rounded-full bg-[color:var(--accent)] opacity-70 [animation-delay:-0.1s]" />
                            <span className="h-2 w-2 animate-bounce rounded-full bg-[color:var(--accent)]" />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>

                <div className="shrink-0 border-t px-3 pb-[max(0.9rem,env(safe-area-inset-bottom))] pt-3 md:px-6 md:pb-5 md:pt-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                  {chatError ? (<p className="mx-auto mb-2 max-w-4xl rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600">{chatError}</p>) : null}
                  <form onSubmit={handleAssistantSubmit} className="mx-auto flex max-w-4xl items-end gap-2">
                    <div className="flex min-h-[56px] flex-1 items-end rounded-[2rem] border border-white/80 bg-white px-4 py-2 shadow-[0_16px_34px_rgba(15,23,42,0.06)] transition focus-within:border-violet-300 focus-within:ring-4 focus-within:ring-violet-100">
                      <textarea ref={historyInputRef} value={inputText} onChange={event => setInputText(event.target.value)} placeholder={`เช่น ${currentAssistantPromptExample}`} disabled={isThinking} rows={1} style={{ maxHeight: `${ASSISTANT_INPUT_MAX_HEIGHT}px` }} className="min-h-[28px] flex-1 resize-none overflow-y-auto bg-transparent py-2 text-[15px] leading-7 text-[color:var(--text)] outline-none placeholder:text-[color:var(--muted)]" onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submitAssistantPrompt(inputText); } }} />
                      <button type="button" onClick={isListening ? stopVoiceInput : startVoiceInput} disabled={!voiceInputSupported || isThinking} className={`mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition disabled:opacity-40 ${isListening ? 'bg-rose-500/10 text-rose-500' : 'text-[color:var(--muted)] hover:bg-slate-100 hover:text-[color:var(--accent)]'}`} aria-label={isListening ? 'หยุดฟังเสียง' : 'พูดเป็นข้อความ'}>
                        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2" /><path d="M12 19v2" /></svg>
                      </button>
                    </div>
                    <button type="submit" disabled={!canSendChat} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40" style={{ background: 'var(--accent)', color: '#ffffff', boxShadow: '0 4px 14px rgba(var(--accent-rgb),0.25)' }} aria-label="ส่งข้อความ">
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13" /><path d="M22 2 15 22 11 13 2 9 22 2Z" /></svg>
                    </button>
                  </form>
                </div>
              </div>
            </div>
          </div>,
          document.body
        ) : null}

        <div className="smart-home-stack schedule-chat-card relative z-10 flex h-full min-h-0 w-full flex-col overflow-hidden">
          <div className="pointer-events-none absolute right-4 top-[178px] hidden w-[220px]">
            <div className={`pointer-events-auto rounded-[1.75rem] border p-4 backdrop-blur-sm ${isDraggingSmartMenu ? 'select-none' : ''}`} style={{ borderColor: 'var(--border)', background: isDesktopLike ? 'color-mix(in srgb, var(--surface) 94%, transparent)' : 'var(--surface)', boxShadow: isDesktopLike ? 'var(--shadow-soft)' : 'none', transform: `translate3d(${smartMenuOffset.x}px, ${smartMenuOffset.y}px, 0)`, transition: isDraggingSmartMenu ? 'none' : 'transform 120ms ease', willChange: 'transform', contain: 'layout paint' }} title="ลาก Smart Menu ไปตำแหน่งที่ต้องการ">
              <div className="mb-3 flex items-center justify-between" style={{ cursor: isDraggingSmartMenu ? 'grabbing' : 'grab' }} onPointerDown={event => { if (event.button !== 0) return; if (!isDesktopLike) return; smartMenuDragStartRef.current = { x: smartMenuOffset.x, y: smartMenuOffset.y, pointerX: event.clientX, pointerY: event.clientY }; setIsDraggingSmartMenu(true); }}>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[color:var(--accent)]">Smart Menu</p>
                <span className="text-slate-400" title="ลากเพื่อย้ายตำแหน่ง" aria-label="ลากได้"><svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2" /><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2" /><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8" /><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" /></svg></span>
              </div>
              <div className="space-y-2.5" style={{ maxHeight: '58vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehaviorY: 'contain', scrollbarWidth: 'thin' }}>
                {quickActionItems.map(action => (
                  <button key={action.id} type="button" onClick={() => navigate(action.to)} className="group flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition hover:-translate-y-0.5 motion-reduce:transition-none" style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--surface) 94%, transparent)', boxShadow: isDesktopLike ? '0 6px 14px rgba(var(--accent-rgb),0.06)' : 'none' }}>
                    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[1rem] border border-white/80 shadow-[0_8px_18px_rgba(15,23,42,0.05)] ${action.iconClassName}`} style={action.tileStyle}>{action.icon}</span>
                    <span className="min-w-0"><span className="block text-[12px] font-semibold leading-5 text-[color:var(--text)]">{action.label}</span><span className="block text-[10px] text-[color:var(--muted)]">{action.id === 'study-storage' ? 'รวมไฟล์แนบไว้ในที่เดียว' : 'เปิดใช้งานได้ทันที'}</span></span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="relative z-30 flex h-[72px] shrink-0 items-center justify-between gap-3 border-b px-4 sm:px-6 lg:px-10" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full shadow-md" style={{ background: 'var(--accent)', color: '#ffffff' }}>
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="8" width="14" height="9" rx="4" /><path d="M12 8V5" /><path d="M8.5 12h.01M15.5 12h.01" /><path d="M9.5 16c1.2 1 3.8 1 5 0" /></svg>
              </div>
              <div className="flex flex-col justify-center"><p className="text-[15px] font-semibold leading-tight tracking-wide text-[color:var(--text)]">ผู้ช่วยเพิ่มตารางเรียน</p><p className="mt-0.5 flex items-center gap-1.5 text-[11px] font-medium text-[color:var(--muted)]"><span className="h-1.5 w-1.5 rounded-full bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.5)]" />ออนไลน์</p></div>
            </div>
            <div className="ml-auto flex items-center gap-3">
            <button type="button" onClick={createNewChatRoom} className="inline-flex items-center gap-2 whitespace-nowrap rounded-full px-5 py-2.5 text-[14px] font-medium transition-all duration-300 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50" style={{ background: 'var(--accent)', color: '#ffffff', WebkitTextFillColor: '#ffffff', boxShadow: '0 4px 14px rgba(var(--accent-rgb),0.25)' }}>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14" /><path d="M5 12h14" /></svg> เริ่มแชทใหม่
            </button>
            <button type="button" onClick={() => setHistoryOpen(prev => !prev)} className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-white/40 bg-white/60 px-4 py-2.5 text-[14px] font-medium backdrop-blur-md transition-all duration-300 hover:bg-white" style={{ color: 'var(--text)', boxShadow: 'var(--shadow-soft)' }}>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 8v4l3 3" /><circle cx="12" cy="12" r="9" /></svg> ดูประวัติ
            </button>
            </div>
          </div>

          <div ref={homeScrollRef} className="smart-home-scroll relative flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-6 sm:px-6 lg:px-10">
            {chatMessages.length === 0 ? (
              <div className="smart-home-welcome mx-auto my-auto flex w-full max-w-3xl flex-col">
          <section className="schedule-guide mx-auto w-full rounded-3xl border border-white bg-white/80 px-6 py-8 text-center shadow-[var(--shadow-float)] backdrop-blur-md md:px-10 md:py-10">
            <div>
              <div className="min-w-0">
                {isThinking ? (
                  <div className="mx-auto inline-flex items-center gap-2 rounded-full px-3 py-2" style={{ background: 'var(--surface-3)', color: 'var(--text)' }}><span className="h-2.5 w-2.5 animate-bounce rounded-full bg-current [animation-delay:-0.2s]" /><span className="h-2.5 w-2.5 animate-bounce rounded-full bg-current [animation-delay:-0.1s]" /><span className="h-2.5 w-2.5 animate-bounce rounded-full bg-current" /></div>
                ) : (
                  <>
                    {lastUserPrompt ? (
                      <div className="mx-auto mb-4 inline-block max-w-full rounded-full px-4 py-1.5 text-[12px] font-normal" style={{ background: 'var(--surface-3)', color: 'var(--muted)' }}>
                        <span className="whitespace-pre-wrap break-words">{lastUserPrompt}</span>
                      </div>
                    ) : null}
                    <h2 className={`schedule-assistant-message whitespace-pre-wrap break-words font-normal leading-relaxed text-[color:var(--text)]`}>{assistantMessage}</h2>
                    <p className="schedule-helper-text mt-4 inline-block rounded-full px-4 py-2 font-medium text-[color:var(--muted)]" style={{ background: 'var(--surface-3)' }}>ระบุชื่อวิชา วันเรียน เวลา ห้อง ภาคเรียน และปีการศึกษาได้เลย</p>
                    <details className="group mt-4 text-left">
                    <summary className="mx-auto inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium text-[color:var(--muted)] transition hover:text-[color:var(--accent)]">
                      <span>ดูตัวอย่างคำสั่ง</span>
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 transition group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                    </summary>
                    <div className="schedule-examples mt-3 rounded-xl border p-4 font-normal" style={{ borderColor: 'var(--border)', background: 'var(--surface-3)', color: 'var(--muted)' }}>
                      <p><span className="font-medium text-[color:var(--accent)]">ตัวอย่าง:</span> {currentAssistantPromptExample}</p>
                      <p className="mt-2 whitespace-pre-wrap"><span className="font-medium text-[color:var(--accent)]">เพิ่มหลายวิชาในครั้งเดียว:</span><br />{currentAssistantPromptMultipleExample}</p>
                      <p className="mt-2"><span className="font-medium text-[color:var(--accent)]">ลบวิชา:</span> พิมพ์ “ลบวิชา ชื่อวิชา” (ลบได้เมื่อไม่มีข้อมูลอื่นเชื่อมโยงอยู่)</p>
                      <p className="mt-2"><span className="font-medium text-[color:var(--accent)]">เพิ่มตารางวิชา:</span> คณิตพื้นฐานคณิตศาสตร์</p>
                      <p><span className="font-medium text-[color:var(--accent)]">ตรวจจากระบบ:</span> พิมพ์ “วิชาไหนอยู่เทอมอะไร”</p>
                    </div>
                    </details>
                  </>
                )}
              </div>
            </div>
          </section>
              </div>
            ) : (
              <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
                {chatMessages.map(message => {
                  const isAssistant = message.sender_type === 'assistant';
                  return (
                    <div key={message.id} className={`flex items-end gap-3 ${isAssistant ? 'justify-start' : 'justify-end'}`}>
                      {isAssistant ? (
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-medium" style={{ background: 'var(--accent)', color: '#ffffff' }}>AI</span>
                      ) : null}
                      <div
                        className={`w-fit min-w-[5rem] max-w-[80%] rounded-2xl px-4 py-2.5 text-[15px] leading-7 ${isAssistant ? 'rounded-bl-md border border-black/5 bg-white text-[color:var(--text)] shadow-[var(--shadow-soft)]' : 'rounded-br-md'}`}
                        style={isAssistant ? undefined : { background: 'var(--accent)', color: '#ffffff' }}
                      >
                        <p className="whitespace-pre-wrap break-words">{isAssistant ? normalizeAssistantFallback(message.message) : message.message}</p>
                        <p className="mt-1.5 text-[10px]" style={isAssistant ? { color: 'var(--muted)' } : { color: 'rgba(255,255,255,0.75)' }}>{formatChatMessageTime(message.created_at)}</p>
                      </div>
                    </div>
                  );
                })}
                {isThinking ? (
                  <div className="flex items-end gap-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-medium" style={{ background: 'var(--accent)', color: '#ffffff' }}>AI</span>
                    <div className="flex items-center gap-1.5 rounded-3xl rounded-bl-lg border border-black/5 bg-white px-4 py-4 shadow-[var(--shadow-soft)]">
                      <span className="h-2 w-2 animate-bounce rounded-full bg-[color:var(--accent)] opacity-40 [animation-delay:-0.2s]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-[color:var(--accent)] opacity-70 [animation-delay:-0.1s]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-[color:var(--accent)]" />
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <section className="smart-home-composer relative z-30 shrink-0 border-t px-4 pb-4 pt-3 sm:px-6 sm:pb-5 lg:px-10" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }} ref={attachmentTrayRef}>
            <div className="relative mx-auto w-full max-w-4xl">
              <div className={`absolute bottom-full left-0 mb-3 transition-all duration-200 ${attachmentTrayOpen ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-2 opacity-0'}`}>
                <div className="inline-flex rounded-[1.6rem] px-5 py-4 ring-1" style={{ background: 'color-mix(in srgb, var(--surface) 94%, transparent)', borderColor: 'var(--border)' }}>
                  <div className="flex items-start gap-5">
                    <label className="flex cursor-pointer flex-col items-center gap-3 text-slate-600 transition hover:text-[color:var(--accent)]">
                      <input type="file" className="hidden" onChange={event => setAttachedFileName(event.target.files?.[0]?.name ?? '')} />
                      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-50"><svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21.4 11.1 12.3 20.2a5 5 0 0 1-7.1-7.1l9.5-9.5a3.5 3.5 0 0 1 5 5l-9.2 9.2a2 2 0 1 1-2.8-2.8l8.1-8.1" /></svg></span>
                      <span className="text-[13px] font-semibold">เอกสาร</span>
                    </label>
                    <button type="button" onClick={() => { setSelectedTool('สรุปบทเรียน'); setAttachmentTrayOpen(false); }} className="flex flex-col items-center gap-3 text-slate-600 transition hover:text-[color:var(--accent)]">
                      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-50"><svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg></span>
                      <span className="text-[13px] font-semibold">รูปภาพ</span>
                    </button>
                    <button type="button" onClick={() => { setSelectedTool('ถามการบ้าน'); setAttachmentTrayOpen(false); }} className="flex flex-col items-center gap-3 text-slate-600 transition hover:text-[color:var(--accent)]">
                      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-50"><svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h4l2-2h4l2 2h4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" /><circle cx="12" cy="13" r="3" /></svg></span>
                      <span className="text-[13px] font-semibold">ถ่ายรูป</span>
                    </button>
                  </div>
                </div>
              </div>

              {attachedFileName ? (
                <div className="mb-3 inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-medium shadow-sm ring-1" style={{ background: 'var(--surface)', color: 'var(--text)', borderColor: 'var(--border)' }}>
                  <span className="truncate">{attachedFileName}</span>
                  <button type="button" onClick={() => setAttachedFileName('')} className="text-slate-400 hover:text-slate-700">×</button>
                </div>
              ) : null}

              {chatError ? (<div className="mb-3 rounded-2xl bg-rose-50 px-3 py-2 text-[12px] font-medium text-rose-600 ring-1 ring-rose-100">{chatError}</div>) : null}
              {!hasAuthToken && !authLoading ? (<div className="mb-3 rounded-2xl bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-700 ring-1 ring-amber-100">กรุณาเข้าสู่ระบบใหม่อีกครั้งก่อนใช้งานแชต</div>) : null}

              <div className="mb-3 flex w-full flex-wrap items-center justify-center gap-2">
                {[quickActions[0], storageAction].map((action) => (
                  <button key={action.id} type="button" onClick={() => navigate(action.to)} className="flex items-center gap-2.5 rounded-full border border-black/5 bg-white py-1.5 pl-2 pr-5 text-[14px] transition-all duration-300 hover:-translate-y-0.5" style={{ boxShadow: 'var(--shadow-soft)' }} title={action.label}>
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${action.iconClassName ?? ''}`} style={action.tileStyle}>{action.icon}</span>
                    <span className="whitespace-nowrap font-medium text-[color:var(--text)]">{action.label}</span>
                  </button>
                ))}
                <button type="button" onClick={() => appendAssistantTemplate(scheduleTemplate)} disabled={isThinking} className="group inline-flex items-center gap-2.5 rounded-full border border-black/5 bg-white px-5 py-2 text-[14px] font-medium text-[color:var(--text)] transition-all duration-300 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50" style={{ boxShadow: 'var(--shadow-soft)' }} aria-label="เพิ่มวิชาเดียว">
                  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] text-[color:var(--accent)]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></svg><span className="hidden sm:inline">เพิ่มวิชาเดียว</span><span className="sm:hidden">เพิ่มวิชาเดียว</span>
                </button>
                <button type="button" onClick={() => appendAssistantTemplate(multipleScheduleTemplate)} disabled={isThinking} className="group inline-flex items-center gap-2.5 rounded-full border border-black/5 bg-white px-5 py-2 text-[14px] font-medium text-[color:var(--text)] transition-all duration-300 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50" style={{ boxShadow: 'var(--shadow-soft)' }} aria-label="เพิ่มหลายวิชา">
                  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] text-[color:var(--accent)]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="4" width="7" height="7" rx="1" /><rect x="4" y="13" width="7" height="7" rx="1" /><rect x="13" y="13" width="7" height="7" rx="1" /></svg><span>เพิ่มหลายวิชา</span>
                </button>
              </div>
              <div className="lg:flex lg:items-end lg:gap-4">
              <form onSubmit={handleAssistantSubmit} className="flex items-end gap-2 sm:gap-4 lg:flex-1">
                <div className="smart-home-input-shell flex min-h-[60px] flex-1 items-end rounded-[24px] border p-2" style={{ background: 'var(--surface)', borderColor: 'rgba(0,0,0,0.10)', boxShadow: 'var(--shadow-float)' }}>
                  <button type="button" onClick={() => setAttachmentTrayOpen(prev => !prev)} className="smart-home-tool-button mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[color:var(--muted)] transition hover:bg-slate-100" aria-label="แนบไฟล์และเครื่องมือ">
                    {attachmentTrayOpen ? (<svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>) : (<svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14" /><path d="M5 12h14" /></svg>)}
                  </button>
                  <textarea ref={assistantInputRef} value={inputText} onChange={event => setInputText(event.target.value)} placeholder={currentAssistantPromptExample} disabled={isThinking} rows={1} style={{ maxHeight: `${ASSISTANT_INPUT_MAX_HEIGHT}px` }} className="min-h-[28px] flex-1 resize-none overflow-y-auto bg-transparent px-2 py-1 text-[14px] font-normal leading-7 text-[color:var(--text)] outline-none placeholder:text-[color:var(--muted)]" onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submitAssistantPrompt(inputText); } }} />
                  <button type="button" onClick={() => { if (isListening) { stopVoiceInput(); } else { startVoiceInput(); } }} disabled={!voiceInputSupported || isThinking} className={`smart-home-mic-button ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${isListening ? 'bg-rose-50 text-rose-500' : 'text-[color:var(--muted)] hover:bg-slate-100'}`} aria-label={isListening ? 'หยุดฟังเสียง' : 'พูดเป็นข้อความ'} title={!voiceInputSupported ? 'อุปกรณ์นี้ไม่รองรับการพูดเป็นข้อความ' : isListening ? 'กำลังฟังอยู่' : 'พูดเป็นข้อความ'}>
                    {isListening ? (<span className="relative flex h-3 w-3"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current/35" /><span className="relative inline-flex h-3 w-3 rounded-full bg-current" /></span>) : null}
                    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2" /><path d="M12 19v2" /></svg>
                  </button>
                </div>
                <button type="submit" disabled={!canSendChat} className="smart-home-send ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-300" style={{ background: 'var(--accent)', color: '#ffffff', boxShadow: '0 4px 14px rgba(var(--accent-rgb),0.25)' }}>
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 2 11 13" /><path d="M22 2 15 22 11 13 2 9 22 2Z" /></svg>
                </button>
              </form>
              </div>
              <div className="mt-3 text-center">
                <span className="text-[11px] font-medium text-[color:var(--muted)]">Smart Room อาจแสดงข้อมูลที่ไม่ถูกต้อง โปรดตรวจสอบข้อมูลสำคัญอีกครั้ง</span>
              </div>
            </div>
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
  }

  return (
    <div className="relative overflow-hidden pb-16">
      <div className="career-bg-blob career-blob-1" />
      <div className="career-bg-blob career-blob-2" />
      <div className="career-bg-blob career-blob-3" />

      <div className="relative z-10 space-y-6">
        {!isAuthenticated ? (
          <div className="career-soft-card p-6 text-center text-muted shadow-soft">
            กรุณาเข้าสู่ระบบเพื่อดูคำแนะนำอาชีพของคุณ
          </div>
        ) : (
          <>
            {error ? (<div className="rounded-[2rem] border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-500 shadow-soft">{error}</div>) : null}
            {info ? (<div className="rounded-[2rem] p-4 text-sm shadow-soft" style={{ border: '1px solid rgba(var(--accent-rgb),0.18)', background: 'rgba(var(--accent-rgb),0.10)', color: 'var(--accent-ink)' }}>{info}</div>) : null}

            <section
              className="relative overflow-hidden rounded-[2rem] border p-5 shadow-soft md:p-6"
              style={{
                borderColor: 'rgba(var(--accent-rgb),0.25)',
                background: 'linear-gradient(135deg, rgba(var(--accent-rgb),0.16), rgba(var(--accent-rgb),0.06))'
              }}
            >
              <div className="pointer-events-none absolute inset-y-0 right-0 w-32 bg-[radial-gradient(circle_at_center,rgba(var(--accent-rgb),0.08),transparent_72%)]" />
              <div className="relative z-10">
                <div className="inline-flex items-center gap-2 rounded-full bg-[color:rgba(var(--accent-rgb),0.10)] px-3 py-1 text-[11px] font-bold text-[color:var(--accent-ink)] shadow-sm md:text-xs">
                  <span className="inline-block h-2 w-2 rounded-full bg-[color:var(--accent)]" />
                  วิเคราะห์จากผลแบบฝึกหัดทั้งหมด
                </div>
                {lastUpdated ? (
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold text-[color:var(--muted)] md:text-xs">
                    <span className="rounded-full border px-3 py-1" style={{ borderColor: 'rgba(var(--accent-rgb),0.18)', background: 'rgba(var(--accent-rgb),0.07)' }}>
                      อัปเดตล่าสุด {lastUpdated}
                    </span>
                    {analysisProvider ? (
                      <span className="rounded-full border px-3 py-1" style={{ borderColor: 'rgba(var(--accent-rgb),0.18)', background: 'rgba(var(--accent-rgb),0.07)' }}>
                        AI: {analysisProvider}
                      </span>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-4 flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-6 text-slate-500 md:text-base">เส้นทางอาชีพที่เหมาะกับคุณ</p>
                    <h2 className={`mt-1 text-2xl font-black leading-tight tracking-[-0.03em] md:text-5xl ${recommendationTone.title}`}>
                      {primaryRecommendation?.title ?? 'ยังไม่มีข้อมูลเพียงพอ'}
                    </h2>
                  </div>
                  <div className="hidden h-16 w-16 shrink-0 items-center justify-center rounded-[1.4rem] border border-white/80 bg-white/85 text-[color:rgba(var(--accent-rgb),0.28)] shadow-sm sm:flex">
                    <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 7V6a4 4 0 0 1 8 0v1" /><path d="M4 9a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" /><path d="M12 12h.01" /></svg>
                  </div>
                </div>

                <div className="mt-5 flex items-center gap-3 md:gap-4">
                  <div className={`h-3 flex-1 overflow-hidden rounded-full ${recommendationTone.track}`}>
                    <div className={`h-full rounded-full ${recommendationTone.fill}`} style={{ width: `${primaryRecommendation?.score ?? 0}%` }} />
                  </div>
                  <span className={`w-20 shrink-0 text-xs font-medium leading-5 md:w-24 md:text-sm ${recommendationTone.label}`}>
                    ระดับความเหมาะสม {primaryRecommendation ? `${primaryRecommendation.score}%` : '--'}
                  </span>
                </div>

                <p className="mt-5 max-w-2xl text-sm leading-6 text-[color:var(--muted)] md:text-base md:leading-7">
                  {primaryRecommendation?.reason ?? 'ระบบจะวิเคราะห์จากผลแบบฝึกหัดทั้งหมดที่ทำเสร็จ เพื่อแนะนำสายอาชีพที่เหมาะกับคุณ'}
                </p>
              </div>
            </section>

            <section className="rounded-[1.75rem] border p-4 shadow-soft md:p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-4 w-full md:w-auto">
                  <label className="text-muted font-semibold whitespace-nowrap">ภาคเรียน</label>
                  <div className="relative w-full md:w-72" ref={semesterMenuRef}>
                    <button
                      type="button"
                      onClick={() => setSemesterMenuOpen(open => !open)}
                      className="flex w-full cursor-pointer items-center justify-between rounded-xl border px-4 py-3 text-left text-sm text-[color:var(--text)] outline-none transition focus:border-[color:var(--accent)] focus:ring-4 focus:ring-[color:rgba(var(--accent-rgb),0.10)]"
                      style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
                      aria-haspopup="listbox"
                      aria-expanded={semesterMenuOpen}
                    >
                      <span className="truncate">{semesterOptions.find(option => option.key === selectedSemesterKey)?.label ?? 'เลือกภาคเรียน'}</span>
                      <svg viewBox="0 0 24 24" className={`ml-3 h-5 w-5 shrink-0 text-[color:var(--muted)] transition-transform ${semesterMenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                    </button>
                    {semesterMenuOpen ? (
                      <div className="absolute left-0 right-0 z-30 mt-1.5 min-h-[124px] overflow-y-auto rounded-xl border py-1 shadow-lg" style={{ maxHeight: 'min(15.5rem, calc(100vh - 12rem))', borderColor: 'var(--border)', background: 'var(--surface-2)' }} role="listbox" aria-label="เลือกภาคเรียน">
                        {semesterOptions.map(option => {
                          const selected = option.key === selectedSemesterKey;
                          return (
                            <button
                              key={option.key}
                              type="button"
                              role="option"
                              aria-selected={selected}
                              onClick={() => { setSelectedSemesterKey(option.key); setSemesterMenuOpen(false); }}
                              className={`flex h-7 w-full items-center px-4 text-left text-sm transition ${selected ? 'bg-[color:var(--accent)] text-[color:var(--on-accent)]' : 'text-[color:var(--text)] hover:bg-[color:rgba(var(--accent-rgb),0.08)]'}`}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-col items-stretch gap-2 md:items-end">
                  <button type="button" onClick={analyzeNow} disabled={loading} className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3 font-bold shadow-[0_12px_24px_rgba(var(--accent-rgb),0.24)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70 md:w-auto" style={{ background: 'var(--accent)', color: 'var(--on-accent)', WebkitTextFillColor: 'var(--on-accent)' }}>
                    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 16h5v5" /></svg>
                    {loading ? 'กำลังวิเคราะห์ด้วย AI...' : 'วิเคราะห์ใหม่ด้วย AI'}
                  </button>
                  {lastUpdated ? (
                    <span className="text-center text-xs font-medium text-[color:var(--muted)] md:text-right">
                      ล่าสุด {lastUpdated}
                    </span>
                  ) : null}
                </div>
              </div>
            </section>

            {recommendations.length === 0 ? (
              <section className="rounded-[2rem] border p-6 text-center shadow-soft md:p-10" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[color:rgba(var(--accent-rgb),0.10)] text-[color:var(--accent-ink)]">
                  <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" /><path d="M9 12h6M12 9v6" /></svg>
                </div>
                <h2 className="mt-5 text-2xl font-bold text-[color:var(--text)]">ยังไม่มีข้อมูลเพียงพอสำหรับแนะนำอาชีพ</h2>
                <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[color:var(--muted)]">ทำแบบฝึกหัดในรายวิชาต่าง ๆ ให้เสร็จ ระบบจะนำทุกผลลัพธ์มาวิเคราะห์ความถนัดและแนะนำสายอาชีพที่เหมาะกับคุณ</p>
              </section>
            ) : (
            <div className="rounded-[2rem] border p-4 md:p-6" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[2fr_1fr]">
                <div className="flex flex-col gap-6">
                  <section
                    className="relative overflow-hidden rounded-[40px] border p-7 md:min-h-[520px] md:p-10"
                    style={{
                      borderColor: 'rgba(var(--accent-rgb),0.25)',
                      background: 'linear-gradient(135deg, rgba(var(--accent-rgb),0.16), rgba(var(--accent-rgb),0.06))',
                      backdropFilter: 'blur(16px)',
                      boxShadow: '0 24px 80px rgba(var(--accent-rgb),0.10), inset 0 1px 0 rgba(255,255,255,0.85)'
                    }}
                  >
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_22%,rgba(255,255,255,0.9),transparent_24%),radial-gradient(circle_at_84%_18%,rgba(var(--accent-rgb),0.16),transparent_18%),radial-gradient(circle_at_90%_88%,rgba(var(--accent-rgb),0.12),transparent_18%)]" />
                    <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(var(--accent-rgb),0.08),rgba(255,255,255,0.08))]" />
                    <div className="pointer-events-none absolute left-14 top-[18%] h-5 w-5 rounded-full bg-white/55 blur-[1px]" />
                    <div className="pointer-events-none absolute left-[38%] top-[12%] h-3.5 w-3.5 rounded-full bg-white/45 blur-[1px]" />
                    <div className="pointer-events-none absolute right-[13%] top-[15%] h-7 w-7 rounded-full border-4 border-white/60" />
                    <div className="pointer-events-none absolute right-14 bottom-[22%] grid grid-cols-4 gap-3 opacity-60">
                      {Array.from({ length: 12 }).map((_, index) => (<span key={`dot-${index}`} className="h-2 w-2 rounded-full bg-white/85" />))}
                    </div>
                    <div className="absolute right-7 top-7 hidden h-[132px] w-[132px] items-center justify-center rounded-[34px] border-4 border-white/80 bg-white/55 text-5xl shadow-[0_20px_40px_rgba(var(--accent-rgb),0.18)] md:flex">💼</div>

                    <div className="relative z-10">
                      <div className="inline-flex items-center gap-2 rounded-[1.75rem] border border-white/90 bg-white px-5 py-4 text-sm font-semibold text-[color:var(--accent-ink)] shadow-[0_10px_25px_rgba(var(--accent-rgb),0.10)] md:text-[1.05rem]">✨ สรุปคำแนะนำ</div>
                      <p className="mt-10 text-lg leading-none text-[color:var(--muted)] md:mt-14 md:text-[1.7rem]">เส้นทางอาชีพที่เหมาะกับคุณ</p>
                      <h2 className={`mt-3 text-4xl font-black leading-[0.98] tracking-[-0.04em] md:text-6xl ${recommendationTone.title}`}>{primaryRecommendation?.title ?? 'ยังไม่มีข้อมูลเพียงพอ'}</h2>

                      <div className="mt-10 flex items-center gap-4 md:mt-14 md:gap-6">
                        <div className={`h-4 md:h-5 flex-1 overflow-hidden rounded-full border border-white/90 ${recommendationTone.track} shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]`}>
                          <div className={`h-full rounded-full ${recommendationTone.fill} shadow-[0_0_0_1px_rgba(255,255,255,0.35),inset_0_0_0_1px_rgba(255,255,255,0.35)]`} style={{ width: `${primaryRecommendation?.score ?? 0}%` }} />
                        </div>
                        <span className="whitespace-nowrap text-sm font-medium text-[color:var(--accent-ink)] md:text-[1.05rem]">ระดับความเหมาะสม {primaryRecommendation ? `${primaryRecommendation.score}%` : '--'}</span>
                      </div>

                      <p className="mt-10 max-w-[880px] text-sm leading-relaxed text-[color:var(--muted)] md:mt-14 md:text-[1.15rem] md:leading-relaxed">{primaryRecommendation?.reason ?? 'ระบบจะวิเคราะห์จากผลแบบฝึกหัดทั้งหมดที่ทำเสร็จ เพื่อแนะนำสายอาชีพที่เหมาะกับคุณ'}</p>
                    </div>
                  </section>

                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    <section className="rounded-[30px] border border-white/70 bg-white/60 p-6 backdrop-blur-2xl shadow-[0_10px_40px_rgba(120,130,255,.08)]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex gap-3">
                          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-100 text-xl text-violet-600">✦</div>
                          <div>
                            <h3 className="text-2xl font-bold text-slate-800">ทักษะที่ควรเริ่มพัฒนาก่อน</h3>
                       
                          </div>
                        </div>
                        <button type="button" className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-xl shadow">›</button>
                      </div>
                      <div className="mt-8 flex flex-wrap gap-3">
                        {prioritizedSkills.length ? (
                          prioritizedSkills.slice(0, 6).map(skill => (<span key={`skill-${skill}`} className="rounded-2xl border border-violet-100 bg-violet-50 px-5 py-3 font-medium text-violet-600">{skill}</span>))
                        ) : (<span className="text-sm text-slate-500">ยังไม่มีข้อมูลทักษะแนะนำ</span>)}
                      </div>
                    </section>

                    <section className="rounded-[30px] border border-white/70 bg-white/60 p-6 backdrop-blur-2xl shadow-[0_10px_40px_rgba(120,130,255,.08)]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex gap-3">
                          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-100 text-xl text-cyan-600">📈</div>
                          <div>
                            <h3 className="text-2xl font-bold text-slate-800">วิชาที่ AI ใช้อ้างอิง</h3>
                          
                          </div>
                        </div>
                        <div className="rounded-2xl border bg-white px-4 py-2 text-slate-600">ข้อมูลจริง</div>
                      </div>
                      <div className="mt-6 rounded-2xl border bg-white/45 p-5" style={{ borderColor: 'rgba(148,163,184,.22)' }}>
                        {primaryRecommendation?.subjects ? (
                          <div className="flex flex-wrap gap-3">
                            {primaryRecommendation.subjects.split(',').map(subject => subject.trim()).filter(Boolean).map(subject => (
                                <span key={`career-subject-${subject}`} className="rounded-2xl border border-cyan-100 bg-cyan-50 px-4 py-2 text-sm font-medium text-cyan-700">{subject}</span>
                            ))}
                          </div>
                        ) : (<p className="text-sm text-slate-500">ยังไม่มีรายวิชาที่ AI ใช้อ้างอิงในคำแนะนำล่าสุด</p>)}
                      </div>
                      <div className="mt-4 inline-flex rounded-2xl border border-cyan-100 bg-cyan-50 px-5 py-3 text-slate-700">
                        {primaryRecommendation?.subjects ? `AI อ้างอิงจากวิชา ${primaryRecommendation.subjects}` : 'ระบบจะแสดงรายวิชาที่ AI ใช้อ้างอิงเมื่อวิเคราะห์สำเร็จ'}
                      </div>
                    </section>
                  </div>
                </div>

                <aside className="rounded-[34px] border border-white/70 bg-white/60 p-6 backdrop-blur-2xl shadow-[0_10px_40px_rgba(120,130,255,.08)]">
                  <h3 className="text-2xl font-bold text-violet-600">✦ ควิซล่าสุด</h3>
                  <div className="mt-5 flex items-end justify-between gap-4">
                    <div>
                      <p className="text-slate-500">คะแนนควิซล่าสุด</p>
                      <p className="mt-1 text-slate-400">ผ่านไป {latestQuiz ? 1 : 0} ควิซ</p>
                    </div>
                    <div className="text-5xl font-bold text-violet-600">{latestQuiz?.percentage ?? 0}%</div>
                  </div>
                </aside>
              </div>
            </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};


// ==========================================
// COLOR PICKER COMPONENT (Glassmorphism Version)
// ==========================================

const hsvToRgb = (h: number, s: number, v: number) => {
  let r, g, b;
  let i = Math.floor(h * 6);
  let f = h * 6 - i;
  let p = v * (1 - s);
  let q = v * (1 - f * s);
  let t = v * (1 - (1 - f) * s);
  switch (i % 6) { case 0: r = v; g = t; b = p; break; case 1: r = q; g = v; b = p; break; case 2: r = p; g = v; b = t; break; case 3: r = p; g = q; b = v; break; case 4: r = t; g = p; b = v; break; case 5: r = v; g = p; b = q; break; default: r = 0; g = 0; b = 0; }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
};

const rgbToHex = (r: number, g: number, b: number) => {
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
};

const rgbToHsl = (r: number, g: number, b: number) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; } else {
    const d = max - min; s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) { case r: h = (g - b) / d + (g < b ? 6 : 0); break; case g: h = (b - r) / d + 2; break; case b: h = (r - g) / d + 4; break; default: h = 0; }
    h /= 6;
  }
  return { h, s, l };
};

const hslToRgb = (h: number, s: number, l: number) => {
  let r, g, b;
  if (s === 0) { r = g = b = l; } else {
    const hue2rgb = (p: number, q: number, t: number) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
};

const hexToHsv = (hex: string) => {
  let r = parseInt(hex.slice(1, 3), 16) / 255;
  let g = parseInt(hex.slice(3, 5), 16) / 255;
  let b = parseInt(hex.slice(5, 7), 16) / 255;
  let max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, v = max;
  let d = max - min;
  s = max === 0 ? 0 : d / max;
  if (max === min) { h = 0; } else {
    switch (max) { case r: h = (g - b) / d + (g < b ? 6 : 0); break; case g: h = (b - r) / d + 2; break; case b: h = (r - g) / d + 4; break; default: h = 0; }
    h /= 6;
  }
  return { h, s, v };
};

export const ColorPicker = ({ initialHex = '#8b5cf6', onChange, onClose }: { initialHex?: string; onChange: (hex: string) => void; onClose: () => void; }) => {
  const [hsv, setHsv] = useState({ h: 0.8, s: 0.8, v: 1 });
  const [lightness, setLightness] = useState(0.5);
  const [isDraggingWheel, setIsDraggingWheel] = useState(false);

  const wheelRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialHex) {
      const { h, s, v } = hexToHsv(initialHex);
      setHsv({ h, s, v });
      // Approximate lightness
      const rgb = hexToRgbObj(initialHex);
      const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
      setLightness(hsl.l);
    }
  }, []);

  const basicRgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
  const basicHsl = rgbToHsl(basicRgb.r, basicRgb.g, basicRgb.b);
  const finalRgb = hslToRgb(basicHsl.h, basicHsl.s, lightness);
  const hexColor = rgbToHex(finalRgb.r, finalRgb.g, finalRgb.b);

  // Sync to parent when color changes
  useEffect(() => {
    onChange(hexColor);
  }, [hexColor, onChange]);

  const handleWheelInteraction = (e: any) => {
    if (!wheelRef.current) return;
    const rect = wheelRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const x = clientX - centerX;
    const y = clientY - centerY;

    const radius = Math.min(rect.width, rect.height) / 2;
    let distance = Math.sqrt(x * x + y * y);
    if (distance > radius) distance = radius;

    let angle = Math.atan2(y, x);
    let deg = (angle * 180) / Math.PI + 90;
    if (deg < 0) deg += 360;

    const newHue = deg / 360;
    const newSaturation = distance / radius;
    setHsv({ h: newHue, s: newSaturation, v: 1 });
  };

  const onWheelMouseDown = (e: any) => { setIsDraggingWheel(true); handleWheelInteraction(e); };
  const onWheelMouseMove = (e: any) => { if (isDraggingWheel) handleWheelInteraction(e); };
  const onWheelMouseUp = () => { setIsDraggingWheel(false); };

  const handleSliderInteraction = (e: any) => {
    if (!sliderRef.current) return;
    const rect = sliderRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    let percent = (clientX - rect.left) / rect.width;
    percent = Math.max(0, Math.min(1, percent));
    setLightness(percent);
  };

  useEffect(() => {
    window.addEventListener('mouseup', onWheelMouseUp);
    window.addEventListener('touchend', onWheelMouseUp);
    return () => {
      window.removeEventListener('mouseup', onWheelMouseUp);
      window.removeEventListener('touchend', onWheelMouseUp);
    };
  }, []);

  const selectSwatch = (hex: string) => {
    const { h, s } = hexToHsv(hex);
    setHsv({ h, s, v: 1 });
    const rgb = hexToRgbObj(hex);
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    setLightness(hsl.l);
  };

  const angleRad = (hsv.h * 360 - 90) * (Math.PI / 180);
  const indicatorX = Math.cos(angleRad) * hsv.s * 50;
  const indicatorY = Math.sin(angleRad) * hsv.s * 50;

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4 backdrop-blur-[18px]"
      style={{
        background: 'radial-gradient(circle at top, rgba(244,232,255,0.84) 0%, rgba(255,255,255,0.96) 32%, rgba(226,236,255,0.92) 100%)',
      }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[1200px] overflow-hidden rounded-[3rem] border border-white/85 bg-white/96 shadow-[0_34px_120px_rgba(139,92,246,0.14)] flex flex-col"
        style={{
          background: 'linear-gradient(135deg, rgba(255,255,255,0.98) 0%, rgba(248,250,255,0.96) 50%, rgba(255,255,255,0.98) 100%)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6 md:px-10 md:pt-10">
          <div className="flex items-center gap-4">
            <div className="grid h-16 w-16 place-items-center rounded-full bg-white/95 text-violet-500 shadow-[0_18px_36px_rgba(15,23,42,0.08)]">
              <Palette size={30} strokeWidth={2.2} />
            </div>
            <div>
              <h3 className="text-3xl font-black tracking-[-0.04em] text-slate-900 md:text-[4rem]">เลือกสี</h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500 md:text-[1.05rem]">คลิกหรือลากบนวงล้อเพื่อเลือกสีที่ต้องการ</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="grid h-12 w-12 place-items-center rounded-full bg-white/95 text-violet-500 shadow-[0_10px_24px_rgba(15,23,42,0.08)] transition hover:-translate-y-0.5 hover:text-slate-900" aria-label="ปิด">
            <X size={20} strokeWidth={2.4} />
          </button>
        </div>

        <div className="grid gap-8 px-6 pb-6 pt-7 md:grid-cols-[1.12fr_0.88fr] md:px-10 md:pb-10 md:pt-10">
          <div className="relative flex min-h-[360px] flex-col items-center justify-center overflow-hidden rounded-[2.6rem] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.96),rgba(255,255,255,0.72))] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.96)]">
            <div className="absolute left-8 top-8 h-5 w-5 rounded-full bg-violet-500/15 blur-[1px]" />
            <div className="absolute left-8 top-1/2 h-14 w-14 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(123,92,255,0.20),rgba(123,92,255,0.08)_55%,transparent_75%)]" />
            <div className="absolute right-12 top-20 grid grid-cols-4 gap-2 opacity-30">
              {Array.from({ length: 12 }).map((_, index) => (<span key={`theme-dot-${index}`} className="h-1.5 w-1.5 rounded-full bg-violet-400/30" />))}
            </div>
            <div className="pointer-events-none absolute inset-10 rounded-full border border-[rgba(145,158,189,0.14)]" />

            <div
              ref={wheelRef}
              onMouseDown={onWheelMouseDown}
              onMouseMove={onWheelMouseMove}
              onTouchStart={onWheelMouseDown}
              onTouchMove={onWheelMouseMove}
              className="relative h-[min(66vw,34rem)] w-[min(66vw,34rem)] max-h-[34rem] max-w-[34rem] rounded-full p-2 cursor-crosshair"
              style={{ background: 'conic-gradient(from 90deg, #ff3b7a, #ff8a00, #ffe600, #b7ff00, #42f56b, #23e6d0, #28b7ff, #6c6cff, #a94dff, #ff3b7a)', boxShadow: '0 24px 60px rgba(15,23,42,0.08)' }}
            >
              <div className="absolute inset-0 rounded-full" style={{ background: 'radial-gradient(circle closest-side, rgba(255,255,255,0.08) 0%, transparent 78%)' }} />
              <div className="absolute inset-3 rounded-full border-[6px] border-white/95 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.55)] pointer-events-none" />
              <div
                className="absolute h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-[5px] border-white shadow-[0_4px_12px_rgba(0,0,0,0.15)] pointer-events-none"
                style={{ left: `calc(50% + ${indicatorX}%)`, top: `calc(50% + ${indicatorY}%)`, backgroundColor: hexColor }}
              />
              <div className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border-[6px] border-[rgba(123,92,255,0.16)] bg-[rgba(123,92,255,0.92)] shadow-[0_10px_22px_rgba(15,23,42,0.12)]" />
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <div className="pt-4 md:pt-12">
              <p className="mb-4 text-lg font-black tracking-[-0.03em] text-slate-900">สีที่เลือก</p>
              <div className="h-[190px] rounded-[1.75rem] border border-white/80 shadow-[0_22px_40px_rgba(15,23,42,0.12)] transition-colors duration-200" style={{ backgroundColor: hexColor }} />
            </div>

            <div className="relative flex items-center py-2">
              <div className="flex-grow border-t border-gray-200" />
              <span className="mx-4 flex-shrink-0 text-violet-400"><Star size={16} fill="currentColor" /></span>
              <div className="flex-grow border-t border-gray-200" />
            </div>

            <div>
              <p className="mb-4 text-lg font-black tracking-[-0.03em] text-slate-900">สีแนะนำ</p>
              <div className="grid grid-cols-5 gap-3">
                {['#f472b6', '#fb7185', '#fdba74', '#facc15', '#a3e635', '#5eead4', '#22d3ee', '#60a5fa', '#818cf8', '#a855f7'].map((swatch) => {
                  const isActive = hexColor.toLowerCase() === swatch.toLowerCase();
                  return (
                    <button
                      key={swatch} type="button" onClick={() => selectSwatch(swatch)}
                      className={`h-[62px] rounded-[1.2rem] transition duration-200 hover:-translate-y-0.5 ${isActive ? 'ring-4 ring-violet-500/20' : ''}`}
                      style={{ background: `linear-gradient(135deg, ${swatch} 0%, ${swatch}cc 55%, rgba(255,255,255,0.18) 100%)`, boxShadow: isActive ? `0 18px 30px rgba(139,92,246,0.22)` : '0 12px 24px rgba(15,23,42,0.08)' }}
                      aria-label={`Select recommended color ${swatch}`}
                    />
                  );
                })}
              </div>
            </div>

            <div className="rounded-[2rem] border border-white/80 bg-white/92 px-5 py-4 shadow-[0_18px_40px_rgba(15,23,42,0.06)] mt-auto">
              <div className="flex items-center gap-4">
                <Sun size={20} className="flex-shrink-0 text-violet-400" />
                <div 
                  ref={sliderRef}
                  onMouseDown={(e) => {
                    handleSliderInteraction(e); const onMove = (ev: any) => handleSliderInteraction(ev); const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
                    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
                  }}
                  onTouchStart={(e) => {
                    handleSliderInteraction(e); const onMove = (ev: any) => handleSliderInteraction(ev); const onUp = () => { window.removeEventListener('touchmove', onMove); window.removeEventListener('touchend', onUp); };
                    window.addEventListener('touchmove', onMove); window.addEventListener('touchend', onUp);
                  }}
                  className="relative h-4 flex-1 rounded-full cursor-pointer shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
                  style={{ background: `linear-gradient(to right, #000000, ${rgbToHex(basicRgb.r, basicRgb.g, basicRgb.b)}, #ffffff)` }}
                >
                  <div className="absolute top-1/2 h-10 w-10 -translate-y-1/2 -translate-x-1/2 rounded-full border-[5px] border-white shadow-[0_12px_24px_rgba(15,23,42,0.18)] pointer-events-none transition-colors" style={{ left: `${lightness * 100}%`, backgroundColor: hexColor }} />
                </div>
                <Moon size={20} className="flex-shrink-0 text-violet-400" />
              </div>
              <div className="mt-3 text-center text-sm font-mono uppercase text-slate-500">{hexColor}</div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
};

