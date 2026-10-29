import { useEffect, useRef, useState } from 'react';

type Props = {
  value: number | null;
  years: number[];
  disabled: boolean;
  onChange: (year: number | null) => void;
};

export const AcademicYearSelect = ({ value, years, disabled, onChange }: Props) => {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = [null, ...years];

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    container.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  return (
    <div ref={container} className="relative w-full min-w-0" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }} onKeyDown={event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    }}>
      <button ref={trigger} type="button" disabled={disabled}
        aria-label={`ปีการศึกษา: ${value ?? 'เลือกปีการศึกษา'}`}
        aria-haspopup="listbox" aria-expanded={open} aria-controls="mobile-academic-year-options"
        onClick={() => setOpen(current => !current)}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="flex w-full min-w-0 items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left text-sm font-medium text-slate-700 outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100">
        <span className="truncate">{value ?? 'เลือกปีการศึกษา'}</span>
        <svg viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && !disabled && (
        <div id="mobile-academic-year-options" role="listbox" aria-label="ปีการศึกษา"
          className="absolute inset-x-0 z-30 mt-1 max-h-48 min-w-0 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {options.map((year, index) => (
            <button key={year ?? 'all'} type="button" role="option" aria-selected={value === year}
              tabIndex={value === year ? 0 : -1}
              onKeyDown={event => {
                let next = index;
                if (event.key === 'ArrowDown') next = (index + 1) % options.length;
                else if (event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = options.length - 1;
                else return;
                event.preventDefault();
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="option"]')[next]?.focus();
              }}
              onClick={() => {
                onChange(year);
                setOpen(false);
                trigger.current?.focus();
              }}
              className={`block w-full truncate px-3 py-2 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-indigo-400 ${value === year ? 'bg-indigo-600 font-semibold text-white' : 'text-slate-700 hover:bg-indigo-50'}`}>
              {year ?? 'เลือกปีการศึกษา'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
