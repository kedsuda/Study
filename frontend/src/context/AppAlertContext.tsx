import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';

type AppAlertType = 'success' | 'error' | 'info';

type AppAlertItem = {
  id: number;
  type: AppAlertType;
  text: string;
};

type AppAlertContextValue = {
  showAlert: (type: AppAlertType, text: string) => void;
  success: (text: string) => void;
  error: (text: string) => void;
  info: (text: string) => void;
};

const AppAlertContext = createContext<AppAlertContextValue | undefined>(undefined);

export const AppAlertProvider = ({ children }: PropsWithChildren) => {
  const [alerts, setAlerts] = useState<AppAlertItem[]>([]);

  const dismissAlert = useCallback((id: number) => {
    setAlerts(prev => prev.filter(item => item.id !== id));
  }, []);

  const showAlert = useCallback((type: AppAlertType, text: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setAlerts(prev => [...prev, { id, type, text }].slice(-3));
    window.setTimeout(() => dismissAlert(id), 3200);
  }, [dismissAlert]);

  const value = useMemo<AppAlertContextValue>(() => ({
    showAlert,
    success: (text: string) => showAlert('success', text),
    error: (text: string) => showAlert('error', text),
    info: (text: string) => showAlert('info', text),
  }), [showAlert]);

  return (
    <AppAlertContext.Provider value={value}>
      {children}

      <div className="pointer-events-none fixed left-1/2 top-5 z-[90] flex w-[min(92vw,380px)] -translate-x-1/2 flex-col gap-3 sm:top-6">
        {alerts.map(alert => (
          <div key={alert.id} className="pointer-events-auto">
            <div
              className={`relative overflow-hidden rounded-[22px] border px-4 py-4 shadow-[0_18px_60px_rgba(15,23,42,0.28)] ${
                alert.type === 'success'
                  ? 'border-emerald-200 bg-white'
                  : alert.type === 'error'
                    ? 'border-rose-500 bg-rose-950'
                    : 'border-sky-200 bg-white'
              }`}
              role="status"
              aria-live="polite"
            >
              <div
                className={`absolute inset-x-0 bottom-0 h-1 ${
                  alert.type === 'success'
                    ? 'bg-emerald-500'
                    : alert.type === 'error'
                      ? 'bg-rose-400'
                      : 'bg-sky-500'
                }`}
              />
              <div className="flex items-start gap-3">
                <div
                  className={`mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-bold shadow-sm ${
                    alert.type === 'success'
                      ? 'bg-emerald-500 text-white'
                      : alert.type === 'error'
                        ? 'bg-rose-500 text-rose-50'
                        : 'bg-sky-500 text-white'
                  }`}
                >
                  {alert.type === 'success' ? '✓' : alert.type === 'error' ? '×' : 'i'}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-[15px] font-bold ${alert.type === 'error' ? 'text-rose-50' : 'text-slate-900'}`}>
                    {alert.type === 'success' ? 'บันทึกสำเร็จ' : alert.type === 'error' ? 'เกิดข้อผิดพลาด' : 'แจ้งเตือน'}
                  </p>
                  <p className={`mt-1 text-sm font-medium leading-6 ${alert.type === 'error' ? 'text-rose-100' : 'text-slate-700'}`}>{alert.text}</p>
                </div>
                <button
                  type="button"
                  onClick={() => dismissAlert(alert.id)}
                  className={`rounded-full px-2 py-1 text-xs font-semibold transition ${
                    alert.type === 'error'
                      ? 'text-rose-200 hover:bg-white/15 hover:text-rose-50'
                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  ปิด
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </AppAlertContext.Provider>
  );
};

export const useAppAlert = () => {
  const ctx = useContext(AppAlertContext);
  if (!ctx) throw new Error('useAppAlert must be used within AppAlertProvider');
  return ctx;
};
