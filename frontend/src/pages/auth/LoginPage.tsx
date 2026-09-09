import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { LAST_SUBJECT_KEY } from '../../constants/storage';
import { api } from '../../services/api';
import type { GoogleCredentialResponse } from '../../types/global';

const getAdminBaseUrl = () => {
  const apiBase = import.meta.env.VITE_API_URL?.trim();
  if (apiBase) {
    try {
      const parsed = new URL(apiBase, typeof window !== 'undefined' ? window.location.origin : undefined);
      const normalizedPath = parsed.pathname
        .replace(/\/index\.php\/?$/i, '')
        .replace(/\/public\/?$/i, '')
        .replace(/\/api\/?$/i, '')
        .replace(/\/+$/, '');
      return `${parsed.origin}${normalizedPath}`;
    } catch {
      // fallback below
    }
  }

  if (typeof window !== 'undefined') {
    const isLocalhost =
      window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isLocalhost) {
      const segments = (window.location.pathname || '/').split('/').filter(Boolean);
      const rootMarkers = new Set([
        'auth',
        'login',
        'admin',
        'admin.php',
        'admin_login.php',
        'admin_logout.php',
        'subjects',
        'quizzes',
        'calendar',
        'notifications',
        'profile',
        'goals',
        'voice-summary',
        'document-summary',
        'career-advisor',
        'public',
        'backend',
        'api',
        'app'
      ]);
      const markerIndex = segments.findIndex(segment => rootMarkers.has(segment));
      const prefix =
        markerIndex === 0
          ? ''
          : markerIndex > 0
            ? `/${segments.slice(0, markerIndex).join('/')}`
            : segments.length > 0
              ? `/${segments[0]}`
              : '';
      return `${window.location.origin}${prefix}`;
    }
  }

  const explicitAdminBase =
    import.meta.env.VITE_ADMIN_URL?.trim() || import.meta.env.VITE_LEGACY_PROXY_TARGET?.trim();
  if (explicitAdminBase) {
    return explicitAdminBase;
  }

  return import.meta.env.VITE_ADMIN_URL || import.meta.env.VITE_LEGACY_PROXY_TARGET || '';
};

const ADMIN_BASE_URL = getAdminBaseUrl();
const TOKEN_KEY = 'token';
const isLocalhost =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

const buildAdminUrl = (path: string) => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const base = String(ADMIN_BASE_URL || '').trim();
  if (!base) return normalizedPath;

  if (typeof window !== 'undefined') {
    try {
      const parsed = new URL(base, window.location.origin);
      let basePath = parsed.pathname.replace(/\/+$/, '');

      if (/\/backend\/[^/]+\.php$/i.test(basePath)) {
        basePath = basePath.replace(/\/backend\/[^/]+\.php$/i, '');
      } else if (/\/[^/]+\.php$/i.test(basePath)) {
        basePath = basePath.replace(/\/[^/]+\.php$/i, '');
      }

      return `${parsed.origin}${basePath}${normalizedPath}`;
    } catch {
      // Fallback below
    }
  }

  const fallback = base.replace(/\/+$/, '');
  if (/\/backend\/[^/]+\.php$/i.test(fallback)) {
    return `${fallback.replace(/\/backend\/[^/]+\.php$/i, '')}${normalizedPath}`;
  }
  if (/\/[^/]+\.php$/i.test(fallback)) {
    return `${fallback.replace(/\/[^/]+\.php$/i, '')}${normalizedPath}`;
  }
  return `${fallback}${normalizedPath}`;
};

