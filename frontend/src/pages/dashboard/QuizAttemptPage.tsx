import { ModalOverlay } from '../../components/ModalOverlay';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { api } from '../../services/api';
import { getLastQuizResultKey } from '../../constants/storage';
import { useAuth } from '../../context/AuthContext';
import { displayQuizAnswer } from '../../utils/quizAnswers';

interface QuizQuestion {
  id: number;
  question_text: string;
  question_type: 'multiple_choice' | 'true_false' | 'short_answer';
  options?: string[];
}

interface Quiz {
  id: number;
  title: string;
  description?: string | null;
  metadata?: {
    file_name?: string;
    [key: string]: unknown;
  } | null;
  questions: QuizQuestion[];
}

interface AnswerPayload {
  question_id: number;
  selected_answer: string;
}

interface AttemptResult {
  score: number;
  total: number;
  answers: AttemptAnswer[];
}

interface AttemptAnswer {
  question_id: number;
  selected_answer: string;
  is_correct: boolean;
  correct_answer?: string | null;
  explanation?: string | null;
  question_text?: string;
  question_type?: string;
  options?: string[] | null;
}

interface AttemptApiResponse {
  score?: number;
  total?: number;
  answers?: AttemptAnswer[] | { data?: AttemptAnswer[] } | null;
}

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

const getVisibleOptions = (options?: string[]) => {
  return (options ?? [])
    .map(option => stripTrailingEllipsis(option))
    .filter(option => option !== '');
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

const quizSourceFileName = (quiz?: Quiz | null) => {
  const fileName = quiz?.metadata?.file_name;
  return typeof fileName === 'string' && fileName.trim() !== '' ? fileName.trim() : null;
};

const normalizeAttemptResult = (payload: AttemptApiResponse | null | undefined): AttemptResult => {
  const rawAnswers = Array.isArray(payload?.answers)
    ? payload?.answers
    : Array.isArray(payload?.answers?.data)
      ? payload?.answers?.data
      : [];

  return {
    score: Number(payload?.score ?? 0),
    total: Number(payload?.total ?? 0),
    answers: rawAnswers,
  };
};

const unwrapArray = (value: any) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  return [];
};

const normalizeQuizPayload = (payload: any): Quiz | null => {
  if (!payload || typeof payload !== 'object') return null;
  return {
    ...payload,
    questions: unwrapArray(payload.questions),
  };
};

const extractErrorMessage = (error: any, fallback: string) => {
  const message = error?.response?.data?.message;
  if (typeof message === 'string' && message.trim() !== '') {
    return message;
  }

  const errors = error?.response?.data?.errors;
  if (errors && typeof errors === 'object') {
    const firstKey = Object.keys(errors)[0];
    const firstMessage = firstKey ? errors[firstKey]?.[0] : null;
    if (typeof firstMessage === 'string' && firstMessage.trim() !== '') {
      return firstMessage;
    }
  }

  if (typeof error?.message === 'string' && error.message.trim() !== '') {
    return error.message;
  }

  return fallback;
};

interface QuizAttemptPageProps {
  quizId?: number | string;
  embedded?: boolean;
  onClose?: () => void;
  onAttemptComplete?: () => void;
}

