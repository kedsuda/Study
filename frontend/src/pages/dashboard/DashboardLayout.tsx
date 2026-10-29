import { ModalOverlay } from '../../components/ModalOverlay';
import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { House, BookOpen, ClipboardText, CalendarBlank, Target, Bell, Microphone, Suitcase, Robot, FileText, User, Archive, DotsThree, Sun, Moon, X } from 'phosphor-react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { StorageNavigation } from '../../components/StorageNavigation';
import { api, assetBaseURL } from '../../services/api';
import robotImage from '../../img/robot.png';
import {
  LOCAL_NOTIFICATIONS_EVENT,
  REMOTE_NOTIFICATIONS_EVENT,
  deleteLocalNotification,
  markLocalNotificationAsRead,
  markLocalNotificationAsDelivered,
  readLocalNotifications
} from '../../services/localNotifications';

const LogOut = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M16 17l5-5-5-5" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    <path d="M21 12H9" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    <path d="M9 19H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Minimal accent themes used by the layout. Kept compact but include the
// properties referenced elsewhere (accent, accentStrong, accentSoft, accentRgb,
// onAccent, onAccentRgb, preview, id, label).
const accentThemes = [
  {
    id: 'blue',
    label: 'Blue',
    accent: '#3b82f6',
    accentStrong: '#2563eb',
    accentSoft: '#bfdbfe',
    accentRgb: '59,130,246',
    onAccent: '#ffffff',
    onAccentRgb: '255,255,255',
    preview: 'radial-gradient(circle at 10% 10%, rgba(59,130,246,0.28), rgba(59,130,246,0.12))'
  },
  {
    id: 'ember',
    label: 'Ember',
    accent: '#f97316',
    accentStrong: '#ea580c',
    accentSoft: '#ffedd5',
    accentRgb: '249,115,22',
    onAccent: '#ffffff',
    onAccentRgb: '255,255,255',
    preview: 'radial-gradient(circle at 10% 10%, rgba(249,115,22,0.28), rgba(249,115,22,0.12))'
  },
  {
    id: 'violet',
    label: 'Violet',
    accent: '#8b5cf6',
    accentStrong: '#6d28d9',
    accentSoft: '#efe6ff',
    accentRgb: '139,92,246',
    onAccent: '#ffffff',
    onAccentRgb: '255,255,255',
    preview: 'radial-gradient(circle at 10% 10%, rgba(139,92,246,0.28), rgba(139,92,246,0.12))'
  },
];

// Minimal background themes: include dark/light palette and gradients referenced
// by the layout.
const backgroundThemes = [
  {
    id: 'default',
    label: 'Default',
    darkBase: '#070914',
    darkPanel: '#0b1220',
    darkSidebar: '#060812',
    darkGradient: 'radial-gradient(1200px circle at 0% -20%, rgba(10, 10, 30, 0.35), transparent 45%), var(--bg)',
    darkPreview: '#070914',
    lightBase: '#f8fafc',
    lightPanel: '#ffffff',
    lightSidebar: '#f1f5f9',
    lightGradient: 'radial-gradient(900px circle at 100% 0%, rgba(59,130,246,0.06), transparent 45%), var(--bg)',
    lightPreview: '#f8fafc'
  }
];

const themeSwatches = ['#3b82f6', '#22c55e', '#f97316', '#ec4899', '#8b5cf6', '#14b8a6', '#ef4444'] as const;