const decodeJwtPayload = (token: string): Record<string, unknown> | null => {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const payload = parts[1];
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  try {
    const json = atob(padded);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const getEmailFromCredential = (credential: string): string | null => {
  const payload = decodeJwtPayload(credential);
  const email = payload?.email;
  return typeof email === 'string' ? email : null;
};

const MailIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M4 6.75h16A1.25 1.25 0 0 1 21.25 8v8A1.25 1.25 0 0 1 20 17.25H4A1.25 1.25 0 0 1 2.75 16V8A1.25 1.25 0 0 1 4 6.75Z" />
    <path d="m4 8 8 5.25L20 8" />
  </svg>
);

const LockIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M7.75 10.25V8.5a4.25 4.25 0 1 1 8.5 0v1.75" />
    <rect x="4.75" y="10.25" width="14.5" height="10" rx="2.25" />
    <path d="M12 14.25v2.25" />
  </svg>
);

const ArrowRightIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3">
    <path d="m5 12 4.2 4.2L19 6.5" />
  </svg>
);

export const LoginPage = () => {
  const { loginWithGoogle, loginWithPassword, loginWithDev } = useAuth();
  const navigate = useNavigate();
  const buttonContainerRef = useRef<HTMLDivElement | null>(null);
  const initializedClientIdRef = useRef<string | null>(null);
  const handleCredentialRef = useRef<(credential: string) => Promise<void>>(async () => {});
  const [scriptError, setScriptError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authInProgress, setAuthInProgress] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [gsiReady, setGsiReady] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [entryMode, setEntryMode] = useState<'user' | 'admin'>('user');
  const [googleClientId, setGoogleClientId] = useState(
    () => (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim()
  );
  const devLoginEnabled = import.meta.env.VITE_DEV_LOGIN === 'true';
  const googleLoginEnabled = import.meta.env.VITE_GOOGLE_LOGIN_ENABLED !== 'false';

  // ✅ เข้าหน้า Overview เสมอหลังล็อกอิน
  const resolveStudyLogDestination = useCallback(async (): Promise<string> => {
    return '/';
  }, []);

  const bridgeAdminSession = useCallback(async (): Promise<string> => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      throw new Error('ไม่พบข้อมูลการเข้าสู่ระบบ กรุณาลองใหม่อีกครั้ง');
    }

    const response = await fetch(buildAdminUrl('/backend/admin_session_login.php'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({ token })
    });

    const data = (await response.json().catch(() => null)) as
      | { ok?: boolean; error?: string; redirect?: string }
      | null;

    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || 'ไม่สามารถเข้าสู่หน้าแอดมินได้');
    }

    // Force absolute admin target on the PHP origin to avoid being redirected back to Vite origin.
    return buildAdminUrl('/backend/admin.php');
  }, []);

  const handleLoginSuccess = useCallback(
    async (user: { role?: string | null }) => {
      // ✅ กันข้อมูลข้ามบัญชี: เคลียร์วิชาล่าสุดทันทีหลังล็อกอินสำเร็จ
      localStorage.removeItem(LAST_SUBJECT_KEY);

      if (entryMode === 'admin') {
        const adminRedirectUrl = await bridgeAdminSession();
        window.location.assign(adminRedirectUrl);
        return;
      }

      const destination = await resolveStudyLogDestination();
      navigate(destination, { replace: true });
    },
    [bridgeAdminSession, entryMode, navigate, resolveStudyLogDestination]
  );

  const handleCredential = useCallback(
    async (credential: string) => {
      setAuthInProgress(true);
      setAuthError(null);

      try {
        const user = await loginWithGoogle(credential);
        await handleLoginSuccess(user);
      } catch (error) {
        console.error(error);
        if (devLoginEnabled) {
          const email = getEmailFromCredential(credential);
          if (email) {
            try {
              const user = await loginWithDev(email);
              await handleLoginSuccess(user);
              return;
            } catch (devError) {
              console.error(devError);
            }
          }
        }
        const message =
          error instanceof Error ? error.message : 'ไม่สามารถเข้าสู่ระบบด้วย Google ได้ กรุณาลองใหม่อีกครั้ง';
        setAuthError(message);
      } finally {
        setAuthInProgress(false);
      }
    },
    [loginWithGoogle, loginWithDev, handleLoginSuccess, devLoginEnabled]
  );

  useEffect(() => {
    handleCredentialRef.current = handleCredential;
  }, [handleCredential]);

  const handlePasswordLogin = useCallback(async () => {
    if (!acceptedTerms) {
      setAuthError('กรุณายอมรับเงื่อนไขการใช้งานก่อนเข้าสู่ระบบ');
      return;
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setAuthError('กรุณากรอกอีเมลและรหัสผ่านให้ครบถ้วน');
      return;
    }

    setAuthInProgress(true);
    setAuthError(null);

    try {
      const user = await loginWithPassword(trimmedEmail, password);
      await handleLoginSuccess(user);
    } catch (error) {
      console.error(error);
      const message =
        error instanceof Error ? error.message : 'ไม่สามารถเข้าสู่ระบบด้วยอีเมลได้ กรุณาลองใหม่อีกครั้ง';
      setAuthError(message);
    } finally {
      setAuthInProgress(false);
    }
  }, [acceptedTerms, email, password, loginWithPassword, handleLoginSuccess]);

  useEffect(() => {
    if (!googleLoginEnabled) {
      return;
    }
    if (googleClientId) {
      return;
    }

    let cancelled = false;
    setScriptError(null);
    const applyClientId = (payload: any): boolean => {
      const clientId =
        typeof payload?.client_id === 'string'
          ? payload.client_id
          : typeof payload?.clientId === 'string'
            ? payload.clientId
            : '';

      if (!clientId) return false;
      setGoogleClientId(clientId);
      setScriptError(null);
      return true;
    };

    const loadGoogleConfig = async () => {
      const isViteDev =
        typeof window !== 'undefined' &&
        /^517\d$/.test(window.location.port || '');
      try {
        const response = await api.get('/auth/google-config');
        if (!cancelled && applyClientId(response.data)) {
          return;
        }
        if (!cancelled && response.status >= 200 && response.status < 300) {
          setScriptError('ไม่พบ Google Client ID ในระบบ');
          return;
        }
      } catch {
        // fallback below
      }

      const prefix = (() => {
        if (typeof window === 'undefined') return '';
        const segments = (window.location.pathname || '/').split('/').filter(Boolean);
        const rootMarkers = new Set(['auth', 'login', 'backend', 'public', 'api', 'app']);
        const markerIndex = segments.findIndex(segment => rootMarkers.has(segment));
        if (markerIndex === 0) return '';
        if (markerIndex > 0) return `/${segments.slice(0, markerIndex).join('/')}`;
        return segments.length > 0 ? `/${segments[0]}` : '';
      })();
      const localCandidates = isViteDev
        ? ['/api/auth/google-config']
        : [
        prefix ? `${prefix}/api/auth/google-config` : '/api/auth/google-config',
        '/api/auth/google-config',
        prefix ? `${prefix}/index.php/api/auth/google-config` : '/index.php/api/auth/google-config',
        '/index.php/api/auth/google-config',
        prefix ? `${prefix}/public/index.php/api/auth/google-config` : '/public/index.php/api/auth/google-config',
        '/public/index.php/api/auth/google-config',
      ];

      for (const url of localCandidates) {
        try {
          const response = await fetch(url, {
            method: 'GET',
            headers: { Accept: 'application/json' },
          });
          if (!response.ok) continue;
          const data = await response.json().catch(() => null);
          if (!cancelled && applyClientId(data)) {
            return;
          }
        } catch {
          // try next candidate
        }
      }

      if (!cancelled) {
        setScriptError('ไม่สามารถโหลดการตั้งค่า Google ได้');
      }
    };

    void loadGoogleConfig();

    return () => {
      cancelled = true;
    };
  }, [googleLoginEnabled, googleClientId]);

  useEffect(() => {
    if (!googleLoginEnabled) {
      setScriptError('ปิดการเข้าสู่ระบบด้วย Google ชั่วคราว ใช้โหมดทดสอบด้านล่างแทน');
      return;
    }

    if (!googleClientId) {
      return;
    }

    const initializeButton = () => {
      if (!window.google?.accounts?.id || !buttonContainerRef.current) {
        setScriptError('ไม่สามารถเตรียม Google Sign-In ได้');
        return;
      }

      buttonContainerRef.current.innerHTML = '';

      if (initializedClientIdRef.current !== googleClientId) {
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: (response: GoogleCredentialResponse) => {
            if (response.credential) {
              void handleCredentialRef.current(response.credential);
            } else {
              setAuthError(
                `ไม่พบ token จาก Google (ตรวจสอบ Authorized JavaScript origins ให้มี: ${window.location.origin})`
              );
            }
          }
        });
        initializedClientIdRef.current = googleClientId;
      }

      window.google.accounts.id.renderButton(buttonContainerRef.current, {
        theme: 'outline',
        size: 'large',
        shape: 'pill',
        text: 'signin_with',
        width: 320
      });

      setGsiReady(true);
    };

    const scriptId = 'google-identity-services';
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;
    const handleScriptLoad = () => {
      setScriptError(null);
      initializeButton();
    };

    if (window.google?.accounts?.id) {
      initializeButton();
      return;
    }

    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = handleScriptLoad;
      script.onerror = () => setScriptError('ไม่สามารถโหลดสคริปต์ Google Sign-In ได้');
      document.head.appendChild(script);
    } else {
      script.addEventListener('load', handleScriptLoad);
    }

    return () => {
      script?.removeEventListener?.('load', handleScriptLoad);
    };
  }, [googleLoginEnabled, googleClientId]);

  useEffect(() => {
    if (!googleLoginEnabled) return;
    if (gsiReady && window.google?.accounts?.id) {
      window.google.accounts.id.prompt();
    }
  }, [gsiReady, googleLoginEnabled]);

  return (
    <div className="relative mx-auto w-full max-w-[380px] text-slate-700">
      <div className="text-center">
        <h2 className="text-4xl font-bold text-[#00A1F1] sm:text-5xl">เข้าสู่ระบบ</h2>

      </div>

      <div className="mt-8 space-y-5">
        {scriptError && (
          <div className="rounded-2xl border border-rose-500/20 bg-rose-50 px-4 py-3 text-sm text-rose-600">
            {scriptError}
          </div>
        )}
        {authError && (
          <div className="rounded-2xl border border-rose-500/20 bg-rose-50 px-4 py-3 text-sm text-rose-600">
            {authError}
          </div>
        )}

        <form
          onSubmit={event => {
            event.preventDefault();
            void handlePasswordLogin();
          }}
          className="space-y-5"
        >
          <div className="relative">
            <label className="mb-2 block text-xs font-semibold text-[#00A1F1]">โหมดการเข้าใช้งาน</label>
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-[#d3e8f8] bg-white p-1.5">
              <button
                type="button"
                onClick={() => setEntryMode('user')}
                className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                  entryMode === 'user'
                    ? 'bg-[#00A1F1] text-white shadow-sm'
                    : 'bg-transparent text-slate-600 hover:bg-slate-100'
                }`}
              >
                ผู้ใช้ทั่วไป
              </button>
              <button
                type="button"
                onClick={() => setEntryMode('admin')}
                className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                  entryMode === 'admin'
                    ? 'bg-[#00A1F1] text-white shadow-sm'
                    : 'bg-transparent text-slate-600 hover:bg-slate-100'
                }`}
              >
                ผู้ดูแลระบบ
              </button>
            </div>
          </div>

          <div className="relative">
            <label className="absolute -top-2 left-4 bg-white px-2 text-xs font-semibold text-[#00A1F1]">
              อีเมลนักเรียน
            </label>
            <div className="group flex items-center rounded-xl border border-[#7BCDF8] bg-white px-4 py-3 transition focus-within:border-[#00A1F1] focus-within:ring-1 focus-within:ring-[#00A1F1]">
              <span className="mr-3 text-slate-500">
                <MailIcon />
              </span>
              <input
                type="email"
                value={email}
                onChange={event => setEmail(event.target.value)}
                placeholder="student@school.ac.th"
                className="w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
              />
            </div>
          </div>

          <div className="relative">
            <label className="absolute -top-2 left-4 bg-white px-2 text-xs font-semibold text-[#00A1F1]">
              รหัสผ่าน
            </label>
            <div className="group flex items-center rounded-xl border border-[#7BCDF8] bg-white px-4 py-3 transition focus-within:border-[#00A1F1] focus-within:ring-1 focus-within:ring-[#00A1F1]">
              <span className="mr-3 text-slate-500">
                <LockIcon />
              </span>
              <input
                type="password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                placeholder="••••••••••••"
                className="w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <span className="text-xs text-slate-500 hover:text-[#00A1F1]">ลืมรหัสผ่าน?</span>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-100 bg-white px-3 py-3 transition hover:bg-slate-50">
            <span className="relative mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
              <input
                type="checkbox"
                id="terms"
                checked={acceptedTerms}
                onChange={event => setAcceptedTerms(event.target.checked)}
                className="peer h-5 w-5 appearance-none rounded-md border-2 border-slate-200 bg-white transition checked:border-[#1d9bf0] checked:bg-[#1d9bf0]"
              />
              <span className="pointer-events-none absolute text-white opacity-0 transition peer-checked:opacity-100">
                <CheckIcon />
              </span>
            </span>
            <span className="text-xs leading-5 text-slate-600">
              ฉันยอมรับ{' '}
              <a href="/terms" className="font-semibold text-[#1d9bf0] hover:underline" target="_blank" rel="noopener noreferrer">
                เงื่อนไขการใช้งาน
              </a>{' '}
              และ{' '}
              <a href="/privacy" className="font-semibold text-[#1d9bf0] hover:underline" target="_blank" rel="noopener noreferrer">
                นโยบายความเป็นส่วนตัว
              </a>
            </span>
          </label>

          <button
            type="submit"
            disabled={authInProgress || !acceptedTerms || !email.trim() || !password}
            className={`w-full rounded-xl px-6 py-2.5 text-sm font-semibold transition-all active:scale-[0.99] ${
              authInProgress || !acceptedTerms || !email.trim() || !password
                ? 'cursor-not-allowed bg-slate-200 text-slate-400'
                : 'bg-[#00A1F1] text-white shadow-md hover:bg-[#008DD8]'
            }`}
          >
            <span className="inline-flex items-center justify-center gap-2">
              {authInProgress ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ห้องเรียน'}
              <ArrowRightIcon />
            </span>
          </button>
        </form>

        <div className="flex items-center">
          <div className="h-px flex-1 bg-slate-200" />
          <span className="px-3 text-xs font-medium uppercase text-slate-400">หรือ</span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>

        {googleLoginEnabled ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-slate-100 bg-[#F8F9FA] py-2 shadow-sm">
              <div ref={buttonContainerRef} className="flex justify-center" style={{ opacity: 1, pointerEvents: 'auto' }} />
            </div>
            {authInProgress ? (
              <p className="text-center text-sm text-slate-500">กำลังตรวจสอบข้อมูลกับ Google...</p>
            ) : null}
          </div>
        ) : null}

        <p className="rounded-full bg-white/70 px-5 py-2 text-center text-xs text-slate-500 backdrop-blur-sm">
          ยังไม่มีบัญชีใช่ไหม?{' '}
          <Link to="/auth/register" className="font-bold text-[#00A1F1] hover:text-[#008DD8]">
            ลงทะเบียนเลย
          </Link>
        </p>
      </div>
    </div>
  );
};
