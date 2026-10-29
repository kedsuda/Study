import { ModalOverlay } from './ModalOverlay';
import { AlertTriangle } from 'lucide-react';

type ConfirmDialogProps = {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmTone?: 'danger' | 'primary';
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  busy?: boolean;
};

export const ConfirmDialog = ({
  isOpen,
  title,
  description,
  confirmLabel = 'ยืนยัน',
  cancelLabel = 'ยกเลิก',
  confirmTone = 'danger',
  onConfirm,
  onCancel,
  busy = false,
}: ConfirmDialogProps) => {
  if (!isOpen) return null;

  const confirmClassName = confirmTone === 'danger'
    ? 'border-rose-500/20 bg-rose-500/10 text-rose-600 hover:bg-rose-500/20'
    : 'border-sky-500/20 bg-sky-500/10 text-sky-600 hover:bg-sky-500/20';

  return (
    <ModalOverlay layer={11000} className="fixed inset-0 flex items-center justify-center bg-black/60 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[32px] border border-[color:var(--border)] bg-[color:var(--surface)] shadow-[0_24px_80px_rgba(15,23,42,0.35)]">
        <div className="px-6 py-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-500">
            <AlertTriangle size={24} />
          </div>
          <p className="mt-4 text-xs uppercase tracking-[0.3em] text-rose-400">Delete</p>
          <h3 className="mt-3 text-lg font-semibold text-[color:var(--text)]">{title}</h3>
          <p className="mt-2 text-sm text-muted">{description}</p>
        </div>
        <div className="flex justify-end gap-3 border-t border-[color:var(--border)] bg-[color:var(--surface-2)]/60 px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] px-5 py-2.5 text-sm font-semibold text-muted transition hover:text-[color:var(--text)]"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => { void onConfirm(); }}
            disabled={busy}
            className={`rounded-2xl border px-5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${confirmClassName}`}
          >
            {busy ? 'กำลังดำเนินการ...' : confirmLabel}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
};
