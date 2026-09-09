import { useEffect } from 'react';
import type { FC } from 'react';
import { createBrowserRouter, createHashRouter, Navigate } from 'react-router-dom';
import { AuthLayout } from './pages/auth/AuthLayout';
import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import DashboardLayout from './pages/dashboard/DashboardLayout';
import { OverviewPage } from './pages/dashboard/OverviewPage';
import { SubjectsPage } from './pages/dashboard/SubjectsPage';
import { StudyLogPage } from './pages/dashboard/StudyLogPage';
import { QuizLibraryPage } from './pages/dashboard/QuizLibraryPage';
import { QuizAttemptPage } from './pages/dashboard/QuizAttemptPage';
import { CalendarPage } from './pages/dashboard/CalendarPage';
import { DocumentSummaryPage } from './pages/dashboard/DocumentSummaryPage';
import { VoiceSummaryPage } from './pages/dashboard/VoiceSummaryPage';
import { CareerAdvisorPage } from './pages/dashboard/CareerAdvisorPage';
import { NotificationPage } from './pages/dashboard/NotificationPage';
import { GoalsPage } from './pages/dashboard/GoalsPage';
import { LearningStatsPage } from './pages/dashboard/LearningStatsPage';
import { ProfilePage } from './pages/dashboard/ProfilePage';
import { StudyDigestPage } from './pages/dashboard/StudyDigestPage';
import { StudyStoragePage } from './pages/dashboard/StudyStoragePage';
import { RequireAuth } from './components/RequireAuth';

const getAdminBase = () => {
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

  const explicitAdminBase =
    import.meta.env.VITE_ADMIN_URL?.trim() || import.meta.env.VITE_LEGACY_PROXY_TARGET?.trim();
  if (explicitAdminBase) {
    return explicitAdminBase;
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
    'learning-stats',
        'voice-summary',
        'document-summary',
        'archived-summaries',
        'career-advisor',
        'study-digest',
        'study-storage',
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
  return import.meta.env.VITE_ADMIN_URL || import.meta.env.VITE_LEGACY_PROXY_TARGET || '';
};

const rawAdminBase = getAdminBase();
const buildAdminUrl = (path: string) => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const adminBase = String(rawAdminBase || '').trim();
  if (!adminBase) return normalizedPath;

  if (typeof window !== 'undefined') {
    try {
      const parsed = new URL(adminBase, window.location.origin);
      let basePath = parsed.pathname.replace(/\/+$/, '');

      if (/\/backend\/[^/]+\.php$/i.test(basePath)) {
        basePath = basePath.replace(/\/backend\/[^/]+\.php$/i, '');
      } else if (/\/[^/]+\.php$/i.test(basePath)) {
        basePath = basePath.replace(/\/[^/]+\.php$/i, '');
      }

      return `${parsed.origin}${basePath}${normalizedPath}`;
    } catch {
      // fallback below
    }
  }

  const fallback = adminBase.replace(/\/+$/, '');
  if (/\/backend\/[^/]+\.php$/i.test(fallback)) {
    return `${fallback.replace(/\/backend\/[^/]+\.php$/i, '')}${normalizedPath}`;
  }
  if (/\/[^/]+\.php$/i.test(fallback)) {
    return `${fallback.replace(/\/[^/]+\.php$/i, '')}${normalizedPath}`;
  }
  return `${fallback}${normalizedPath}`;
};

const AdminRedirect: FC<{ path: string }> = ({ path }) => {
  const target = buildAdminUrl(path);

  useEffect(() => {
    if (!target) return;
    let absolute = target;
    try {
      absolute = new URL(target, window.location.origin).href;
    } catch {
      // keep target as-is if URL parsing fails
    }
    if (absolute === window.location.href) return;
    window.location.assign(absolute);
  }, [target]);

  return (
    <div className="flex h-screen items-center justify-center bg-slate-950 text-sm text-slate-300">
      กำลังพาไปหน้าแอดมิน...
    </div>
  );
};

const shouldUseHashRouter = (() => {
  if (typeof window === 'undefined') return false;
  if (import.meta.env.BASE_URL === './') return true;
  return window.location.pathname.endsWith('.html');
})();

