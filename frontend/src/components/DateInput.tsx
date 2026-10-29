import { useEffect, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';

type DateInputProps = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  required?: boolean;
  disabled?: boolean;
  'aria-label'?: string;
};

const displayDate = (value: string) => value ? value.split('-').reverse().join('/') : '';

export function DateInput({ value, onChange, className = '', required, disabled, 'aria-label': label = 'วันที่' }: DateInputProps) {
  const [text, setText] = useState(() => displayDate(value));
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText(displayDate(value));
    input.current?.setCustomValidity('');
  }, [value]);

  const editDate = (next: string) => {
    setText(next);
    if (!next) {
      input.current?.setCustomValidity('');
      onChange('');
      return;
    }
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(next);
    if (match) {
      const [, day, month, year] = match;
      const iso = `${year}-${month}-${day}`;
      const date = new Date(`${iso}T12:00:00`);
      if (Number(year) > 0 && date.getFullYear() === Number(year) && date.getMonth() + 1 === Number(month) && date.getDate() === Number(day)) {
        input.current?.setCustomValidity('');
        onChange(iso);
        return;
      }
    }
    input.current?.setCustomValidity('กรุณาระบุวันที่เป็น วัน/เดือน/ปี เช่น 23/09/2026');
  };

  return (
    <span className={`relative inline-flex items-center focus-within:ring-2 focus-within:ring-[color:var(--accent)] ${className}`}>
      <input
        ref={input}
        type="text"
        aria-label={label}
        placeholder="วัน/เดือน/ปี"
        required={required}
        disabled={disabled}
        value={text}
        maxLength={10}
        onChange={event => editDate(event.target.value)}
        onBlur={event => event.target.reportValidity()}
        className="min-w-0 w-full bg-transparent pr-7 outline-none"
      />
      <span className="absolute right-3 flex h-5 w-5 items-center justify-center">
        <CalendarDays size={16} aria-hidden="true" />
        <input
          type="date"
          aria-label={`เลือก${label}จากปฏิทิน`}
          value={value}
          disabled={disabled}
          onChange={event => {
            setText(displayDate(event.target.value));
            input.current?.setCustomValidity('');
            onChange(event.target.value);
          }}
          onClick={event => event.currentTarget.showPicker?.()}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </span>
    </span>
  );
}