const ThemeModeSwitch = ({
  theme,
  onChange,
  size = 'md'
}: {
  theme: 'dark' | 'light';
  onChange: (next: 'dark' | 'light') => void;
  size?: 'sm' | 'md' | 'lg';
}) => {
  const isDark = theme === 'dark';
  const iconSize = size === 'sm' ? 16 : size === 'lg' ? 22 : 18;
  return (
    <button
      type="button"
      onClick={() => onChange(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด'}
      aria-pressed={isDark}
      title={isDark ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด'}
      className={`flex h-10 w-10 items-center justify-center rounded-full border transition ${
        isDark ? 'border-white/10 text-slate-200 hover:border-white/20' : 'border-slate-200 bg-white text-slate-600 shadow-sm hover:text-slate-900'
      }`}
    >
      {isDark ? <Sun size={iconSize} weight="duotone" /> : <Moon size={iconSize} weight="duotone" />}
    </button>
  );
};

const accentStorageKey = 'smart-classroom-accent';
const customAccentStorageKey = 'smart-classroom-custom-accent';
const fontScaleStorageKey = 'smart-classroom-font-scale';
const browserNotifyEnabledStorageKey = 'slt::browser-notify-enabled';
const seenNotificationKeysStoragePrefix = 'slt::seen-notification-keys::user:';
const loginNotificationPopupStorageKey = 'slt::notification-popup-after-login';
const FONT_SCALE_MIN = 0.8;
const FONT_SCALE_MAX = 1.3;
type IconName =
  | 'overview'
  | 'subjects'
  | 'quizzes'
  | 'calendar'
  | 'more'
  | 'profile'
  | 'goals'
  | 'stats'
  | 'voiceSummary'
  | 'careerAdvisor'
  | 'assistant'
  | 'studyDigest'
  | 'studyStorage'
  | 'documentSummary'
  | 'archive'
  | 'admin'
  | 'notifications';

type NavItem = {
  to: string;
  label: string;
  icon: IconName;
  accent: string;
  showOnMobile?: boolean;
};

type StudyNotification = {
  id: number;
  title: string;
  message: string;
  type: string;
  notify_at: string;
  delivered_at?: string | null;
  is_read: boolean;
};

type InAppToast = {
  key: string;
  title: string;
  message: string;
};

const MobileIcon = ({
  name,
  active = false,
  className = 'h-6 w-6',
  accent
}: {
  
  name: IconName;
  
  active?: boolean;
  className?: string;
  accent: string;
}) => {
  const normalizedAccent = accent.trim().toLowerCase();
  const accentColor =
    normalizedAccent === '#fff' ||
    normalizedAccent === '#ffffff' ||
    normalizedAccent === '#0f172a'
      ? accent
      : active
        ? shadeColor(accent, -42)
        : shadeColor(accent, -20);

  switch (name) {
    case 'overview': // หน้าหลัก (บ้าน)
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          {active ? (
            <>
              <path
                d="M4.5 10.6 12 4.2l7.5 6.4v9.2a2.2 2.2 0 0 1-2.2 2.2H6.7a2.2 2.2 0 0 1-2.2-2.2v-9.2Z"
                fill={accentColor}
                stroke={accentColor}
                strokeWidth={1.4}
                strokeLinejoin="round"
              />
              <path d="M10.2 22v-6.5a1.8 1.8 0 0 1 1.8-1.8h0a1.8 1.8 0 0 1 1.8 1.8V22" stroke="#fff" strokeWidth={1.7} strokeLinecap="round" />
            </>
          ) : (
            <>
              <path
                d="M4.5 10.6 12 4.2l7.5 6.4v9.2a2.2 2.2 0 0 1-2.2 2.2H6.7a2.2 2.2 0 0 1-2.2-2.2v-9.2Z"
                stroke={accentColor}
                strokeWidth={1.9}
                strokeLinejoin="round"
              />
              <path d="M9.8 22v-6.7a2.2 2.2 0 0 1 2.2-2.2h0a2.2 2.2 0 0 1 2.2 2.2V22" stroke={accentColor} strokeWidth={1.8} strokeLinecap="round" />
            </>
          )}
        </svg>
      );
    case 'subjects': // หนังสือ
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          {active ? (
            <>
              <path
                d="M7.2 4.5h9.6a2.3 2.3 0 0 1 2.3 2.3v13.9a1.1 1.1 0 0 1-1.6 0.98L12 18.9l-5.5 2.78a1.1 1.1 0 0 1-1.6-0.98V6.8a2.3 2.3 0 0 1 2.3-2.3Z"
                fill={accentColor}
              />
              <path
                d="M10 5.9v7.2l2-1.15 2 1.15V5.9"
                stroke="#fff"
                strokeWidth={1.7}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path d="M9.2 16.1h5.6" stroke="#fff" strokeWidth={1.7} strokeLinecap="round" />
            </>
          ) : (
            <>
              <path
                d="M7.2 4.5h9.6a2.3 2.3 0 0 1 2.3 2.3v13.9a1.1 1.1 0 0 1-1.6 0.98L12 18.9l-5.5 2.78a1.1 1.1 0 0 1-1.6-0.98V6.8a2.3 2.3 0 0 1 2.3-2.3Z"
                stroke={accentColor}
                strokeWidth={1.8}
                strokeLinejoin="round"
              />
              <path
                d="M10 5.9v7.2l2-1.15 2 1.15V5.9"
                stroke={accentColor}
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path d="M9.2 16.1h5.6" stroke={accentColor} strokeWidth={1.6} strokeLinecap="round" />
            </>
          )}
        </svg>
      );
    case 'quizzes': // แบบฝึกหัด (คลิปบอร์ด)
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          {active ? (
            <>
              <path
                d="M8 4.5h8a2.2 2.2 0 0 1 2.2 2.2v12.9A2.4 2.4 0 0 1 15.8 22H8.2A2.4 2.4 0 0 1 5.8 19.6V6.7A2.2 2.2 0 0 1 8 4.5Z"
                fill={accentColor}
                stroke={accentColor}
                strokeWidth={1.2}
                strokeLinejoin="round"
              />
              <path
                d="M9.2 4.5h5.6a1.4 1.4 0 0 1 1.4 1.4v.8H7.8v-.8a1.4 1.4 0 0 1 1.4-1.4Z"
                fill="#fff"
                opacity={0.95}
              />
              <path d="M9 13.2l2.1 2.1L15.4 11" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </>
          ) : (
            <>
              <path
                d="M8 4.5h8a2.2 2.2 0 0 1 2.2 2.2v12.9A2.4 2.4 0 0 1 15.8 22H8.2A2.4 2.4 0 0 1 5.8 19.6V6.7A2.2 2.2 0 0 1 8 4.5Z"
                stroke={accentColor}
                strokeWidth={1.9}
                strokeLinejoin="round"
              />
              <path
                d="M9.2 4.5h5.6a1.4 1.4 0 0 1 1.4 1.4v.8H7.8v-.8a1.4 1.4 0 0 1 1.4-1.4Z"
                stroke={accentColor}
                strokeWidth={1.8}
                strokeLinejoin="round"
              />
              <path d="M9 13.2l2.1 2.1L15.4 11" stroke={accentColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </>
          )}
        </svg>
      );
    case 'calendar': // ปฏิทิน
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          {active ? (
            <>
              <rect x="3" y="6" width="18" height="15" rx="2.4" fill={accentColor} />
              <rect x="3" y="10" width="18" height="2" fill="#fff" />
              <circle cx="8" cy="15" r="1.2" fill="#fff" />
              <circle cx="12" cy="15" r="1.2" fill="#fff" />
              <circle cx="16" cy="15" r="1.2" fill="#fff" />
            </>
          ) : (
            <>
              <rect x="4" y="5.5" width="16" height="14.5" rx="2.5" stroke={accentColor} strokeWidth={1.8} />
              <line x1="4" y1="10" x2="20" y2="10" stroke={accentColor} strokeWidth={1.6} />
              <line x1="8" y1="3.8" x2="8" y2="7" stroke={accentColor} strokeWidth={1.8} strokeLinecap="round" />
              <line x1="16" y1="3.8" x2="16" y2="7" stroke={accentColor} strokeWidth={1.8} strokeLinecap="round" />
            </>
          )}
        </svg>
      );
    case 'more': // เมนูเพิ่มเติม
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          <circle cx="6" cy="12" r="2" fill={accentColor} />
          <circle cx="12" cy="12" r="2" fill={accentColor} />
          <circle cx="18" cy="12" r="2" fill={accentColor} />
        </svg>
      );
    case 'profile': // โปรไฟล์
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          <circle cx="12" cy="8" r="4" stroke={accentColor} strokeWidth={2} />
          <path d="M4 20c1.8-4 13.2-4 16 0" stroke={accentColor} strokeWidth={2} strokeLinecap="round" />
        </svg>
      );
    case 'goals': // เป้าหมาย (เป้า)
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          {active ? (
            <>
              <circle cx="12" cy="12" r="9" fill={accentColor} stroke={accentColor} strokeWidth={1.2} />
              <circle cx="12" cy="12" r="5.2" stroke="#fff" strokeWidth={1.9} />
              <circle cx="12" cy="12" r="2" fill="#fff" />
              <path d="M12 4.2v2.8" stroke="#fff" strokeWidth={2} strokeLinecap="round" />
            </>
          ) : (
            <>
              <circle cx="12" cy="12" r="9" stroke={accentColor} strokeWidth={2} />
              <circle cx="12" cy="12" r="5.2" stroke={accentColor} strokeWidth={2} />
              <circle cx="12" cy="12" r="2" stroke={accentColor} strokeWidth={1.8} />
              <path d="M12 4.2v2.8" stroke={accentColor} strokeWidth={2} strokeLinecap="round" />
            </>
          )}
        </svg>
      );
    case 'stats': // สถิติ
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          {active ? (
            <>
              <rect x="4" y="12" width="3.8" height="7" rx="1.3" fill={accentColor} />
              <rect x="10.1" y="7" width="3.8" height="12" rx="1.3" fill={accentColor} />
              <rect x="16.2" y="4" width="3.8" height="15" rx="1.3" fill={accentColor} />
              <path d="M4 20h16" stroke={accentColor} strokeWidth={1.8} strokeLinecap="round" />
            </>
          ) : (
            <>
              <rect x="4" y="12" width="3.8" height="7" rx="1.3" stroke={accentColor} strokeWidth={1.8} />
              <rect x="10.1" y="7" width="3.8" height="12" rx="1.3" stroke={accentColor} strokeWidth={1.8} />
              <rect x="16.2" y="4" width="3.8" height="15" rx="1.3" stroke={accentColor} strokeWidth={1.8} />
              <path d="M4 20h16" stroke={accentColor} strokeWidth={1.8} strokeLinecap="round" />
            </>
          )}
        </svg>
      );
    case 'voiceSummary': // ไมโครโฟน
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          <rect x="9" y="3" width="6" height="12" rx="3" fill={accentColor} />
          <path d="M7 10v2a5 5 0 0 0 10 0v-2" stroke={accentColor} strokeWidth={1.8} strokeLinecap="round" />
          <path d="M12 22v-4" stroke={accentColor} strokeWidth={1.8} strokeLinecap="round" />
          <path d="M8 22h8" stroke={accentColor} strokeWidth={1.8} strokeLinecap="round" />
        </svg>
      );
    case 'careerAdvisor': // จรวด
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          {active ? (
            <>
              <path
                d="M12 3.5c-2.7 2.2-4.3 5.1-4.3 8.4v4.1l4.3 2.4 4.3-2.4v-4.1c0-3.3-1.6-6.2-4.3-8.4Z"
                fill={accentColor}
                stroke={accentColor}
                strokeWidth={1.2}
                strokeLinejoin="round"
              />
              <circle cx="12" cy="10.1" r="1.55" fill="#fff" />
              <path
                d="M8.3 15.2 6.2 17.3v2.7l2.3-1.1"
                stroke="#fff"
                strokeWidth={1.7}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M15.7 15.2l2.1 2.1v2.7l-2.3-1.1"
                stroke="#fff"
                strokeWidth={1.7}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M12 18.2c-1 1-1.6 2-1.6 3.1 0 1 .6 1.9 1.6 2.6 1-.7 1.6-1.6 1.6-2.6 0-1.1-.6-2.1-1.6-3.1Z"
                fill="#fff"
              />
            </>
          ) : (
            <>
              <path
                d="M12 3.5c-2.7 2.2-4.3 5.1-4.3 8.4v4.1l4.3 2.4 4.3-2.4v-4.1c0-3.3-1.6-6.2-4.3-8.4Z"
                stroke={accentColor}
                strokeWidth={1.8}
                strokeLinejoin="round"
              />
              <circle cx="12" cy="10.1" r="1.55" stroke={accentColor} strokeWidth={1.6} />
              <path
                d="M8.3 15.2 6.2 17.3v2.7l2.3-1.1"
                stroke={accentColor}
                strokeWidth={1.7}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M15.7 15.2l2.1 2.1v2.7l-2.3-1.1"
                stroke={accentColor}
                strokeWidth={1.7}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M12 18.2c-1 1-1.6 2-1.6 3.1 0 1 .6 1.9 1.6 2.6 1-.7 1.6-1.6 1.6-2.6 0-1.1-.6-2.1-1.6-3.1Z"
                stroke={accentColor}
                strokeWidth={1.6}
                strokeLinejoin="round"
              />
            </>
          )}
        </svg>
      );
    case 'assistant': // หุ่นยนต์
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          <rect x="6" y="8" width="12" height="8" rx="4" fill={accentColor} />
          <circle cx="9" cy="12" r="1.2" fill="#fff" />
          <circle cx="15" cy="12" r="1.2" fill="#fff" />
          <rect x="10" y="16" width="4" height="2" rx="1" fill={accentColor} />
          <rect x="8" y="6" width="8" height="2" rx="1" fill={accentColor} />
        </svg>
      );
    case 'studyDigest': // สรุปเนื้อหา
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          {active ? (
            <>
              <rect x="4.5" y="4.5" width="15" height="15" rx="3" fill={accentColor} />
              <path d="M8 8h8M8 12h8M8 16h4.8" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" />
              <path d="M16.2 14.8v3M14.7 16.3h3" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" />
            </>
          ) : (
            <>
              <rect x="4.5" y="4.5" width="15" height="15" rx="3" stroke={accentColor} strokeWidth={1.8} />
              <path d="M8 8h8M8 12h8M8 16h4.8" stroke={accentColor} strokeWidth={1.7} strokeLinecap="round" />
              <path d="M16.2 14.8v3M14.7 16.3h3" stroke={accentColor} strokeWidth={1.7} strokeLinecap="round" />
            </>
          )}
        </svg>
      );
    case 'studyStorage': // ไฟล์ทั้งหมด
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          {active ? (
            <>
              <path d="M4.5 8.2A2.2 2.2 0 0 1 6.7 6h3.6l2 2.2h5A2.2 2.2 0 0 1 19.5 10v7.2a2.2 2.2 0 0 1-2.2 2.2H6.7a2.2 2.2 0 0 1-2.2-2.2v-9Z" fill={accentColor} />
              <path d="M8 13h8M8 16h5" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" />
            </>
          ) : (
            <>
              <path d="M4.5 8.2A2.2 2.2 0 0 1 6.7 6h3.6l2 2.2h5A2.2 2.2 0 0 1 19.5 10v7.2a2.2 2.2 0 0 1-2.2 2.2H6.7a2.2 2.2 0 0 1-2.2-2.2v-9Z" stroke={accentColor} strokeWidth={1.8} strokeLinejoin="round" />
              <path d="M8 13h8M8 16h5" stroke={accentColor} strokeWidth={1.7} strokeLinecap="round" />
            </>
          )}
        </svg>
      );
    case 'documentSummary': // สรุปด้วย AI (ประกาย)
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          <path d="M12 5.2l1.15 3.2 3.2 1.15-3.2 1.15L12 13.9l-1.15-3.2-3.2-1.15 3.2-1.15L12 5.2Z" fill={active ? accentColor : 'none'} stroke={accentColor} strokeWidth={1.6} strokeLinejoin="round" />
          <path d="M17.5 14.3l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6.6-1.6Z" fill={active ? accentColor : 'none'} stroke={accentColor} strokeWidth={1.4} strokeLinejoin="round" />
          <path d="M6.9 14.8l.45 1.2 1.2.45-1.2.45-.45 1.2-.45-1.2-1.2-.45 1.2-.45.45-1.2Z" fill={active ? accentColor : 'none'} stroke={accentColor} strokeWidth={1.2} strokeLinejoin="round" />
        </svg>
      );
    case 'archive': // กล่องเก็บถาวร
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          <rect x="4" y="7" width="16" height="12" rx="2" stroke={accentColor} strokeWidth={1.8} />
          <rect x="6" y="5" width="12" height="4" rx="1.5" fill={accentColor} />
          <path d="M9 13h6" stroke={accentColor} strokeWidth={1.8} strokeLinecap="round" />
        </svg>
      );
    case 'notifications': // กระดิ่ง
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          <path
            d="M12 4a6 6 0 0 0-6 6v3.4l-1.2 2A1 1 0 0 0 5.7 17H18.3a1 1 0 0 0 .86-1.6L18 13.4V10a6 6 0 0 0-6-6Z"
            fill={accentColor}
            stroke={accentColor}
            strokeWidth={1.4}
            strokeLinejoin="round"
          />
          <path d="M10 19a2 2 0 0 0 4 0" stroke={accentColor} strokeWidth={1.6} strokeLinecap="round" />
        </svg>
      );
    case 'admin': // ผู้ดูแล
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          <path d="M12 3.6 18.5 6v5.2c0 4.2-2.5 7.4-6.5 9.2-4-1.8-6.5-5-6.5-9.2V6L12 3.6Z" fill={active ? accentColor : 'none'} stroke={accentColor} strokeWidth={1.8} strokeLinejoin="round" />
          <path d="M9.2 12.1 11 13.9l3.9-4.1" stroke={active ? '#fff' : accentColor} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    default:
      return null;
  }
};

const shadeColor = (hex: string, percent: number) => {
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const r = (num >> 16) + amt;
  const g = ((num >> 8) & 0x00ff) + amt;
  const b = (num & 0x0000ff) + amt;
  return `#${(
    0x1000000 +
    (r < 255 ? (r < 1 ? 0 : r) : 255) * 0x10000 +
    (g < 255 ? (g < 1 ? 0 : g) : 255) * 0x100 +
    (b < 255 ? (b < 1 ? 0 : b) : 255)
  )
    .toString(16)
    .slice(1)}`;
};