export const QuizAttemptPage = ({
  quizId: quizIdProp,
  embedded = false,
  onClose,
  onAttemptComplete,
}: QuizAttemptPageProps = {}) => {
  const { user } = useAuth();
  const { quizId: routeQuizId } = useParams();
  const quizId = quizIdProp != null ? String(quizIdProp) : routeQuizId;
  const navigate = useNavigate();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const lastResultKey = getLastQuizResultKey(user?.id);
  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting }
  } = useForm<Record<string, string>>({});

  const onInvalidSubmit = () => {
    setSubmitError('กรุณาตอบคำถามที่จำเป็นให้ครบทุกข้อก่อนส่งคำตอบ');
  };

  useEffect(() => {
    if (!quizId) return;
    let active = true;
    reset({}); setQuiz(null); setResult(null); setShowModal(false); setSubmitError(null);
    api.get(`/quizzes/${quizId}`).then(res => {
      const payload = res.data?.data ?? res.data;
      if (active) setQuiz(normalizeQuizPayload(payload));
    }).catch(error => { if (active) setSubmitError(extractErrorMessage(error, 'โหลดแบบฝึกหัดไม่สำเร็จ')); });
    return () => { active = false; };
  }, [quizId, reset]);

  const onSubmit = async (values: Record<string, string>) => {
    if (!quizId || !quiz) return;
    if ((quiz.questions ?? []).length === 0) {
      setSubmitError('แบบฝึกหัดนี้ยังไม่มีคำถาม กรุณากลับไปสร้างแบบฝึกหัดใหม่อีกครั้ง');
      return;
    }

    const unansweredRequired = (quiz.questions ?? []).filter(question => {
      if (question.question_type === 'short_answer') return false;
      const value = values[`question-${question.id}`];
      return typeof value !== 'string' || value.trim() === '';
    });

    if (unansweredRequired.length > 0) {
      setSubmitError(
        `กรุณาตอบคำถามให้ครบทุกข้อก่อนส่งคำตอบ (ยังไม่ได้ตอบ ${unansweredRequired.length} ข้อ)`
      );
      return;
    }

    const payload: AnswerPayload[] = (quiz.questions ?? []).map(question => ({
      question_id: question.id,
      selected_answer: values[`question-${question.id}`] ?? ''
    }));
    setSubmitError(null);

    try {
      const response = await api.post<AttemptApiResponse>(`/quizzes/${quizId}/attempts`, { answers: payload });
      setResult(normalizeAttemptResult(response.data));
      setShowModal(true);
      onAttemptComplete?.();
    } catch (error) {
      setResult(null);
      setShowModal(false);
      setSubmitError(extractErrorMessage(error, 'ไม่สามารถตรวจคำตอบได้'));
    }
  };

  const closeAttempt = () => {
    if (embedded) {
      onClose?.();
      return;
    }
    navigate(-1);
  };

  if (!quiz) {
    return <p role={submitError ? 'alert' : 'status'} className="text-muted">{submitError || 'กำลังโหลดแบบฝึกหัด...'}</p>;
  }

  const hasMultipleChoiceWithoutOptions = (quiz.questions ?? []).some(question => (
    question.question_type === 'multiple_choice' && getVisibleOptions(question.options).length === 0
  ));

  return (
    <div className={`w-full space-y-6 ${embedded ? 'pb-2' : 'pb-[calc(124px+env(safe-area-inset-bottom,0px))] lg:pb-8'}`}>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={closeAttempt}
          className="inline-flex items-center gap-2 rounded-full border border-muted surface px-4 py-2 text-sm font-semibold text-[color:var(--text)] shadow-sm transition hover:-translate-y-0.5 hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
        >
          <span>กลับไปยังรายการแบบฝึกหัด</span>
        </button>
      </div>
      <div className="w-full rounded-[32px] border border-muted surface p-5 shadow-glow sm:p-6 lg:p-8">
        <header>
          <h2 className="text-2xl font-semibold text-[color:var(--text)] sm:text-3xl">{repairUtf8Mojibake(quiz.title)}</h2>
          {normalizeQuizDescription(quiz.description) ? (
            <p className="text-sm text-muted">{repairUtf8Mojibake(normalizeQuizDescription(quiz.description))}</p>
          ) : null}
          {quizSourceFileName(quiz) ? (
            <p className="mt-2 break-all text-xs text-muted">ไฟล์ต้นทาง: {repairUtf8Mojibake(quizSourceFileName(quiz))}</p>
          ) : null}
        </header>
        {(quiz.questions ?? []).length === 0 ? (
          <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-600">
            แบบฝึกหัดนี้ยังไม่มีคำถาม กรุณากลับไปสร้างแบบฝึกหัดใหม่อีกครั้ง
          </div>
        ) : null}
        {submitError ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-500">
            {submitError}
          </div>
        ) : null}
        <form onSubmit={handleSubmit(onSubmit, onInvalidSubmit)} className="space-y-6">
          {(quiz.questions ?? []).map((question, index) => {
            const rawOptions = question.options ?? [];
            const visibleOptions = rawOptions
              .map(option => ({ raw: option, display: stripTrailingEllipsis(option) }))
              .filter(option => option.display !== '');
            const shouldUseTextAnswer = question.question_type === 'short_answer';

            return (
              <div key={question.id} className="w-full rounded-[28px] border border-muted surface-2 px-4 py-4 shadow-sm sm:px-5 lg:px-6">
                <p className="text-xs font-medium uppercase tracking-widest text-muted">ข้อที่ {index + 1}</p>
                <p className="mt-2 whitespace-pre-wrap break-words text-base font-medium text-[color:var(--text)] sm:text-lg">
                  {stripTrailingEllipsis(question.question_text)}
                </p>
                {question.question_type === 'multiple_choice' && visibleOptions.length > 0 && (
                  <div className="mt-4 space-y-3 text-sm text-muted">
                    {visibleOptions.map((option, optionIndex) => (
                      <label key={option.raw} className="flex w-full cursor-pointer items-start gap-3 rounded-2xl border border-muted px-3 py-3 transition hover:border-primary/30 hover:bg-primary/5 has-[:checked]:border-primary has-[:checked]:bg-primary/10">
                        <input
                          type="radio"
                          value={option.raw}
                          className="mt-1 shrink-0"
                          {...register(`question-${question.id}`, { required: true })}
                        />
                        <span className="shrink-0 font-semibold text-primary">
                          {String.fromCharCode(97 + optionIndex)}.
                        </span>
                        <span className="min-w-0 whitespace-pre-wrap break-words text-[color:var(--text)]">
                          {option.display}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                {question.question_type === 'multiple_choice' && visibleOptions.length === 0 && (
                  <p className="mt-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-3 py-3 text-sm text-amber-700">
                    ข้อนี้ไม่มีตัวเลือก กรุณาสร้างแบบฝึกหัดใหม่
                  </p>
                )}
                {question.question_type === 'true_false' && (
                  <div className="mt-4 flex flex-col gap-3 text-sm text-muted sm:flex-row sm:flex-wrap sm:gap-4">
                    {['true', 'false'].map(option => (
                      <label key={option} className="flex items-start gap-3 rounded-2xl border border-transparent px-1 py-1 transition hover:border-primary/20 hover:bg-primary/5">
                        <input type="radio" value={option} className="mt-1 shrink-0" {...register(`question-${question.id}`, { required: true })} />
                        <span className="min-w-0 whitespace-pre-wrap break-words text-[color:var(--text)]">{option === 'true' ? 'ถูก' : 'ผิด'}</span>
                      </label>
                    ))}
                  </div>
                )}
                {shouldUseTextAnswer && (
                  <textarea
                    className="mt-3 w-full rounded-2xl border border-muted surface-2 px-3 py-3 text-sm text-[color:var(--text)] shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30"
                    {...register(`question-${question.id}`)}
                  />
                )}
              </div>
            );
          })}
          <div className={`sticky z-20 -mx-1 rounded-[1.75rem] bg-[color:rgba(248,250,252,0.92)] px-1 pb-5 pt-3 backdrop-blur sm:bg-transparent sm:px-0 sm:pb-5 sm:pt-0 ${embedded ? 'bottom-0' : 'bottom-[calc(132px+env(safe-area-inset-bottom,0px))]'}`}>
            <button
              type="submit"
              className="btn-primary w-full sm:w-auto"
              disabled={isSubmitting || (quiz.questions ?? []).length === 0 || hasMultipleChoiceWithoutOptions}
            >
              {isSubmitting ? 'กำลังตรวจคำตอบ...' : 'ส่งคำตอบ'}
            </button>
          </div>
        </form>
      </div>

      {result && showModal && (
        <ModalOverlay className="fixed inset-0 flex items-end justify-center bg-slate-900/40 px-4 pb-[calc(8.75rem+env(safe-area-inset-bottom,0px))] pt-10 backdrop-blur sm:items-center sm:pb-8">
          <div className="w-full max-w-4xl rounded-3xl border border-muted surface p-5 shadow-glow sm:p-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-2xl font-semibold text-[color:var(--text)]">ผลการทำแบบฝึกหัด</h3>
                <p className="mt-1 text-sm text-muted">
                  คะแนน {result.score} จาก {result.total}{' '}
                  {result.total > 0 ? `(${Math.round((result.score / result.total) * 100)}%)` : ''}
                </p>
              </div>
            </div>

            <div className="mt-5 max-h-[46vh] space-y-3 overflow-y-auto pr-2 text-sm text-muted sm:max-h-[60vh]">
              {result.answers.map(answer => (
                <div
                  key={answer.question_id}
                  className={`space-y-2 rounded-2xl border px-3 py-3 ${
                    answer.is_correct
                      ? 'border-emerald-400/50 bg-emerald-50 text-emerald-700'
                      : 'border-rose-500/30 bg-rose-500/10 text-rose-500'
                  }`}
                >
                  <p className="text-sm font-semibold text-[color:var(--text)]">
                    {stripTrailingEllipsis(answer.question_text) || `คำถาม #${answer.question_id}`}
                  </p>
                  <p className="text-xs uppercase tracking-widest">
                    {answer.is_correct ? 'คำตอบถูกต้อง' : 'คำตอบไม่ถูกต้อง'}
                  </p>
                  <div className="rounded-xl surface-2 px-3 py-2 text-sm text-muted">
                    <p className="font-medium">คำตอบของคุณ: {displayQuizAnswer(stripTrailingEllipsis(answer.selected_answer), answer.question_type)}</p>
                    <p className="mt-1 text-emerald-600">คำตอบที่ถูกต้อง: {displayQuizAnswer(stripTrailingEllipsis(answer.correct_answer), answer.question_type)}</p>
                  </div>
                  {answer.explanation && (
                    <p className="rounded-xl surface-2 px-3 py-2 text-xs text-muted">
                      {stripTrailingEllipsis(answer.explanation)}
                    </p>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">

              <button
                onClick={() => {
                  if (result && quiz) {
                    localStorage.setItem(
                      lastResultKey,
                      JSON.stringify({
                        quizId: quiz.id,
                        title: quiz.title,
                        score: result.score,
                        total: result.total,
                        percentage: result.total > 0 ? Math.round((result.score / result.total) * 100) : 0,
                        answered_at: new Date().toISOString()
                      })
                    );
                  }
                  setShowModal(false);
                  if (embedded) {
                    onClose?.();
                  } else {
                    navigate('/quizzes');
                  }
                }}
                className="btn-primary w-full sm:w-auto"
              >
                กลับไปหน้ารายการแบบฝึกหัด
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
};
