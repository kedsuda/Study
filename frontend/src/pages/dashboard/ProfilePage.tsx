import { useEffect, useState } from 'react';
import { SignOut } from 'phosphor-react';
import { useAppAlert } from '../../context/AppAlertContext';
import { useAuth } from '../../context/AuthContext';
import { api, apiFallbackClients, assetBaseURL } from '../../services/api';

type ProfileFormState = {
  name: string;
  education_level: string;
  previewUrl: string | null;
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

export const ProfilePage = () => {
  const { user, updateUser, logout } = useAuth();
  const { success, error } = useAppAlert();
  const [form, setForm] = useState<ProfileFormState>({
    name: '',
    education_level: '',
    previewUrl: null
  });
  const [saving, setSaving] = useState(false);
  const [profileImageFailed, setProfileImageFailed] = useState(false);

  useEffect(() => {
    if (!user) return;
    setForm(prev => ({
      ...prev,
      name: user.name ?? '',
      education_level: user.education_level ?? '',
      previewUrl: resolveProfileUrl(user.profile_pic ?? user.avatar, assetBaseURL || api.defaults.baseURL)
    }));
    setProfileImageFailed(false);
  }, [user]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) return;
    const trimmedName = form.name.trim();
    const trimmedEducationLevel = form.education_level.trim();
    if (!trimmedName) {
      error('กรุณากรอกชื่อผู้ใช้ก่อนบันทึก');
      return;
    }
    setSaving(true);
    try {
      // ส่งเป็น JSON เพื่อให้ PHP/Laravel อ่านข้อมูลจาก PUT ได้สม่ำเสมอ
      // (multipart/FormData กับ PUT อาจทำให้ education_level ไม่ถูกส่งถึงเซิร์ฟเวอร์)
      const requestPayload = {
        name: trimmedName,
        education_level: trimmedEducationLevel || null
      };

      let response: any = null;
      let lastError: unknown = null;

      for (const client of apiFallbackClients) {
        try {
          response = await client.put('/auth/profile', requestPayload);
          break;
        } catch (error: any) {
          const status = error?.response?.status;
          if (status === 404 || status === 405) {
            try {
              response = await client.post('/auth/profile', { ...requestPayload, _method: 'PUT' });
              break;
            } catch (fallbackError: any) {
              lastError = fallbackError;
              const fallbackStatus = fallbackError?.response?.status;
              if (fallbackStatus && fallbackStatus !== 404 && fallbackStatus !== 405 && fallbackStatus !== 500) {
                throw fallbackError;
              }
              continue;
            }
          }

          lastError = error;
          if (status && status !== 404 && status !== 405 && status !== 500) {
            throw error;
          }
        }
      }

      if (!response) {
        throw lastError ?? new Error('อัปเดตโปรไฟล์ไม่สำเร็จ');
      }

      const responseMessage = response.data?.message ?? 'บันทึกข้อมูลโปรไฟล์เรียบร้อยแล้ว';
      const payload = response.data?.user ?? response.data?.data ?? response.data ?? {};
      const nextName = payload?.name ?? trimmedName;
      const nextEducationLevel = payload?.education_level ?? trimmedEducationLevel;
      const cacheBustedProfilePic =
        typeof payload?.profile_pic === 'string' && payload.profile_pic.trim() !== ''
          ? `${payload.profile_pic}${payload.profile_pic.includes('?') ? '&' : '?'}v=${Date.now()}`
          : payload?.profile_pic;
      updateUser({
        ...user,
        ...payload,
        profile_pic: cacheBustedProfilePic ?? user.profile_pic ?? null,
        name: nextName,
        education_level: nextEducationLevel
      });
      setForm(prev => ({
        ...prev,
        name: nextName,
        education_level: nextEducationLevel,
        previewUrl: cacheBustedProfilePic
          ? resolveProfileUrl(cacheBustedProfilePic, assetBaseURL || api.defaults.baseURL)
          : prev.previewUrl
      }));
      success(responseMessage);
    } catch (err: any) {
      error(err?.response?.data?.message ?? 'อัปเดตชื่อผู้ใช้และระดับการศึกษาไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return (
      <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-[color:var(--text)]">
        กำลังโหลดโปรไฟล์...
      </div>
    );
  }

  const providerLabel = user.provider ?? 'อีเมล';
  const initial = (user.name || user.email || 'U').trim().charAt(0).toUpperCase();

  return (
    <div className="mx-auto w-full max-w-[760px] space-y-5 pb-10 text-[color:var(--text)]">
      <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5 shadow-[0_16px_36px_rgba(0,0,0,0.14)] sm:p-6">
        <div className="flex items-center gap-4">
          <div
            className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl text-3xl font-semibold text-white"
            style={{ background: 'linear-gradient(135deg, #8b5cf6, #6d5dd3)' }}
          >
            {form.previewUrl ? (
              <img
                src={form.previewUrl}
                alt={user.name ?? 'Profile'}
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
                onError={() => {
                  const fallback = resolveProfileUrl(user.avatar, assetBaseURL || api.defaults.baseURL);
                  if (fallback && fallback !== form.previewUrl) {
                    setForm(prev => ({ ...prev, previewUrl: fallback }));
                    return;
                  }
                  setProfileImageFailed(true);
                  setForm(prev => ({ ...prev, previewUrl: null }));
                }}
              />
            ) : (
              <span title={profileImageFailed ? 'ไม่สามารถโหลดรูปโปรไฟล์' : undefined}>{initial}</span>
            )}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold text-[color:var(--text)] sm:text-xl">{user.name}</h1>
            <p className="mt-1 truncate text-sm text-[color:var(--muted)]">{user.email}</p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5 shadow-[0_16px_36px_rgba(0,0,0,0.12)] sm:p-6">
        <h2 className="text-base font-bold text-[color:var(--text)]">ข้อมูลบัญชี</h2>
        <div className="mt-4 space-y-3">
          <div className="flex min-h-10 items-center justify-between gap-4 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] px-4 py-2.5">
            <span className="text-sm text-[color:var(--muted)]">ผู้ให้บริการ</span>
            <span className="min-w-0 truncate text-right text-sm text-[color:var(--muted)]">{providerLabel}</span>
          </div>
          <div className="flex min-h-10 items-center justify-between gap-4 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] px-4 py-2.5">
            <span className="text-sm text-[color:var(--muted)]">อีเมล</span>
            <span className="min-w-0 truncate text-right text-sm text-[color:var(--muted)]">{user.email}</span>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5 shadow-[0_16px_36px_rgba(0,0,0,0.12)] sm:p-6">
        <h2 className="text-base font-bold text-[color:var(--text)]">อัปเดตโปรไฟล์</h2>
        <form onSubmit={handleSubmit} className="mt-5 space-y-5">
          <div>
            <label className="mb-2 block text-sm text-[color:var(--muted)]">ชื่อผู้ใช้</label>
            <input
              value={form.name}
              onChange={event => setForm(prev => ({ ...prev, name: event.target.value }))}
              className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] px-4 py-3 text-sm font-semibold text-[color:var(--text)] outline-none transition focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:rgba(var(--accent-rgb),0.22)]"
              placeholder="ชื่อของคุณ"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[color:var(--muted)]">ระดับการศึกษา</label>
            <select
              value={form.education_level}
              onChange={event => setForm(prev => ({ ...prev, education_level: event.target.value }))}
              className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] px-4 py-3 text-sm text-[color:var(--text)] outline-none transition focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:rgba(var(--accent-rgb),0.22)]"
            >
              <option value="">เลือกระดับการศึกษา</option>
              <option value="ประถมศึกษา">ประถมศึกษา</option>
              <option value="มัธยมศึกษาตอนต้น">มัธยมศึกษาตอนต้น</option>
              <option value="มัธยมศึกษาตอนปลาย / ปวช.">มัธยมศึกษาตอนปลาย / ปวช.</option>
              <option value="ปวส. / อนุปริญญา">ปวส. / อนุปริญญา</option>
              <option value="ปริญญาตรี">ปริญญาตรี</option>
              <option value="ปริญญาโท">ปริญญาโท</option>
              <option value="ปริญญาเอก">ปริญญาเอก</option>
              <option value="อื่น ๆ">อื่น ๆ</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl bg-[#2f80df] px-4 py-3 text-sm font-bold text-white shadow-[0_12px_24px_rgba(47,128,223,0.24)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? 'กำลังบันทึก...' : 'บันทึกโปรไฟล์'}
          </button>
        </form>
      </section>

      <button
        type="button"
        onClick={() => void logout()}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-600 transition hover:bg-rose-100"
      >
        <SignOut size={18} weight="bold" aria-hidden="true" />
        ออกจากระบบ
      </button>
    </div>
  );
};