const tintColor = (hex: string, whiteRatio = 0.68) => {
  const normalized = normalizeHexColor(hex).slice(1);
  const value = Number.parseInt(normalized, 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  const tinted = channels.map(channel => Math.round(channel + (255 - channel) * whiteRatio));
  return `#${tinted.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
};

const normalizeHexColor = (value: string, fallback = '#3b82f6') =>
  /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;

const hexToRgbString = (hex: string) => {
  const normalized = normalizeHexColor(hex).slice(1);
  const value = Number.parseInt(normalized, 16);
  return `${(value >> 16) & 255},${(value >> 8) & 255},${value & 255}`;
};

const getContrastColor = (hex: string) => {
  const channels = hexToRgbString(hex).split(',').map(Number);
  const luminance = channels.reduce((sum, channel, index) => {
    const normalized = channel / 255;
    const linear = normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
    return sum + linear * [0.2126, 0.7152, 0.0722][index];
  }, 0);
  return luminance > 0.48 ? '#0f172a' : '#ffffff';
};

const getAccentInkColor = (hex: string, mode: 'dark' | 'light') => {
  const [r, g, b] = hexToRgbString(hex).split(',').map(Number);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  if (mode === 'dark') {
    return brightness < 150 ? shadeColor(hex, 38) : hex;
  }
  return brightness > 175 ? shadeColor(hex, -48) : brightness > 135 ? shadeColor(hex, -28) : hex;
};

const resolveProfileUrl = (value?: string | null, fallbackBase?: string) => {
  const raw = value?.trim();
  if (!raw) return null;
  if (raw.startsWith('//')) return `https:${raw}`;
  if (raw.startsWith('http')) {
    if (typeof window !== 'undefined') {
      try {
        const parsed = new URL(raw);
        const current = new URL(window.location.origin);
        const isLocalPair =
          ['localhost', '127.0.0.1'].includes(parsed.hostname) &&
          ['localhost', '127.0.0.1'].includes(current.hostname);
        if (isLocalPair && parsed.origin !== current.origin) {
          return `${current.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
        }
      } catch {
        // Keep original URL when parsing fails.
      }
    }
    return raw;
  }
  const base = fallbackBase
    ?.replace(/\/public\/index\.php\/api\/?$/, '')
    ?.replace(/\/index\.php\/api\/?$/, '')
    ?.replace(/\/public\/index\.php\/?$/, '/public')
    ?.replace(/\/index\.php\/?$/, '')
    ?.replace(/\/api\/?$/, '');
  if (!base) return raw;
  const normalized = raw.startsWith('/') ? raw : `/${raw}`;
  return `${base}${normalized}`;
};

const buildProfileImageCandidates = (values: Array<string | null | undefined>, fallbackBase?: string) => {
  const seen = new Set<string>();
  const candidates: string[] = [];

  values.forEach(value => {
    const resolved = resolveProfileUrl(value, fallbackBase);
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    candidates.push(resolved);
  });

  return candidates;
};

const getSeenNotificationKeyStorage = (userId?: number | null) =>
  `${seenNotificationKeysStoragePrefix}${userId ?? 'guest'}`;

const readSeenNotificationKeys = (userId?: number | null): Set<string> => {
  if (typeof window === 'undefined') return new Set<string>();
  const raw = window.localStorage.getItem(getSeenNotificationKeyStorage(userId));
  if (!raw) return new Set<string>();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set(parsed.filter(item => typeof item === 'string'));
  } catch {
    return new Set<string>();
  }
};

const hasSeenNotificationKey = (userId: number | null | undefined, key: string): boolean =>
  readSeenNotificationKeys(userId).has(key);

const persistSeenNotificationKey = (userId: number | null | undefined, key: string) => {
  if (typeof window === 'undefined') return;
  const seen = readSeenNotificationKeys(userId);
  seen.add(key);
  const capped = Array.from(seen).slice(-300);
  window.localStorage.setItem(getSeenNotificationKeyStorage(userId), JSON.stringify(capped));
};

const hasPendingLoginNotificationPopup = () => {
  if (typeof window === 'undefined') return false;
  return window.sessionStorage.getItem(loginNotificationPopupStorageKey) === '1';
};

const consumeLoginNotificationPopup = () => {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(loginNotificationPopupStorageKey);
};

const normalizeNotifications = (payload: unknown): StudyNotification[] => {
  if (Array.isArray(payload)) {
    return payload as StudyNotification[];
  }
  if (payload && typeof payload === 'object' && Array.isArray((payload as any).data)) {
    return (payload as any).data as StudyNotification[];
  }
  return [];
};

const parseNotificationDate = (value?: string | null) => {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;

  // New API responses are ISO 8601 with an explicit offset.  Parse those
  // first; otherwise the pattern below would discard `+07:00` and turn the
  // instant into a browser-local time.
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(trimmed)) {
    const parsedIso = new Date(trimmed);
    if (!Number.isNaN(parsedIso.getTime())) return parsedIso;
  }

  const match = trimmed.match(/^(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    const [, year, month, day, hour, minute, second] = match;
    const parsed = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second ?? '0')
    );
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const fallback = new Date(trimmed);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
};

