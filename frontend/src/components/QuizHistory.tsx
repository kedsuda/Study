import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { displayQuizAnswer } from '../utils/quizAnswers';

type Attempt = {
  id: number; score: number; total: number; answered_at: string;
  answers: { question_id: number; question_text: string; question_type: string;
    selected_answer: string; correct_answer: string; is_correct: boolean; explanation?: string; options?: string[] | null }[];
};

const formatAttemptTime = (value: string) => {
  const timestamp = value.trim().replace(' ', 'T');
  const date = new Date(timestamp + (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(timestamp) ? '' : 'Z'));
  if (Number.isNaN(date.getTime())) return '—';
  const options = { timeZone: 'Asia/Bangkok' };
  const day = date.toLocaleDateString('th-TH', options);
  const time = date.toLocaleTimeString('th-TH', {
    ...options, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  return `${day} ${time}`;
};

export function QuizHistory({ quizId }: { quizId: number }) {
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    api.get<Attempt[]>(`/quizzes/${quizId}/attempts`)
      .then(res => { if (active) setAttempts(res.data); })
      .catch(() => { if (active) setError('โหลดประวัติไม่สำเร็จ กรุณาปิดแล้วลองอีกครั้ง'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [quizId]);
  return <div className="space-y-3 text-sm">
    {loading && <p role="status">กำลังโหลดประวัติ...</p>}
    {error && <p role="alert" className="text-rose-500">{error}</p>}
    {!loading && !error && !attempts.length && <p>ยังไม่มีประวัติการทำแบบฝึกหัด</p>}
    {attempts.map(attempt => <details key={attempt.id} className="rounded-2xl border border-muted surface-2 p-4">
      <summary className="cursor-pointer font-semibold">{formatAttemptTime(attempt.answered_at)} · คะแนน {attempt.score}/{attempt.total || '—'}</summary>
      {!attempt.answers.length && <p className="mt-3">ประวัติเก่านี้ไม่มีรายละเอียดคำตอบที่บันทึกไว้</p>}
      <div className="mt-4 space-y-4">{attempt.answers.map((answer, index) => <div key={answer.question_id} className="space-y-2 rounded-xl border border-muted p-3">
        <p className="font-semibold">ข้อ {index + 1}: {answer.question_text}</p>
        <p className={answer.is_correct ? 'text-emerald-600' : 'text-rose-500'}>{answer.is_correct ? 'ตอบถูกต้อง' : 'ตอบไม่ถูกต้อง'}</p>
        {answer.question_type === 'true_false' || (answer.question_type === 'multiple_choice' && answer.options?.length) ? (
          <ul className="space-y-2" aria-label="ตัวเลือกคำตอบ">
            {(answer.question_type === 'true_false' ? ['true', 'false'] : answer.options ?? []).map((option, optionIndex) => {
              const selected = Boolean(answer.selected_answer?.trim()) && displayQuizAnswer(option.trim(), answer.question_type) === displayQuizAnswer(answer.selected_answer.trim(), answer.question_type);
              return <li key={optionIndex} className={`flex items-start gap-3 rounded-xl border p-3 ${selected ? 'border-primary bg-primary/10' : 'border-muted'}`}>
                <span aria-hidden="true" className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 font-semibold ${selected ? 'border-primary text-primary' : 'border-transparent text-muted'}`}>
                  {answer.question_type === 'true_false' ? (option === 'true' ? '✓' : '✕') : String.fromCharCode(97 + optionIndex)}
                </span>
                <span className="min-w-0 whitespace-pre-wrap break-words pt-1">{displayQuizAnswer(option, answer.question_type)}{selected && <span className="ml-2 font-semibold text-primary">(คำตอบของคุณ)</span>}</span>
              </li>;
            })}
          </ul>
        ) : null}
        <p>คำตอบของคุณ: {displayQuizAnswer(answer.selected_answer, answer.question_type)}</p>
        <p className="text-emerald-600">คำตอบที่ถูกต้อง: {displayQuizAnswer(answer.correct_answer, answer.question_type)}</p>
        {answer.explanation && <p className="whitespace-pre-wrap text-muted">{answer.explanation}</p>}
      </div>)}</div>
    </details>)}
  </div>;
}
