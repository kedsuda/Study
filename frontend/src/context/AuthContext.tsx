import axios from 'axios';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { api, legacyApi } from '../services/api';
import { LAST_SUBJECT_KEY } from '../constants/storage';

const TOKEN_KEY = 'token';
const USER_KEY = 'user';
const LOGIN_NOTIFICATION_POPUP_KEY = 'slt::notification-popup-after-login';

type User = {
  id: number;
  name: string;
  email: string;
  profile_pic?: string | null;
  avatar?: string | null;
  provider?: string | null;
  provider_id?: string | null;
  google_id?: string | null;
  education_level?: string | null;
  role?: string | null;
};

type RegisterPayload = {
  name: string;
  email: string;
  password: string;
  password_confirmation: string;
  education_level?: string | null;
};

const readCachedUser = (): User | null => {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as User;
    return parsed?.id ? parsed : null;
  } catch {
    return null;
  }
};

const shouldFallbackRequest = (err: unknown) => {
  if (!axios.isAxiosError(err)) return false;
  const status = err.response?.status;
  return status === 404 || status === 405;
};

const isAuthFailure = (err: unknown) => {
  if (!axios.isAxiosError(err)) return false;
  const status = err.response?.status;
  return status === 401 || status === 419;
};

const requestWithFallback = async <T,>(
  primary: () => Promise<T>,
  fallbacks: Array<() => Promise<T>>
): Promise<T> => {
  try {
    return await primary();
  } catch (err) {
    if (!shouldFallbackRequest(err)) {
      throw err;
    }
    let lastErr: unknown = err;
    for (const fallback of fallbacks) {
      try {
        return await fallback();
      } catch (fallbackErr) {
        lastErr = fallbackErr;
        if (!shouldFallbackRequest(fallbackErr)) {
          throw fallbackErr;
        }
      }
    }
    throw lastErr;
  }
};