const formatNotificationTimestamp = (value?: string | Date | null) => {
  const date = value instanceof Date ? value : parseNotificationDate(value);
  if (!date) return '';

  return date.toLocaleString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const withDeliveredTime = (message: string, deliveredAt: Date) => {
  const timestamp = formatNotificationTimestamp(deliveredAt);
  return timestamp ? `${message}\n\nแจ้งเตือนเมื่อ ${timestamp} น.` : message;
};

export const DashboardLayout = () => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const brandLogo = `${import.meta.env.BASE_URL}img/admin.png`;
  const logoCandidates = [brandLogo, robotImage];
  const logoUrl = logoCandidates[0];
  const handleLogoImageError = (event: SyntheticEvent<HTMLImageElement>) => {
    const target = event.currentTarget;
    const currentIndex = Number.parseInt(target.dataset.logoFallbackIndex ?? '0', 10);
    const nextIndex = Number.isFinite(currentIndex) ? currentIndex + 1 : 1;
    if (nextIndex >= logoCandidates.length) return;
    target.dataset.logoFallbackIndex = String(nextIndex);
    target.src = logoCandidates[nextIndex];
  };
  const { theme, setTheme } = useTheme();
  const [accentThemeId, setAccentThemeId] = useState(() => {
    if (typeof window === 'undefined') return accentThemes[0].id;
    const stored = window.localStorage.getItem(accentStorageKey);
    return stored === 'custom' || accentThemes.some(themeItem => themeItem.id === stored) ? stored : accentThemes[0].id;
  });
  const [customAccent, setCustomAccent] = useState(() => {
    if (typeof window === 'undefined') return '#3b82f6';
    return normalizeHexColor(window.localStorage.getItem(customAccentStorageKey) ?? '#3b82f6');
  });
  const activeAccentTheme = useMemo(
    () => {
      if (accentThemeId !== 'custom') {
        return accentThemes.find(themeItem => themeItem.id === accentThemeId) ?? accentThemes[0];
      }
      const onAccent = getContrastColor(customAccent);
      return {
        id: 'custom',
        label: 'Custom',
        accent: customAccent,
        accentStrong: shadeColor(customAccent, -16),
        accentSoft: shadeColor(customAccent, 38),
        accentRgb: hexToRgbString(customAccent),
        onAccent,
        onAccentRgb: onAccent === '#ffffff' ? '255,255,255' : '15,23,42',
        preview: customAccent,
      };
    },
    [accentThemeId, customAccent]
  );
  const [backgroundThemeId] = useState(backgroundThemes[0].id);
  const activeBackgroundTheme = useMemo(
    () => backgroundThemes.find(themeItem => themeItem.id === backgroundThemeId) ?? backgroundThemes[0],
    [backgroundThemeId]
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState<StudyNotification[]>([]);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [desktopThemeOpen, setDesktopThemeOpen] = useState(false);
  const [mobileThemeOpen, setMobileThemeOpen] = useState(false);
  const [logoPreviewOpen, setLogoPreviewOpen] = useState(false);
  const [webToasts, setWebToasts] = useState<InAppToast[]>([]);
  const [notifyLoading, setNotifyLoading] = useState(false);
  const [browserNotifyEnabled, setBrowserNotifyEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(browserNotifyEnabledStorageKey) !== '0';
  });
  const [browserNotifyPermission, setBrowserNotifyPermission] = useState<NotificationPermission | 'unsupported'>(
    () => {
      if (typeof window === 'undefined' || typeof window.Notification === 'undefined') return 'unsupported';
      return window.Notification.permission;
    }
  );
  const [now, setNow] = useState(() => new Date());
  const [fontScale] = useState(() => {
    if (typeof window === 'undefined') return 1;
    const stored = window.localStorage.getItem(fontScaleStorageKey);
    const parsed = stored ? Number.parseFloat(stored) : 1;
    if (!Number.isFinite(parsed)) return 1;
    return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, parsed));
  });
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const desktopNotificationDialogRef = useRef<HTMLDivElement | null>(null);
  const mobileDropdownRef = useRef<HTMLDivElement | null>(null);
  const mobileNotificationDialogRef = useRef<HTMLDivElement | null>(null);
  const mobileMenuRef = useRef<HTMLDivElement | null>(null);
  const mobileMenuDialogRef = useRef<HTMLDivElement | null>(null);
  const bottomNavScrollRef = useRef<HTMLElement | null>(null);
  const desktopThemeRef = useRef<HTMLDivElement | null>(null);
  const mobileThemeRef = useRef<HTMLDivElement | null>(null);
  const notifiedKeysRef = useRef<Set<string>>(new Set());
  const toastTimersRef = useRef<Map<string, number>>(new Map());
  const requestedBrowserPermissionRef = useRef(false);
  const hasLoadedNotificationsRef = useRef(false);
  const hasAutoOpenedNotificationsRef = useRef(false);
  const entryPopupKeysRef = useRef<Set<string>>(new Set());

  const unreadCount = useMemo(
    () => (Array.isArray(notifications) ? notifications.filter(n => !n.is_read).length : 0),
    [notifications]
  );
  const browserNotifySupported = browserNotifyPermission !== 'unsupported';

  const tryDesktopNotify = (title: string, body: string, id: number) => {
    if (!browserNotifyEnabled || !browserNotifySupported) return;
    if (typeof window === 'undefined' || typeof window.Notification === 'undefined') return;
    if (window.Notification.permission !== 'granted') return;

    const notification = new window.Notification(title, {
      body,
      tag: `slt-notification-${id}`,
      icon: logoUrl,
      badge: logoUrl,
    });
    notification.onclick = () => {
      window.focus();
      navigate('/notifications');
      notification.close();
    };
  };

  const dismissWebToast = (key: string) => {
    const timerId = toastTimersRef.current.get(key);
    if (timerId) {
      window.clearTimeout(timerId);
      toastTimersRef.current.delete(key);
    }
    setWebToasts(prev => prev.filter(item => item.key !== key));
  };

  const pushWebToast = (key: string, title: string, message: string) => {
    setWebToasts(prev => {
      if (prev.some(item => item.key === key)) return prev;
      return [{ key, title, message }, ...prev].slice(0, 4);
    });

    const currentTimer = toastTimersRef.current.get(key);
    if (currentTimer) window.clearTimeout(currentTimer);
    const timeoutId = window.setTimeout(() => {
      setWebToasts(prev => prev.filter(item => item.key !== key));
      toastTimersRef.current.delete(key);
    }, 9000);
    toastTimersRef.current.set(key, timeoutId);
  };

  const triggerDueNotification = (item: StudyNotification) => {
    const key = `${item.id}:${item.notify_at}`;
    if (notifiedKeysRef.current.has(key) || hasSeenNotificationKey(user?.id, key)) return;
    notifiedKeysRef.current.add(key);
    persistSeenNotificationKey(user?.id, key);
    const deliveredAtDate = new Date();
    const deliveredAt = deliveredAtDate.toISOString();
    setNotifications(prev => prev.map(notification => (
      notification.id === item.id && !notification.delivered_at
        ? { ...notification, delivered_at: deliveredAt }
        : notification
    )));
    if (item.id < 0) {
      markLocalNotificationAsDelivered(user?.id, item.id, deliveredAt);
    } else if (!item.delivered_at) {
      void api.patch(`/notifications/${item.id}/delivered`).catch(() =>
        api.post(`/notifications/${item.id}/delivered`).catch(() => undefined)
      );
    }
    const deliveredMessage = withDeliveredTime(item.message, deliveredAtDate);
    pushWebToast(key, item.title, deliveredMessage);
    tryDesktopNotify(item.title, deliveredMessage, item.id);
    setNotifyOpen(true);
  };

  const isDueNotification = (notifyAt: string, nowMs = Date.now()) => {
    const parsed = parseNotificationDate(notifyAt);
    if (!parsed) return false;
    const notifyMs = parsed.getTime();
    return notifyMs <= nowMs;
  };

  const requestBrowserNotificationPermission = async () => {
    if (!browserNotifySupported || typeof window === 'undefined' || typeof window.Notification === 'undefined') return;
    const permission = await window.Notification.requestPermission();
    setBrowserNotifyPermission(permission);
    const enabled = permission === 'granted';
    setBrowserNotifyEnabled(enabled);
    window.localStorage.setItem(browserNotifyEnabledStorageKey, enabled ? '1' : '0');
  };

  const toggleBrowserNotification = async () => {
    if (!browserNotifySupported) return;
    if (!browserNotifyEnabled) {
      await requestBrowserNotificationPermission();
      return;
    }
    setBrowserNotifyEnabled(false);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(browserNotifyEnabledStorageKey, '0');
    }
  };

  useEffect(() => {
    if (!browserNotifySupported || typeof window === 'undefined' || typeof window.Notification === 'undefined') return;
    if (!browserNotifyEnabled) return;
    if (window.Notification.permission !== 'default') return;
    if (requestedBrowserPermissionRef.current) return;

    requestedBrowserPermissionRef.current = true;
    void requestBrowserNotificationPermission();
  }, [browserNotifyEnabled, browserNotifySupported]);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => window.clearInterval(timerId);
  }, []);

  useEffect(() => {
    if (!browserNotifySupported || typeof document === 'undefined' || typeof window.Notification === 'undefined') return;
    const syncPermission = () => setBrowserNotifyPermission(window.Notification.permission);
    document.addEventListener('visibilitychange', syncPermission);
    window.addEventListener('focus', syncPermission);
    return () => {
      document.removeEventListener('visibilitychange', syncPermission);
      window.removeEventListener('focus', syncPermission);
    };
  }, [browserNotifySupported]);

  useEffect(() => {
    let alive = true;

    const sortByNotifyAtDesc = (items: StudyNotification[]) =>
      items
        .slice()
        .sort((a, b) => {
          const at = parseNotificationDate(a.notify_at)?.getTime() ?? 0;
          const bt = parseNotificationDate(b.notify_at)?.getTime() ?? 0;
          return bt - at;
        });

    const toTypeSlug = (value: unknown) =>
      String(value ?? '')
        .toLowerCase()
        .replace(/[^a-z]/g, '')
        .trim();

    const isVoiceSummaryNotification = (n: StudyNotification) => toTypeSlug(n.type) === 'voicesummary';

    const loadNotifications = async () => {
      const localItems = readLocalNotifications(user?.id).filter(n => !isVoiceSummaryNotification(n));
      try {
        if (!hasLoadedNotificationsRef.current) {
          setNotifyLoading(true);
        }
        const res = await api.get<StudyNotification[] | { data?: StudyNotification[] }>('/notifications');
        const remoteItems = normalizeNotifications(res.data).filter(n => !isVoiceSummaryNotification(n));
        const merged = sortByNotifyAtDesc([...localItems, ...remoteItems]);
        if (!alive) return;
        setNotifications(merged);

        // When the dashboard is opened after sign-in, show unread items before
        // the user starts interacting with the current page.
        const unreadItems = merged.filter(item => !item.is_read);
        if (
          !hasAutoOpenedNotificationsRef.current &&
          hasPendingLoginNotificationPopup() &&
          unreadItems.length > 0
        ) {
          hasAutoOpenedNotificationsRef.current = true;
          consumeLoginNotificationPopup();
          setNotifyOpen(true);
          unreadItems.slice(0, 3).forEach(item => {
            const entryKey = `entry:${item.id}:${item.notify_at}`;
            if (entryPopupKeysRef.current.has(entryKey)) return;
            entryPopupKeysRef.current.add(entryKey);
            pushWebToast(entryKey, item.title, item.message);
          });
        }

        // Notify only when due time has arrived.
        const nowMs = Date.now();
          merged
            .filter(item => !item.is_read && isDueNotification(item.notify_at, nowMs))
            .slice(0, 20)
            .forEach(item => {
              triggerDueNotification(item);
            });
      } catch (error) {
        if (!alive) return;
        setNotifications(sortByNotifyAtDesc(localItems));
      } finally {
        if (!alive) return;
        hasLoadedNotificationsRef.current = true;
        setNotifyLoading(false);
      }
    };

    void loadNotifications();

    const intervalId = window.setInterval(() => void loadNotifications(), 5000);
    const handleArchiveRefresh = () => void loadNotifications();
    const handleLocalRefresh = () => void loadNotifications();
    const handleRemoteRefresh = () => void loadNotifications();
    window.addEventListener('slt:archive-refresh', handleArchiveRefresh as EventListener);
    window.addEventListener(LOCAL_NOTIFICATIONS_EVENT, handleLocalRefresh as EventListener);
    window.addEventListener(REMOTE_NOTIFICATIONS_EVENT, handleRemoteRefresh as EventListener);
    return () => {
      alive = false;
      window.clearInterval(intervalId);
      window.removeEventListener('slt:archive-refresh', handleArchiveRefresh as EventListener);
      window.removeEventListener(LOCAL_NOTIFICATIONS_EVENT, handleLocalRefresh as EventListener);
      window.removeEventListener(REMOTE_NOTIFICATIONS_EVENT, handleRemoteRefresh as EventListener);
    };
  }, [browserNotifyEnabled, browserNotifySupported, logoUrl, navigate, user?.id]);

  useEffect(() => {
    if (!Array.isArray(notifications) || notifications.length === 0) return;
    const nowMs = now.getTime();
    notifications
      .filter(item => !item.is_read && isDueNotification(item.notify_at, nowMs))
      .slice(0, 20)
      .forEach(item => {
        triggerDueNotification(item);
      });
  }, [notifications, now]);

  useEffect(() => {
    return () => {
      toastTimersRef.current.forEach(timerId => window.clearTimeout(timerId));
      toastTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const search = window.location.search;
    const params = new URLSearchParams(search);
    const hasOAuthParams = Boolean(params.get('code') && params.get('state'));
    const hasError = Boolean(params.get('error'));

    if ((hasOAuthParams || hasError) && location.pathname !== '/notifications') {
      navigate(`/notifications${search}`, { replace: true });
    }
  }, [location.pathname, navigate]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const resetScrollPosition = () => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    };

    resetScrollPosition();
    const frame = window.requestAnimationFrame(resetScrollPosition);

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [location.pathname]);

  useEffect(() => {
    const handler = (ev: MouseEvent) => {
      const target = ev.target as Node;
      const clickedNotify =
        (dropdownRef.current && dropdownRef.current.contains(target)) ||
        (desktopNotificationDialogRef.current && desktopNotificationDialogRef.current.contains(target)) ||
        (mobileDropdownRef.current && mobileDropdownRef.current.contains(target)) ||
        (mobileNotificationDialogRef.current && mobileNotificationDialogRef.current.contains(target));
      if (!clickedNotify) {
        setNotifyOpen(false);
      }
      const clickedMobileMenu =
        (mobileMenuRef.current && mobileMenuRef.current.contains(target)) ||
        (mobileMenuDialogRef.current && mobileMenuDialogRef.current.contains(target));
      if (!clickedMobileMenu) {
        setMobileMenuOpen(false);
      }
      if (desktopThemeRef.current && !desktopThemeRef.current.contains(target)) {
        setDesktopThemeOpen(false);
      }
      if (mobileThemeRef.current && !mobileThemeRef.current.contains(target)) {
        setMobileThemeOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    // Keep the selected swatch intact, but use pastel fills with dark ink in light mode.
    const isLight = theme === 'light';
    const accent = isLight ? tintColor(activeAccentTheme.accent, 0.68) : activeAccentTheme.accent;
    const accentStrong = isLight ? tintColor(activeAccentTheme.accent, 0.58) : activeAccentTheme.accentStrong;
    const accentSoft = isLight ? tintColor(activeAccentTheme.accent, 0.82) : activeAccentTheme.accentSoft;
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-strong', accentStrong);
    root.style.setProperty('--accent-soft', accentSoft);
    root.style.setProperty('--accent-ink', getAccentInkColor(activeAccentTheme.accent, theme));
    root.style.setProperty('--accent-rgb', hexToRgbString(accent));
    root.style.setProperty('--on-accent', isLight ? '#0f172a' : activeAccentTheme.onAccent);
    root.style.setProperty('--on-accent-rgb', isLight ? '15,23,42' : activeAccentTheme.onAccentRgb);
    root.dataset.accent = activeAccentTheme.id;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(accentStorageKey, activeAccentTheme.id);
      window.localStorage.setItem(customAccentStorageKey, customAccent);
    }
  }, [activeAccentTheme, customAccent, theme]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const isDark = theme === 'dark';
    const base = isDark ? activeBackgroundTheme.darkBase : activeBackgroundTheme.lightBase;
    const gradient = isDark ? activeBackgroundTheme.darkGradient : activeBackgroundTheme.lightGradient;
    const panel = isDark ? activeBackgroundTheme.darkPanel : activeBackgroundTheme.lightPanel;
    const sidebar = isDark ? activeBackgroundTheme.darkSidebar : activeBackgroundTheme.lightSidebar;
    root.style.setProperty('--bg', base);
    root.style.setProperty('--bg-gradient', gradient);
    root.style.setProperty('--panel-bg', panel);
    root.style.setProperty('--sidebar-bg', sidebar);
    root.dataset.background = activeBackgroundTheme.id;
  }, [activeAccentTheme, activeBackgroundTheme, theme]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const nextScale = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, fontScale));
    root.style.fontSize = `${16 * nextScale}px`;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(fontScaleStorageKey, String(nextScale));
    }
  }, [fontScale]);

  useEffect(() => {
    document.body.classList.add('user-area');
    return () => {
      document.body.classList.remove('user-area');
    };
  }, []);

  const markAsRead = async (id: number) => {
    if (id < 0) {
      markLocalNotificationAsRead(user?.id, id);
      setNotifications(prev => prev.map(n => (n.id === id ? { ...n, is_read: true } : n)));
      return;
    }
    try {
      await api.patch(`/notifications/${id}/read`);
      setNotifications(prev => prev.map(n => (n.id === id ? { ...n, is_read: true } : n)));
    } catch (error) {
      try {
        await api.post(`/notifications/${id}/read`);
        setNotifications(prev => prev.map(n => (n.id === id ? { ...n, is_read: true } : n)));
      } catch (fallbackError) {
        // ignore
      }
    }
  };

  const deleteNotification = async (id: number) => {
    if (id < 0) {
      deleteLocalNotification(user?.id, id);
      setNotifications(prev => prev.filter(n => n.id !== id));
      return;
    }
    try {
      await api.delete(`/notifications/${id}`);
      setNotifications(prev => prev.filter(n => n.id !== id));
    } catch (error) {
      try {
        await api.post(`/notifications/${id}/delete`);
        setNotifications(prev => prev.filter(n => n.id !== id));
      } catch (fallbackError) {
        // ignore
      }
    }
  };

  const navItems: NavItem[] = useMemo(
    () => [
      { to: '/ai-assistant', label: 'หน้าหลัก', icon: 'assistant', accent: activeAccentTheme.accent },
      { to: '/overview', label: 'ตารางเรียน', icon: 'subjects', accent: activeAccentTheme.accent },
      { to: '/calendar', label: 'ปฏิทิน', icon: 'calendar', accent: activeAccentTheme.accent },
      { to: '/document-summary', label: 'สรุปเนื้อหาจากไฟล์', icon: 'documentSummary', accent: activeAccentTheme.accent },
      { to: '/archived-summaries', label: 'สรุปที่บันทึกไว้', icon: 'archive', accent: activeAccentTheme.accent },
      { to: '/quizzes', label: 'แบบฝึกหัด', icon: 'quizzes', accent: activeAccentTheme.accent },
      { to: '/goals', label: 'เป้าหมายของฉัน', icon: 'goals', accent: activeAccentTheme.accent },
      { to: '/learning-stats', label: 'สถิติ', icon: 'stats', accent: activeAccentTheme.accent },
      { to: '/career-advisor', label: 'อาชีพแนะนำ', icon: 'careerAdvisor', accent: activeAccentTheme.accent },
      { to: '/study-storage', label: 'ไฟล์ทั้งหมด', icon: 'studyStorage', accent: activeAccentTheme.accent },
      ],
      [activeAccentTheme.accent]
    );

  // The account actions below are intentionally kept separate from the main navigation.
  // Keep this list defined even while the desktop account section is visually hidden.
  const secondaryNavItems: NavItem[] = [];
  const latestNotifications = useMemo(() => notifications.slice(0, 3), [notifications]);
  const mobileNavItems = navItems.filter(item => item.showOnMobile !== false);
  const bottomNavItems = mobileNavItems.map(item =>
    item.to === '/ai-assistant'
      ? { ...item, label: 'หน้าหลัก', icon: 'overview' as IconName }
      : item.to === '/overview'
        ? { ...item, label: 'ตารางเรียน', icon: 'subjects' as IconName }
        : item
  );
  const mobileBottomNavItems = bottomNavItems.slice(0, 5);
  const topNavItems = bottomNavItems.slice(5);
  const isAiPage = location.pathname.startsWith('/ai-assistant');
  const isLearningStatsPage = location.pathname.startsWith('/learning-stats');
  useEffect(() => {
    const activeLink = bottomNavScrollRef.current?.querySelector<HTMLAnchorElement>('a[aria-current="page"]');
    activeLink?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [location.pathname]);
  const profileImageCandidates = useMemo(
    () => buildProfileImageCandidates([user?.profile_pic, user?.avatar], assetBaseURL || api.defaults.baseURL),
    [user?.profile_pic, user?.avatar]
  );
  const [profileImageIndex, setProfileImageIndex] = useState(0);
  useEffect(() => {
    setProfileImageIndex(0);
  }, [profileImageCandidates]);
  const profileImageUrl = profileImageCandidates[profileImageIndex] ?? null;
  const handleProfileImageError = () => {
    setProfileImageIndex(current =>
      current + 1 < profileImageCandidates.length ? current + 1 : profileImageCandidates.length
    );
  };
  const applyCustomAccent = (value: string) => {
    setCustomAccent(normalizeHexColor(value, customAccent));
    setAccentThemeId('custom');
  };
  const renderBottomNavigation = (
    items: NavItem[],
    responsiveClassName: string,
    attachScrollRef = false
  ) => {
    const itemCount = items.length;
    const slotPct = 100 / itemCount;
    const activeIndex = items.findIndex(
      item => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
    );
    const activeColor = activeAccentTheme.accent;
    const activeStrongColor = activeAccentTheme.accentStrong;
    const navItemColor = '#ffffff';
    const notchColor = theme === 'dark' ? '#020617' : '#f8fafc';

    return (
      <nav
        ref={attachScrollRef ? bottomNavScrollRef : undefined}
        className={`mobile-bottom-nav pointer-events-auto mx-auto w-full max-w-[1100px] overflow-x-auto ${responsiveClassName}`}
        style={{ scrollbarWidth: 'none' }}
      >
        <div className="mobile-bottom-nav__content relative overflow-visible">
          <div
            className="mobile-bottom-nav__pill absolute inset-x-0 bottom-0"
            style={{
              background: `linear-gradient(145deg, color-mix(in srgb, ${activeStrongColor} 58%, #06111f), color-mix(in srgb, ${activeColor} 38%, #071426))`,
              boxShadow: `0 14px 34px rgba(${activeAccentTheme.accentRgb},0.28), inset 0 1px 0 rgba(255,255,255,0.10)`
            }}
          />

          {activeIndex >= 0 ? (
            <div
              className="pointer-events-none absolute left-0 top-0 h-full transition-transform duration-[450ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]"
              style={{ width: `${slotPct}%`, transform: `translateX(${activeIndex * 100}%)` }}
            >
              <div
                className="mobile-bottom-nav__notch absolute left-1/2 -translate-x-1/2"
                style={{ color: notchColor }}
              >
                <svg width="100%" height="100%" viewBox="0 0 108 34" fill="currentColor" preserveAspectRatio="none">
                  <path d="M0 0 C 28 0, 27 34, 54 34 C 81 34, 80 0, 108 0 Z" />
                </svg>
              </div>
            </div>
          ) : null}

          <div className="relative z-10 flex h-full w-full">
            {items.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                aria-label={item.label}
                className="relative h-full outline-none"
                style={{ width: `${slotPct}%` }}
                onClick={() => {
                  if (item.to === '/ai-assistant' && typeof window !== 'undefined') {
                    window.dispatchEvent(new Event('smartroom:home-menu-pressed'));
                  }
                }}
              >
                {({ isActive }) => (
                  <span className="relative flex h-full w-full items-end justify-center">
                    <span
                      className="absolute left-1/2 flex items-center justify-center rounded-full transition-all duration-[450ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]"
                      style={{
                        transform: 'translateX(-50%)',
                        top: isActive
                          ? 'calc(var(--mobile-bottom-nav-pill-top) - var(--mobile-bottom-nav-active-lift))'
                          : 'calc(var(--mobile-bottom-nav-pill-top) + var(--mobile-bottom-nav-inactive-offset))',
                        height: isActive
                          ? 'var(--mobile-bottom-nav-active-size)'
                          : 'var(--mobile-bottom-nav-inactive-size)',
                        width: isActive
                          ? 'var(--mobile-bottom-nav-active-size)'
                          : 'var(--mobile-bottom-nav-inactive-size)',
                        backgroundColor: isActive ? activeColor : 'transparent',
                        zIndex: 1,
                        boxShadow: isActive
                          ? `0 7px 20px rgba(${activeAccentTheme.accentRgb},0.36)`
                          : 'none'
                      }}
                    >
                      <MobileIcon
                        name={item.icon}
                        active={false}
                        accent={navItemColor}
                        className={isActive ? 'h-6 w-6' : 'h-5 w-5'}
                      />
                    </span>

                    <span
                      className={`mobile-bottom-nav__label ${isActive ? 'is-active' : ''} pointer-events-none absolute inset-x-0 truncate px-1 text-center text-[11px] font-bold leading-none !text-white transition-colors duration-300`}
                      style={{ bottom: '10px', color: navItemColor, WebkitTextFillColor: navItemColor }}
                    >
                      {item.label}
                    </span>
                  </span>
                )}
              </NavLink>
            ))}
          </div>
        </div>
      </nav>
    );
  };
  return (
    <div
      className={`relative min-h-screen overflow-x-clip ${
        theme === 'dark' ? 'text-slate-100' : 'text-slate-900'
      }`}
      style={{ background: theme === 'dark' ? 'var(--bg-gradient)' : isLearningStatsPage ? '#ffffff' : '#fbfbfd' }}
    >
      <div className="relative flex min-h-screen w-full flex-col md:flex-row">
        <aside
          className={`sticky top-0 hidden h-screen max-h-screen w-[264px] shrink-0 flex-col gap-0 overflow-hidden border-r pb-5 backdrop-blur-xl md:flex ${
            theme === 'dark'
              ? 'border-white/10 bg-slate-950/70 text-white'
              : 'border-[color:var(--border)] bg-white/80 text-slate-700'
          }`}
          style={theme === 'dark' ? undefined : { boxShadow: '2px 0 12px rgba(0,0,0,0.02)' }}
        >
            <div
              className={`sticky top-0 z-20 flex h-[72px] items-center px-6 ${
                theme === 'dark'
                  ? 'border-b border-white/10 bg-slate-950/95'
                  : 'border-b border-[color:var(--border)] bg-white/70'
              } backdrop-blur`}
            >
              <Link to="/" className="flex items-center gap-3 text-lg font-semibold">
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setLogoPreviewOpen(true);
                  }}
	                  className={`flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl border transition ${
	                    theme === 'dark'
	                      ? 'border-white/10 bg-slate-950/40 hover:bg-slate-900/60'
	                      : 'border-slate-100 bg-gradient-to-br from-white to-slate-50 shadow-sm'
	                  }`}
	                  style={
	                    theme === 'dark'
	                      ? undefined
	                      : { backgroundColor: 'rgba(var(--accent-rgb), 0.10)' }
	                  }
	                  aria-label="ดูรูปโลโก้"
	                >
                  <img
                    src={logoUrl}
                    alt="โลโก้Smart Room"
                    className="h-full w-full rounded-2xl object-cover p-1"
                    onError={handleLogoImageError}
                  />
                </button>
                <span className={`text-[17px] font-semibold tracking-tight ${theme === 'dark' ? 'text-white' : 'text-[color:var(--text)]'}`}>Smart Room</span>
              </Link>
          </div>
          <nav className="flex-1 space-y-1.5 overflow-y-auto px-2 py-5">
            {navItems.map(item => {
              if (item.to === '/archived-summaries') return null;
              if (item.to === '/study-storage') {
                return (
                  <StorageNavigation
                    key={`${item.to}-${user?.id}`}
                    dark={theme === 'dark'}
                    to={item.to}
                    label={item.label}
                    icon={<MobileIcon name={item.icon} active={location.pathname === item.to} accent={theme === 'dark' ? '#ffffff' : activeAccentTheme.accent} className="h-5 w-5" />}
                  />
                );
              }
              const navigationLink = (
                <NavLink
                  key={item.to}
                  to={item.to}
                    className={({ isActive }) =>
                      `sidebar-menu-link group flex items-center gap-3 rounded-2xl px-4 py-2.5 text-[15px] transition-all duration-200 ${
                        theme === 'dark'
                          ? isActive
                            ? 'font-bold text-white'
                            : 'text-white/70 hover:bg-white/10 hover:text-white'
                          : isActive
                            ? 'font-bold text-[color:var(--text)]'
                            : 'text-[color:var(--text)] hover:bg-[color:var(--surface-3)]'
                      }`
                    }
                  >
                  {({ isActive }) => (
                    <>
                      <span className="sidebar-menu-icon relative flex h-[22px] w-[22px] shrink-0 items-center justify-center">
                        <MobileIcon
                          name={item.to === '/ai-assistant' ? 'overview' : item.icon}
                          active={isActive}
                          accent={theme === 'dark' ? '#ffffff' : activeAccentTheme.accent}
                          className="h-5 w-5"
                        />
                      </span>
	                      <span
	                        className="truncate"
	                        style={
	                          theme === 'dark'
                              ? isActive
                                ? { color: '#ffffff' }
                                : { color: 'rgba(255,255,255,0.82)' }
	                            : theme === 'light' && isActive
	                              ? { color: 'var(--text)' }
	                              : undefined
	                        }
	                      >
	                        {item.label}
	                      </span>
                    </>
                  )}
                </NavLink>
              );
              if (item.to === '/document-summary') {
                const archiveItem = navItems.find(navItem => navItem.to === '/archived-summaries')!;
                return (
                  <StorageNavigation
                    key={`${archiveItem.to}-${user?.id}`}
                    dark={theme === 'dark'}
                    to={archiveItem.to}
                    label={archiveItem.label}
                    icon={<MobileIcon name={archiveItem.icon} active={location.pathname === archiveItem.to} accent={theme === 'dark' ? '#ffffff' : activeAccentTheme.accent} className="h-5 w-5" />}
                    beforeNavigation={navigationLink}
                  />
                );
              }
              return navigationLink;
            })}
          </nav>
          <div className={`mt-auto px-3 pt-4 ${theme === 'dark' ? 'border-t border-white/10' : 'border-t border-slate-100'}`}>
            <nav className="mb-4 space-y-2" aria-label="เมนูผู้ใช้">
              {secondaryNavItems.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `group flex items-center gap-3 rounded-full px-3 py-2.5 text-sm font-medium transition ${
                      theme === 'dark'
                        ? isActive
                          ? 'bg-white/15 text-white'
                          : 'text-white/70 hover:bg-white/10 hover:text-white'
                        : isActive
                          ? 'bg-[color:rgba(var(--accent-rgb),0.12)] text-[color:var(--accent)]'
                          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                        <MobileIcon
                          name={item.icon}
                          active={isActive}
                          accent={theme === 'dark' ? '#ffffff' : activeAccentTheme.accent}
                          className="h-5 w-5"
                        />
                      </span>
                      <span className="truncate">{item.label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </nav>
            <Link
              to="/profile"
              className={`flex items-center gap-3 rounded-2xl border px-3 py-3 transition ${
                  theme === 'dark'
                    ? 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08]'
                    : 'border-slate-100 bg-white shadow-[0_6px_18px_rgba(15,23,42,0.05)] hover:bg-slate-50'
              }`}
            >
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-violet-600 text-white shadow-sm"
              >
                {profileImageUrl ? (
                  <img
                    src={profileImageUrl}
                    alt="โปรไฟล์"
                    className="h-full w-full object-cover"
                    referrerPolicy="no-referrer"
                    onError={handleProfileImageError}
                  />
                ) : (
                  <span className="text-sm font-semibold">
                    {(user?.name?.trim() || user?.email?.trim() || 'U').charAt(0).toUpperCase()}
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-sm font-semibold ${theme === 'dark' ? 'text-white' : 'text-sky-700'}`}>{user?.name ?? 'ผู้ใช้งาน'}</span>
                <span className={`block truncate text-[11px] ${theme === 'dark' ? 'text-white/55' : 'text-slate-500'}`}>
                  {user?.email ?? 'ดูโปรไฟล์'}
                </span>
              </span>
            </Link>
            <div className="mt-3">
              <button
                type="button"
                onClick={logout}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(225,29,72,0.18)] transition hover:bg-rose-700"
                style={{ color: '#ffffff', WebkitTextFillColor: '#ffffff' }}
              >
                <LogOut size={18} />
                ออกจากระบบ
              </button>
            </div>
          </div>
        </aside>

        <div
          className={`mobile-app-shell relative min-w-0 flex-1 px-0 pb-0 pt-0 ${isAiPage ? 'sm:px-0 md:h-screen md:overflow-hidden' : 'sm:px-6'}`}
          style={{
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            paddingTop: 'env(safe-area-inset-top, 0px)'
          }}
        >
          <header
            className={`sticky top-0 z-30 ml-auto hidden h-[72px] items-center justify-end overflow-visible border-b px-8 backdrop-blur-xl md:flex ${
              theme === 'dark'
                ? 'border-white/10 bg-slate-950/75 text-white'
                : 'border-slate-200/80 bg-[#fbfbfd]/90 text-slate-900'
            }`}
          >
            <div className="relative z-10 flex w-full items-center justify-end">
              <div className="flex flex-wrap items-center justify-end gap-3">
                <ThemeModeSwitch theme={theme} onChange={nextTheme => setTheme(nextTheme)} />
                  <div className="relative" ref={desktopThemeRef}>
                    <button
                      type="button"
                      onClick={() => {
                        setDesktopThemeOpen(prev => !prev);
                      }}
                      className={`flex h-10 w-10 items-center justify-center rounded-full border transition ${
                        theme === 'dark'
                          ? 'border-white/10 text-slate-200 hover:border-white/20 hover:bg-slate-950/30'
                          : 'border-slate-200 bg-white text-slate-600 shadow-sm hover:text-slate-900'
                      }`}
                      aria-label="เลือกสีธีม"
                      aria-expanded={desktopThemeOpen}
                      aria-haspopup="dialog"
                    >
                      <span
                        className="h-5 w-5 rounded-full border border-white/40 shadow-sm"
                        style={{
                          background: `linear-gradient(145deg, ${activeAccentTheme.accent}, ${activeAccentTheme.accentStrong})`
                        }}
                      />
                    </button>
                    {desktopThemeOpen && (
                      <div
                        className="fixed inset-0 z-[60] flex items-start justify-end bg-[linear-gradient(180deg,rgba(255,255,255,0.20),rgba(255,255,255,0.58))] px-6 pt-20 backdrop-blur-sm"
                        onClick={() => setDesktopThemeOpen(false)}
                        style={theme === 'dark' ? { background: 'rgba(2, 6, 23, 0.65)' } : undefined}
                        role="presentation"
                      >
                        <div
                          className="relative w-[min(92vw,27rem)] overflow-hidden rounded-[1.35rem] border border-white/80 bg-white/95 px-8 py-7 shadow-[0_22px_58px_rgba(15,23,42,0.14)] backdrop-blur"
                          role="dialog"
                          aria-modal="true"
                          aria-label="เลือกสีธีม"
                          onClick={event => event.stopPropagation()}
                        >
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() => setDesktopThemeOpen(false)}
                              className="absolute -right-1.5 -top-1.5 flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                              aria-label="ปิด"
                            >
                              <X size={19} weight="regular" />
                            </button>
                            <div className="pr-8">
                              <p className="text-[1.7rem] font-extrabold leading-none text-slate-950">สีทั้งหมด</p>
                         
                            </div>
                            <div className="mt-6 grid grid-cols-4 gap-x-8 gap-y-7">
                              {themeSwatches.map(color => {
                                const isSelected = activeAccentTheme.accent.toLowerCase() === color;
                                return (
                                  <button
                                    key={color}
                                    type="button"
                                    onClick={() => applyCustomAccent(color)}
                                    className={`relative flex h-[52px] w-[52px] items-center justify-center rounded-full transition hover:-translate-y-0.5 hover:scale-105 ${
                                      isSelected ? 'shadow-[0_14px_28px_rgba(15,23,42,0.22)]' : 'shadow-[0_8px_18px_rgba(148,163,184,0.14)]'
                                    }`}
                                    style={{ backgroundColor: tintColor(color) }}
                                    aria-label={`เลือกสี ${color}`}
                                  >
                                    {isSelected ? (
                                      <>
                                        <span className="pointer-events-none absolute -inset-3 rounded-full border border-slate-900/25 bg-white/25 shadow-[inset_0_1px_7px_rgba(255,255,255,0.85),0_0_0_5px_rgba(15,23,42,0.08),0_8px_18px_rgba(15,23,42,0.16)] backdrop-blur-[2px]" />
                                        <span className="pointer-events-none absolute -inset-1.5 rounded-full border-[2.5px] border-slate-950/80" />
                                        <span className="pointer-events-none absolute inset-1.5 rounded-full border border-slate-950/35" />
                                        <svg viewBox="0 0 24 24" className="relative z-10 h-7 w-7 text-slate-950" fill="none" aria-hidden="true">
                                          <path d="m5.5 12.5 4 4 9-9" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                      </>
                                    ) : null}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setNotifyOpen(v => !v)}
                  className={`relative flex h-11 w-11 items-center justify-center rounded-full border transition ${
                      theme === 'dark'
                        ? 'border-white/15 bg-slate-950/40 text-white'
                        : 'border-slate-200 bg-white text-slate-600 shadow-sm hover:text-slate-900'
                    }`}
                  title="การแจ้งเตือน"
                >
                  <MobileIcon name="notifications" accent={activeAccentTheme.accent} className="h-6 w-6" active />
                  {unreadCount > 0 && (
                    <span className="absolute -right-1 -top-1 rounded-full bg-rose-500 px-2 text-[11px] font-semibold text-white">
                      {unreadCount}
                    </span>
                  )}
                </button>
                {notifyOpen && typeof document !== 'undefined'
                  ? createPortal(
                      <>
                          <button
                            type="button"
                            className="fixed inset-0 z-[9998] hidden h-dvh w-screen cursor-default bg-slate-950/25 backdrop-blur-md lg:block"
                            onClick={() => setNotifyOpen(false)}
                            aria-label="ปิดการแจ้งเตือน"
                          />
                    <div
                      ref={desktopNotificationDialogRef}
                      className={`fixed right-10 top-20 z-[9999] hidden w-[440px] max-w-[80vw] max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-2xl border p-5 text-sm shadow-[0_22px_60px_rgba(15,23,42,0.22)] lg:block ${
                        theme === 'dark'
                          ? 'border-white/10 bg-slate-900/90 text-white'
                          : 'border-slate-100 bg-[color:var(--panel-bg)]'
                      }`}
                    >
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className={`flex items-center gap-2 text-base font-semibold ${theme === 'dark' ? 'text-[color:var(--text)]' : 'text-slate-950'}`}>
                        <MobileIcon name="notifications" accent={activeAccentTheme.accent} className="h-5 w-5" active />
                        แจ้งเตือนเรียน
                      </div>
                      <div className="flex items-center gap-2">
                        {browserNotifySupported ? (
                          <button
                            type="button"
                            onClick={() => void toggleBrowserNotification()}
                            className="rounded-full border border-muted px-2 py-[2px] text-[10px] font-semibold text-accent hover:opacity-90"
                            title={
                              browserNotifyPermission === 'granted'
                                ? 'ปิดการแจ้งเตือนผ่านเบราว์เซอร์'
                                : 'เปิดการแจ้งเตือนผ่านเบราว์เซอร์'
                            }
                          >
                            {browserNotifyEnabled && browserNotifyPermission === 'granted'
                              ? 'เด้งผ่านเบราว์เซอร์: เปิด'
                              : 'เด้งผ่านเบราว์เซอร์: ปิด'}
                          </button>
                        ) : null}
                            {notifyLoading && <span className="text-[11px] text-primary/70">กำลังโหลด...</span>}
                          </div>
                        </div>
                    {notifications.length === 0 ? (
                      <p className={`rounded-xl surface-2 px-3 py-3 ${theme === 'dark' ? 'text-muted' : 'text-slate-900'}`}>ยังไม่มีการแจ้งเตือน</p>
                    ) : (
                      <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                        {latestNotifications.map(n => (
                          <div
                            key={n.id}
                            className={`rounded-xl border px-4 py-3 ${n.is_read ? 'border-muted surface' : 'border-muted surface-2'}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="text-sm font-semibold text-[color:var(--text)]">{n.title}</p>
                                <p className={`text-[11px] ${theme === 'dark' ? 'text-muted' : 'text-slate-800'}`}>
                                  {n.delivered_at ? 'แจ้งเมื่อ ' : 'กำหนดแจ้ง '}
                                  {formatNotificationTimestamp(n.delivered_at ?? n.notify_at)}
                                </p>
                              </div>
                              <div className="flex gap-1">
                                {!n.is_read && (
                                  <button
                                    onClick={() => markAsRead(n.id)}
                                    className="rounded-full border border-muted px-2 py-[2px] text-[11px] font-semibold text-accent hover:opacity-90"
                                  >
                                    อ่านแล้ว
                                  </button>
                                )}
                                <button
                                  onClick={() => deleteNotification(n.id)}
                                  className={`rounded-full border border-muted px-2 py-[2px] text-[11px] font-semibold hover:opacity-90 ${theme === 'dark' ? 'text-muted' : 'text-slate-900'}`}
                                >
                                  ลบ
                                </button>
                              </div>
                            </div>
                            <p className={`mt-2 text-sm leading-relaxed ${theme === 'dark' ? 'text-muted' : 'text-slate-900'}`}>{n.message}</p>
                            <p className={`mt-1 text-[10px] uppercase tracking-wider ${theme === 'dark' ? 'text-muted' : 'text-slate-800'}`}>ประเภท: {n.type}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="mt-4 flex justify-center">
                      <Link
                        to="/notifications"
                        onClick={() => setNotifyOpen(false)}
                        className="rounded-full border border-muted px-5 py-2 text-xs font-semibold text-accent transition hover:opacity-90"
                      >
                        ดูทั้งหมด
                      </Link>
                    </div>
                    </div>
                      </>,
                      document.body
                    )
                  : null}
                  </div>
              </div>
            </div>
          </header>

          <div
            className="mobile-topbar mobile-topbar--minimal sticky top-0 z-40 mb-6 px-0 text-white md:hidden"
            style={{ background: 'var(--accent)' }}
          >
              <div className="relative mx-auto max-w-4xl px-5 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]" ref={mobileMenuRef}>
                <div className="flex items-center justify-between gap-3">
                  <Link
                    to="/profile"
                    aria-label="เปิดหน้าโปรไฟล์"
                    className="flex min-w-0 items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-3 shadow-sm"
                    style={{ background: 'var(--surface)' }}
                  >
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-bold text-white"
                      style={{ background: '#07152f' }}
                    >
                      {profileImageUrl ? (
                        <img
                          src={profileImageUrl}
                          alt="โปรไฟล์"
                          className="h-full w-full object-cover"
                          referrerPolicy="no-referrer"
                          onError={handleProfileImageError}
                        />
                      ) : (
                        <span>{user?.name?.charAt(0) ?? 'U'}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-medium" style={{ color: 'var(--muted)' }}>
                        สวัสดี, {user?.name?.split(' ')[0] ?? 'ผู้ใช้'} 👋
                      </p>
                      <p className="truncate text-sm font-bold" style={{ color: 'var(--text)' }}>Smart Room</p>
                    </div>
                  </Link>

                  <div className="flex items-center gap-2">
                    <ThemeModeSwitch theme={theme} onChange={setTheme} size="sm" />
                    <div className="relative" ref={mobileDropdownRef}>
                      <button
                        type="button"
                        onClick={() => {
                          setNotifyOpen(v => !v);
                          setMobileThemeOpen(false);
                          setMobileMenuOpen(false);
                        }}
                        className="relative flex h-10 w-10 items-center justify-center rounded-full border shadow-sm transition hover:opacity-90"
                        style={{
                          borderColor: 'rgba(255,255,255,0.72)',
                          background: '#ffffff',
                          color: 'var(--accent)'
                        }}
                        aria-label="การแจ้งเตือน"
                        aria-expanded={notifyOpen}
                        aria-haspopup="dialog"
                      >
                        <MobileIcon
                          name="notifications"
                          accent={activeAccentTheme.accent}
                          className="h-[18px] w-[18px]"
                          active
                        />
                        {unreadCount > 0 && (
                          <span
                            className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white"
                            style={{ boxShadow: '0 0 0 2px var(--surface)' }}
                            aria-label={`มีการแจ้งเตือนที่ยังไม่ได้อ่าน ${unreadCount} ข้อความ`}
                          >
                            {unreadCount > 99 ? '99+' : unreadCount}
                          </span>
                        )}
                      </button>
                      {notifyOpen && typeof document !== 'undefined'
                        ? createPortal(
                            <>
                              <button
                                type="button"
                                className="fixed inset-0 z-[9998] h-dvh w-screen cursor-default bg-slate-950/25 backdrop-blur-md lg:hidden"
                                onClick={() => setNotifyOpen(false)}
                                aria-label="ปิดการแจ้งเตือน"
                              />
                              <div
                                ref={mobileNotificationDialogRef}
                                className="fixed left-1/2 top-[5.35rem] z-[9999] w-[min(320px,calc(100vw-1.5rem))] -translate-x-1/2 rounded-2xl border p-3 text-sm shadow-[0_22px_60px_rgba(15,23,42,0.22)] lg:hidden"
                                style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
                                role="dialog"
                                aria-label="แจ้งเตือนเรียน"
                              >
                          <div className="mb-2 flex items-center justify-between">
                            <div className={`flex items-center gap-2 font-semibold ${theme === 'dark' ? 'text-[color:var(--text)]' : 'text-slate-950'}`}>
                              <MobileIcon
                                name="notifications"
                                accent={activeAccentTheme.accent}
                                className="h-5 w-5"
                                active
                              />
                              แจ้งเตือนเรียน
                            </div>
                            <div className="flex items-center gap-2">
                              {browserNotifySupported ? (
                                <button
                                  type="button"
                                  onClick={() => void toggleBrowserNotification()}
                                  className="rounded-full border px-2 py-[2px] text-[10px] font-semibold text-[color:var(--accent)] hover:opacity-90"
                                  style={{ borderColor: 'var(--border)' }}
                                >
                                  {browserNotifyEnabled && browserNotifyPermission === 'granted' ? 'แจ้งเตือน: เปิด' : 'แจ้งเตือน: ปิด'}
                                </button>
                              ) : null}
                              {notifyLoading && <span className="text-[11px] text-[color:var(--muted)]">กำลังโหลด...</span>}
                            </div>
                          </div>
                          {notifications.length === 0 ? (
                            <p className={`rounded-xl px-3 py-3 ${theme === 'dark' ? 'text-[color:var(--muted)]' : 'text-slate-900'}`} style={{ background: 'var(--surface-2)' }}>ยังไม่มีการแจ้งเตือน</p>
                          ) : (
                            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                              {latestNotifications.map(n => (
                                <div
                                  key={n.id}
                                  className="rounded-xl border px-3 py-2"
                                  style={{ borderColor: 'var(--border)', background: n.is_read ? 'var(--surface)' : 'var(--surface-2)' }}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div>
                                      <p className="text-[13px] font-semibold text-[color:var(--text)]">{n.title}</p>
                                      <p className={`text-[11px] ${theme === 'dark' ? 'text-[color:var(--muted)]' : 'text-slate-800'}`}>
                                        {n.delivered_at ? 'แจ้งจริงเมื่อ ' : 'กำหนดแจ้ง '}
                                        {formatNotificationTimestamp(n.delivered_at ?? n.notify_at)}
                                      </p>
                                    </div>
                                    <div className="flex gap-1">
                                      {!n.is_read && (
                                        <button
                                          type="button"
                                          onClick={() => markAsRead(n.id)}
                                          className="rounded-full border px-2 py-[2px] text-[11px] font-semibold text-[color:var(--accent)]"
                                          style={{ borderColor: 'var(--border)' }}
                                        >
                                          อ่านแล้ว
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => void deleteNotification(n.id)}
                                        className="rounded-full border px-2 py-[2px] text-[11px] font-semibold text-rose-500 transition hover:bg-rose-500/10"
                                        style={{ borderColor: 'rgba(244,63,94,0.28)' }}
                                      >
                                        ลบ
                                      </button>
                                    </div>
                                  </div>
                                  <p className={`mt-1 text-[13px] ${theme === 'dark' ? 'text-[color:var(--muted)]' : 'text-slate-900'}`}>{n.message}</p>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="mt-3 flex justify-center">
                            <Link
                              to="/notifications"
                              onClick={() => {
                                setNotifyOpen(false);
                                setMobileMenuOpen(false);
                              }}
                              className="rounded-full border px-4 py-1.5 text-[11px] font-semibold text-[color:var(--accent)] transition hover:opacity-90"
                              style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
                            >
                              ดูทั้งหมด
                            </Link>
                          </div>
                              </div>
                            </>,
                            document.body
                          )
                        : null}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setMobileMenuOpen(v => !v);
                        setMobileThemeOpen(false);
                        setNotifyOpen(false);
                      }}
                      className="flex h-10 w-10 items-center justify-center rounded-full border shadow-sm transition hover:opacity-90"
                      style={{
                        borderColor: 'rgba(255,255,255,0.72)',
                        background: '#ffffff',
                        color: 'var(--accent)'
                      }}
                      aria-label="เมนู"
                      aria-expanded={mobileMenuOpen}
                      aria-haspopup="menu"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="h-[18px] w-[18px]"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.1"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M5 7h14" />
                        <path d="M5 12h14" />
                        <path d="M5 17h14" />
                      </svg>
                    </button>
                  </div>
                </div>

                {mobileMenuOpen && typeof document !== 'undefined'
                  ? createPortal(
                <div
                  className="fixed inset-0 z-[9998]"
                >
                  <button
                    type="button"
                    aria-label="ปิดเมนู"
                    onClick={() => setMobileMenuOpen(false)}
                    className="absolute inset-0 h-dvh w-screen bg-slate-950/25 backdrop-blur-md"
                  />
                  <div
                    ref={mobileMenuDialogRef}
                    className={`absolute left-1/2 top-[max(1rem,env(safe-area-inset-top))] max-h-[calc(100dvh-2rem)] w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 overflow-y-auto rounded-[2rem] border p-6 shadow-[0_30px_80px_rgba(2,6,23,0.24)] ${
                      theme === 'dark'
                        ? 'border-white/10 bg-[#0b1220] text-white'
                        : 'border-slate-200 bg-white text-slate-900'
                    }`}
                  >
                    <div className="mb-5 flex items-start justify-between gap-4">
                      <div>
                        <p className={`text-2xl font-extrabold tracking-tight ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>เมนูเพิ่มเติม</p>
                       
                      </div>
                      <button
                        type="button"
                        onClick={() => setMobileMenuOpen(false)}
                        className={`flex h-11 w-11 items-center justify-center rounded-full border transition ${
                          theme === 'dark'
                            ? 'border-white/10 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white'
                            : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                        }`}
                        aria-label="ปิดเมนู"
                      >
                        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M18 6 6 18" />
                          <path d="m6 6 12 12" />
                        </svg>
                      </button>
                    </div>

                    <div className="space-y-4">
                    <Link
                      to="/profile"
                      onClick={() => setMobileMenuOpen(false)}
                      className={`flex items-center gap-3 rounded-[1.35rem] border p-4 transition ${
                        theme === 'dark'
                          ? 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08]'
                          : 'border-slate-100 bg-white shadow-[0_10px_28px_rgba(15,23,42,0.07)] hover:bg-slate-50'
                      }`}
                    >
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-violet-600 text-sm font-semibold text-white shadow-sm">
                        {profileImageUrl ? (
                          <img
                            src={profileImageUrl}
                            alt="โปรไฟล์"
                            className="h-full w-full object-cover"
                            referrerPolicy="no-referrer"
                            onError={handleProfileImageError}
                          />
                        ) : (
                          (user?.name?.trim() || user?.email?.trim() || 'U').charAt(0).toUpperCase()
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-sm font-semibold ${theme === 'dark' ? 'text-white' : 'text-sky-700'}`}>
                          {user?.name ?? 'ผู้ใช้งาน'}
                        </span>
                        <span className={`block truncate text-xs ${theme === 'dark' ? 'text-white/55' : 'text-slate-500'}`}>
                          {user?.email ?? 'ดูโปรไฟล์'}
                        </span>
                      </span>
                    </Link>

                    <div
                      className={`rounded-[1.6rem] border p-5 ${
                        theme === 'dark'
                          ? 'border-white/10 bg-white/[0.04]'
                          : 'border-slate-200 bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className={`text-base font-semibold ${theme === 'dark' ? 'text-white' : 'text-slate-800'}`}>โหมดการแสดงผล</p>
                       
                        </div>
                        <ThemeModeSwitch theme={theme} onChange={nextTheme => setTheme(nextTheme)} size="sm" />
                      </div>
                    </div>

                    <div
                      className="rounded-[1.35rem] border border-white/80 bg-white/95 px-5 py-6 text-slate-950 shadow-[0_16px_40px_rgba(15,23,42,0.13)]"
                      ref={mobileThemeRef}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-[1.45rem] font-extrabold leading-none text-slate-950">สีทั้งหมด</p>
            
                        </div>
                        <button
                          type="button"
                          onClick={() => setMobileMenuOpen(false)}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                          aria-label="ปิด"
                        >
                          <X size={18} weight="regular" />
                        </button>
                      </div>

                      <div className="mt-5 grid grid-cols-4 gap-x-5 gap-y-6">
                        {themeSwatches.map(color => {
                          const isSelected = activeAccentTheme.accent.toLowerCase() === color;
                          return (
                            <button
                              key={`mobile-theme-${color}`}
                              type="button"
                              onClick={() => applyCustomAccent(color)}
                              className={`relative flex h-[52px] w-[52px] items-center justify-center rounded-full transition active:scale-95 ${
                                isSelected ? 'shadow-[0_14px_26px_rgba(15,23,42,0.2)]' : 'shadow-[0_8px_18px_rgba(148,163,184,0.14)]'
                              }`}
                              style={{ backgroundColor: tintColor(color) }}
                              aria-label={`เลือกสี ${color}`}
                            >
                              {isSelected ? (
                                <>
                                  <span className="pointer-events-none absolute -inset-3 rounded-full border border-slate-900/25 bg-white/25 shadow-[inset_0_1px_7px_rgba(255,255,255,0.85),0_0_0_5px_rgba(15,23,42,0.08),0_8px_18px_rgba(15,23,42,0.16)] backdrop-blur-[2px]" />
                                  <span className="pointer-events-none absolute -inset-1.5 rounded-full border-[2.5px] border-slate-950/80" />
                                  <span className="pointer-events-none absolute inset-1.5 rounded-full border border-slate-950/35" />
                                  <svg viewBox="0 0 24 24" className="relative z-10 h-7 w-7 text-slate-950" fill="none" aria-hidden="true">
                                    <path d="m5.5 12.5 4 4 9-9" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                </>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <nav className="space-y-3" aria-label="เมนูฟังก์ชันเพิ่มเติม">
                      {topNavItems.map(item => (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          onClick={() => setMobileMenuOpen(false)}
                          className={({ isActive }) =>
                            `flex items-center gap-3 rounded-[1.25rem] border px-4 py-3.5 text-sm font-semibold transition ${
                              isActive
                                ? 'border border-[color:rgba(var(--accent-rgb),0.18)] bg-[color:rgba(var(--accent-rgb),0.10)] text-[color:var(--accent)]'
                                : theme === 'dark'
                                  ? 'border border-white/10 bg-white/[0.03] text-white/75 hover:bg-white/5 hover:text-white'
                                  : 'border border-slate-100 bg-slate-50/75 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                            }`
                          }
                        >
                          {({ isActive }) => (
                            <>
                              <span
                                className={`flex h-10 w-10 items-center justify-center rounded-full ${
                                  isActive
                                    ? 'bg-white shadow-sm'
                                    : theme === 'dark'
                                      ? 'bg-white/5'
                                      : 'bg-white'
                                }`}
                              >
                                <MobileIcon name={item.icon} active={isActive} accent={item.accent} className="h-4 w-4" />
                              </span>
                              <span>{item.label}</span>
                            </>
                          )}
                        </NavLink>
                      ))}
                    </nav>

                    <button
                      type="button"
                      onClick={logout}
                      className="flex w-full items-center justify-center gap-2.5 rounded-[1.25rem] border border-rose-400/50 bg-rose-600 px-4 py-4 text-sm font-bold text-white shadow-[0_14px_30px_rgba(225,29,72,0.24)] transition hover:bg-rose-700"
                      style={{ color: '#ffffff', WebkitTextFillColor: '#ffffff' }}
                    >
                      <LogOut size={18} />
                      ออกจากระบบ
                    </button>
                    </div>
                  </div>
                </div>
                    ,
                    document.body
                  )
                  : null}
              </div>
              <div
                className="mobile-topbar-wave pointer-events-none absolute inset-x-0 top-[calc(100%-2px)] h-10 text-[color:var(--accent)]"
                aria-hidden="true"
              >
                <svg viewBox="0 0 500 58" preserveAspectRatio="none" className="block h-full w-full">
                  <path
                    fill="currentColor"
                    d="M0 0H500V36C431 55 381 53 321 34C259 15 217 17 162 37C104 58 55 50 0 25Z"
                  />
                </svg>
              </div>
            </div>

          <main className={`relative z-10 ${isAiPage ? 'mt-0 md:h-[calc(100vh-72px)]' : 'mt-0 sm:mt-6'}`}>
            <div
              className={
                isAiPage
                  ? 'w-full px-0 pb-[calc(122px+env(safe-area-inset-bottom,0px))] md:h-full md:pb-0'
                  : 'w-full px-0 pb-[calc(122px+env(safe-area-inset-bottom,0px))] sm:px-6'
              }
            >
              <div className={isAiPage ? 'md:h-full' : undefined}>
                <Outlet />
              </div>
            </div>
          </main>
        </div>
      </div>

      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 px-4"
        style={{ paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + 14px)` }}
      >
        {renderBottomNavigation(mobileBottomNavItems, 'mobile-bottom-nav--compact md:hidden')}
      </div>

      {logoPreviewOpen && (
        <ModalOverlay
          className="fixed inset-0 flex items-center justify-center bg-black/70 px-6 py-10 backdrop-blur-sm"
          onClick={() => setLogoPreviewOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-[min(88vw,720px)] rounded-3xl bg-slate-900/80 p-4 sm:p-6 shadow-[0_25px_50px_rgba(0,0,0,0.45)]"
            onClick={event => event.stopPropagation()}
          >
            <img
              src={logoUrl}
              alt="โลโก้Smart Room"
              className="mx-auto h-auto max-h-[78vh] w-full rounded-2xl object-contain"
              onError={handleLogoImageError}
            />
          </div>
        </ModalOverlay>
      )}

      {webToasts.length > 0 && (
        <div className="pointer-events-none fixed right-3 top-20 z-[90] flex w-[min(92vw,380px)] flex-col gap-2 lg:right-4 lg:top-24">
          {webToasts.map(toast => (
            <div
              key={toast.key}
              className={`pointer-events-auto rounded-2xl border border-[color:rgba(var(--accent-rgb),0.25)] ${
                theme === 'dark' ? 'bg-slate-900/80' : 'bg-[color:var(--panel-bg)]'
              } p-3 shadow-[0_14px_35px_rgba(15,23,42,0.35)] backdrop-blur`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-[color:var(--text)]">{toast.title}</p>
                  <p className="mt-1 whitespace-pre-line text-xs text-muted">{toast.message}</p>
                </div>
                <button
                  type="button"
                  onClick={() => dismissWebToast(toast.key)}
                  className="rounded-full border border-muted px-2 py-0.5 text-[11px] font-semibold text-muted hover:text-[color:var(--text)]"
                >
                  ปิด
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DashboardLayout;