const detectBrowserBasename = (): string | undefined => {
  if (typeof window === 'undefined') return undefined;
  const isLocalhost =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '0.0.0.0';
  if (isLocalhost) return undefined;
  const pathname = window.location.pathname || '/';
  if (!pathname || pathname === '/') return undefined;

  const markers = [
    '/auth/',
    '/login',
    '/admin',
    '/subjects',
    '/quizzes',
    '/calendar',
    '/notifications',
    '/profile',
    '/goals',
    '/learning-stats',
    '/voice-summary',
    '/document-summary',
    '/archived-summaries',
    '/career-advisor',
    '/study-digest',
    '/study-storage',
  ];

  let markerIndex = Number.POSITIVE_INFINITY;
  for (const marker of markers) {
    const index = pathname.indexOf(marker);
    if (index > 0 && index < markerIndex) {
      markerIndex = index;
    }
  }

  if (Number.isFinite(markerIndex)) {
    const base = pathname.slice(0, markerIndex);
    return base || undefined;
  }

  const trimmed = pathname.replace(/\/+$/, '');
  const segments = trimmed.split('/').filter(Boolean);
  if (segments.length === 1) {
    const knownAppRoots = new Set([
      'subjects',
      'quizzes',
      'calendar',
      'notifications',
      'profile',
      'goals',
      'learning-stats',
      'voice-summary',
      'document-summary',
      'archived-summaries',
      'career-advisor',
      'study-digest',
      'study-storage',
      'ai-assistant',
      'admin',
      'admin.php',
      'admin_login.php',
      'admin_logout.php'
    ]);
    if (knownAppRoots.has(segments[0])) {
      return undefined;
    }
    return `/${segments[0]}`;
  }

  return undefined;
};

const routes = [
  /* =========================
   * ✅ ADMIN (redirect to PHP)
   * ========================= */
  { path: '/admin-login', element: <AdminRedirect path="/backend/admin_login.php" /> },
  { path: '/admin-logout', element: <AdminRedirect path="/backend/admin_logout.php" /> },
  { path: '/admin.php', element: <AdminRedirect path="/backend/admin.php" /> },
  { path: '/admin_login.php', element: <AdminRedirect path="/backend/admin_login.php" /> },
  { path: '/admin_logout.php', element: <AdminRedirect path="/backend/admin_logout.php" /> },

  /* =========================
   * ✅ LOGIN ALIAS (แก้ error /login)
   * ========================= */
  {
    path: '/login',
    element: <Navigate to="/auth/login" replace />
  },

  /* =========================
   * ✅ AUTH
   * ========================= */
  {
    path: '/auth',
    element: <AuthLayout />,
    children: [
      { index: true, element: <Navigate to="login" replace /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'register', element: <RegisterPage /> }
    ]
  },

  /* =========================
   * ✅ DASHBOARD (protected)
   * ========================= */
  {
    path: '/',
    element: (
      <RequireAuth>
        <DashboardLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="ai-assistant" replace /> },
      { path: 'overview', element: <OverviewPage /> },
      { path: 'subjects', element: <SubjectsPage /> },
      { path: 'subjects/:subjectId', element: <StudyLogPage /> },
      { path: 'quizzes', element: <QuizLibraryPage /> },
      { path: 'portfolio', element: <Navigate to="/ai-assistant" replace /> },
      { path: 'quizzes/:quizId', element: <QuizAttemptPage /> },
      { path: 'calendar', element: <CalendarPage /> },
      { path: 'notifications', element: <NotificationPage /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: 'goals', element: <GoalsPage /> },
      { path: 'learning-stats', element: <LearningStatsPage /> },
      { path: 'voice-summary', element: <VoiceSummaryPage /> },
      { path: 'document-summary', element: <DocumentSummaryPage /> },
      { path: 'archived-summaries', element: <DocumentSummaryPage /> },
      { path: 'career-advisor', element: <CareerAdvisorPage mode="career" /> },
      { path: 'ai-assistant', element: <CareerAdvisorPage mode="home" /> },
      { path: 'study-digest', element: <StudyDigestPage /> },
      { path: 'study-storage', element: <StudyStoragePage /> },
      // Keep the administrator area on the established PHP dashboard.  It contains
      // the original overview, filters, statistic cards, and chart shown to admins.
      { path: 'admin', element: <AdminRedirect path="/backend/admin.php" /> }
    ]
  },

  /* =========================
   * ✅ FALLBACK กันพัง
   * ========================= */
  {
    path: '*',
    element: <Navigate to="/auth/login" replace />
  }
];

const browserBasename = shouldUseHashRouter ? undefined : detectBrowserBasename();

export const router = shouldUseHashRouter
  ? createHashRouter(routes)
  : createBrowserRouter(routes, browserBasename ? { basename: browserBasename } : undefined);