type AuthContextValue = {
  user: User | null;
  token: string | null;
  loading: boolean;
  loginWithGoogle: (credential: string) => Promise<User>;
  registerWithPassword: (payload: RegisterPayload) => Promise<User>;
  loginWithPassword: (email: string, password: string) => Promise<User>;
  loginWithDev: (email?: string, name?: string) => Promise<User>;
  updateUser: (user: User) => void;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const getUserLoginRedirectUrl = () => {
  if (typeof window === 'undefined') return '/auth/login';
  const { origin, hostname, port } = window.location;
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
  if (!isLocalhost) return '/auth/login';
  if (/^517\d$/.test(port || '')) {
    return `${origin}/auth/login`;
  }

  const segments = (window.location.pathname || '/').split('/').filter(Boolean);
  const first = segments[0] || '';
  const knownRoots = new Set(['auth', 'login', 'backend', 'public', 'api']);
  const prefix = first && !knownRoots.has(first) ? `/${first}` : '';
  return `${origin}${prefix}/auth/login`;
};

export const AuthProvider = ({ children }: PropsWithChildren) => {
  const [user, setUser] = useState<User | null>(() => readCachedUser());
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [loading, setLoading] = useState(() => {
    const hasToken = !!localStorage.getItem(TOKEN_KEY);
    return hasToken;
  });

  const clearAuth = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(LAST_SUBJECT_KEY);
    sessionStorage.removeItem(LOGIN_NOTIFICATION_POPUP_KEY);

    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    if (!token) {
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(LAST_SUBJECT_KEY);
      setUser(null);
      setLoading(false);
      return;
    }

    setLoading(true);

    requestWithFallback(
      () => api.get<User>('/auth/me'),
      [() => legacyApi.get<User>('/auth/me')]
    )
      .then(res => {
        setUser(res.data);
        localStorage.setItem(USER_KEY, JSON.stringify(res.data));
      })
      .catch(err => {
        if (isAuthFailure(err)) {
          clearAuth();
          return;
        }

        const cachedUser = readCachedUser();
        if (cachedUser) {
          setUser(cachedUser);
          return;
        }

        console.error('Failed to restore auth session', err);
      })
      .finally(() => setLoading(false));
  }, [token, clearAuth]);

  const persistAuth = (newToken: string, newUser: User) => {
    localStorage.removeItem(LAST_SUBJECT_KEY);
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(USER_KEY, JSON.stringify(newUser));
    sessionStorage.setItem(LOGIN_NOTIFICATION_POPUP_KEY, '1');
    setToken(newToken);
    setUser(newUser);
  };

  const updateUser = (newUser: User) => {
    setUser(newUser);
    localStorage.setItem(USER_KEY, JSON.stringify(newUser));
  };

  const loginWithGoogle = async (credential: string): Promise<User> => {
    try {
      const response = await requestWithFallback(
        () => api.post('/auth/google', { credential }),
        [() => legacyApi.post('/auth/google', { credential })]
      );
      const { token: t, user: u } = response.data;

      clearAuth();       // ✅ กันของเก่าค้าง
      persistAuth(t, u);

      return u;
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        console.log('Google login error', err.response?.status, err.response?.data);
        const data = err.response?.data as { message?: string; errors?: { credential?: string[] } } | undefined;
        const message =
          data?.message ??
          data?.errors?.credential?.[0] ??
          (err.code === 'ERR_NETWORK'
            ? 'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่อหรือสถานะเซิร์ฟเวอร์'
            : err.message) ??
          'Google login failed';
        throw new Error(message);
      }
      throw err instanceof Error ? err : new Error('Google login failed');
    }
  };

  const loginWithDev = async (email?: string, name?: string): Promise<User> => {
    try {
      const devLoginAllowed = import.meta.env.VITE_DEV_LOGIN === 'true';
      if (!devLoginAllowed) {
        throw new Error('Dev login is disabled');
      }
      const payload = {
        ...(email ? { email } : {}),
        ...(name ? { name } : {})
      };
      const response = await requestWithFallback(
        () => api.post('/auth/dev-login', payload),
        [() => legacyApi.post('/auth/dev-login', payload)]
      );

      const { token: t, user: u } = response.data;

      clearAuth();       // ✅ กันของเก่าค้าง
      persistAuth(t, u);

      return u;
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const data = err.response?.data as { message?: string } | undefined;
        const message =
          data?.message ??
          (err.code === 'ERR_NETWORK'
            ? 'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่อหรือสถานะเซิร์ฟเวอร์'
            : err.message) ??
          'Dev login failed';
        throw new Error(message);
      }
      throw err instanceof Error ? err : new Error('Dev login failed');
    }
  };

  const loginWithPassword = async (email: string, password: string): Promise<User> => {
    try {
      const response = await requestWithFallback(
        () => api.post('/auth/login', { email, password }),
        [() => legacyApi.post('/auth/login', { email, password })]
      );

      const { token: t, user: u } = response.data;

      clearAuth();
      persistAuth(t, u);

      return u;
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const data = err.response?.data as { message?: string; errors?: { email?: string[] } } | undefined;
        const message =
          data?.message ??
          data?.errors?.email?.[0] ??
          (err.code === 'ERR_NETWORK'
            ? 'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่อหรือสถานะเซิร์ฟเวอร์'
            : err.message) ??
          'Login failed';
        throw new Error(message);
      }
      throw err instanceof Error ? err : new Error('Login failed');
    }
  };

  const registerWithPassword = async (payload: RegisterPayload): Promise<User> => {
    try {
      const response = await requestWithFallback(
        () => api.post('/register', payload),
        [
          () => api.post('/auth/register', payload),
          () => legacyApi.post('/register', payload),
          () => legacyApi.post('/auth/register', payload)
        ]
      );

      const { token: t, user: u } = response.data;

      clearAuth();
      persistAuth(t, u);

      return u;
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const data = err.response?.data as {
          message?: string;
          errors?: {
            name?: string[];
            email?: string[];
            password?: string[];
          };
        } | undefined;
        const message =
          data?.message ??
          data?.errors?.email?.[0] ??
          data?.errors?.name?.[0] ??
          data?.errors?.password?.[0] ??
          (err.code === 'ERR_NETWORK'
            ? 'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่อหรือสถานะเซิร์ฟเวอร์'
            : err.message) ??
          'Register failed';
        throw new Error(message);
      }
      throw err instanceof Error ? err : new Error('Register failed');
    }
  };

  const logout = useCallback(async () => {
    try {
      await requestWithFallback(
        () => api.post('/auth/logout'),
        [() => legacyApi.post('/auth/logout')]
      );
    } catch {
    } finally {
      clearAuth();
      window.location.assign(getUserLoginRedirectUrl());
    }
  }, [clearAuth]);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        loginWithGoogle,
        registerWithPassword,
        loginWithPassword,
        loginWithDev,
        updateUser,
        logout
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
