import { useEffect, useMemo, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sun, Moon } from 'phosphor-react';
import { useTheme } from '../../context/ThemeContext';

export const AuthLayout = () => {
  const { theme, setTheme } = useTheme();
  const imageCandidates = useMemo(() => {
    if (typeof window === 'undefined') {
      return ['/img/login.jpg', '/app/img/login.jpg'];
    }

    const pathname = window.location.pathname || '/';
    const segments = pathname.split('/').filter(Boolean);
    const rootMarkers = new Set(['auth', 'login', 'backend', 'public', 'api', 'app']);
    const markerIndex = segments.findIndex(segment => rootMarkers.has(segment));
    const projectPrefix =
      markerIndex === 0
        ? ''
        : markerIndex > 0
          ? `/${segments.slice(0, markerIndex).join('/')}`
          : segments.length > 0
            ? `/${segments[0]}`
            : '';

    return [
      `${projectPrefix}/img/login.jpg`,
      '/img/login.jpg',
      `${projectPrefix}/app/img/login.jpg`,
      '/app/img/login.jpg',
    ];
  }, []);
  const [imageIndex, setImageIndex] = useState(0);

  useEffect(() => {
    const body = document.body;
    body.classList.add('user-area');

    return () => {
      body.classList.remove('user-area');
    };
  }, []);

  return (
    <div className="auth-layout min-h-screen bg-[color:var(--bg)]">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[1.02fr_1fr]">
        <div className="relative min-h-[260px] overflow-hidden lg:min-h-screen">
          <img
            src={imageCandidates[imageIndex]}
            alt="Smart Learning"
            className="absolute inset-0 h-full w-full object-cover"
            onError={() => {
              setImageIndex(prev => (prev < imageCandidates.length - 1 ? prev + 1 : prev));
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: 'linear-gradient(to bottom, rgba(2, 6, 23, 0.38), rgba(2, 6, 23, 0.48), rgba(2, 6, 23, 0.68))'
            }}
          />
          <div className="user-text-inverse absolute left-[8%] top-[10%] text-white drop-shadow-[0_8px_24px_rgba(0,0,0,0.18)] lg:left-[12%] lg:top-[9%]">
            <p className="text-5xl font-bold tracking-tight drop-shadow-[0_4px_12px_rgba(0,0,0,0.18)] sm:text-6xl lg:text-7xl">
              Smart Learning
            </p>
          </div>
        </div>

        <div className="relative flex items-center justify-center overflow-hidden bg-white px-6 py-14 md:px-12">
          <button
            type="button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด'}
            aria-pressed={theme === 'dark'}
            className="absolute right-5 top-4 z-20 flex items-center gap-2 rounded-full border border-muted surface px-4 py-2 text-sm text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            {theme === 'dark' ? 'โหมดสว่าง' : 'โหมดมืด'}
          </button>
          <div className="relative z-10 w-full max-w-[470px]">
            <Outlet />
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 overflow-hidden lg:h-40">
            <svg viewBox="0 0 1440 320" className="absolute bottom-0 h-full w-full text-[#E5F5FF]" fill="currentColor" preserveAspectRatio="none">
              <path d="M0,224L80,202.7C160,181,320,139,480,138.7C640,139,800,181,960,181.3C1120,181,1280,139,1360,117.3L1440,96L1440,320L0,320Z" />
            </svg>
            <div className="absolute bottom-3 left-0 flex w-full items-end justify-around px-8 text-[#00A1F1]/25 lg:px-14">
              <svg viewBox="0 0 24 24" className="h-10 w-10 -rotate-12 fill-none stroke-current stroke-[1.8]">
                <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21V5.5Z" />
                <path d="M8 7h8M8 10h8M8 13h6" />
              </svg>
              <svg viewBox="0 0 24 24" className="h-8 w-8 rotate-12 fill-none stroke-current stroke-[1.8]">
                <path d="m4 20 3.8-.9L19 7.9a1.6 1.6 0 0 0 0-2.2l-.7-.7a1.6 1.6 0 0 0-2.2 0L5 16.2 4 20Z" />
                <path d="m13.7 6.3 4 4" />
              </svg>
              <svg viewBox="0 0 24 24" className="hidden h-11 w-11 -rotate-6 fill-none stroke-current stroke-[1.8] sm:block">
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18" />
              </svg>
              <svg viewBox="0 0 24 24" className="h-10 w-10 rotate-12 fill-none stroke-current stroke-[1.8]">
                <path d="M2.5 8.5 12 4l9.5 4.5L12 13 2.5 8.5Z" />
                <path d="M6 10.2v4.3c0 .9 2.8 2.5 6 2.5s6-1.6 6-2.5v-4.3" />
                <path d="M21.5 8.5v5.8" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
