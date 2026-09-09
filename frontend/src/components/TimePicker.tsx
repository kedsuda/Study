import type { Ref } from 'react';

type TimePickerProps = {
  value?: string | null;
  onChange: (value: string) => void;
  onBlur?: () => void;
  inputRef?: Ref<HTMLSelectElement>;
  disabled?: boolean;
  compact?: boolean;
  allowEmpty?: boolean;
  className?: string;
  label?: string;
};

const hours = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));
const minutes = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'));

export const TimePicker = ({
  value, onChange, onBlur, inputRef, disabled = false, compact = false,
  allowEmpty = false, className = '', label = 'เวลา',
}: TimePickerProps) => {
  const [hour = '', minute = ''] = (value ?? '').split(':');
  const selectedHour = hours.includes(hour) ? hour : allowEmpty ? '' : '00';
  const selectedMinute = minutes.includes(minute) ? minute : allowEmpty ? '' : '00';

  return (
    <div
      role="group"
      aria-label={label}
      className={`inline-flex min-w-0 items-center justify-center rounded-xl border ${compact ? 'h-9 gap-1 px-1.5' : 'h-11 gap-2 px-2'} ${disabled ? 'opacity-60' : ''} ${className}`}
      style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
    >
      {(['hour', 'minute'] as const).map(part => (
        <div key={part} className="contents">
          {part === 'minute' && <span aria-hidden="true" className="text-sm font-semibold">:</span>}
          <div className={`relative min-w-0 ${compact ? 'w-9' : 'w-[72px]'}`}>
            <select
              ref={part === 'hour' ? inputRef : undefined}
              aria-label={`${label}: ${part === 'hour' ? 'ชั่วโมง' : 'นาที'}`}
              value={part === 'hour' ? selectedHour : selectedMinute}
              disabled={disabled}
              onBlur={onBlur}
              onChange={event => {
                const next = event.target.value;
                if (!next) onChange('');
                else if (part === 'hour') onChange(`${next}:${selectedMinute || '00'}`);
                else onChange(`${selectedHour || '00'}:${next}`);
              }}
              className={`h-8 w-full appearance-none rounded-lg border text-sm font-bold tabular-nums shadow-sm outline-none transition focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:var(--accent)]/20 disabled:cursor-not-allowed ${compact ? 'px-1 pr-4' : 'px-3 pr-6'}`}
              style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
            >
              {allowEmpty && <option value="">--</option>}
              {(part === 'hour' ? hours : minutes).map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
              className={`pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted ${compact ? 'right-0.5' : 'right-2'}`}>
              <path d="M5.5 7.5L10 12l4.5-4.5" />
            </svg>
          </div>
        </div>
      ))}
    </div>
  );
};
