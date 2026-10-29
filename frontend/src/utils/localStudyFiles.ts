/** Study attachments use Laravel's public storage disk, not an external service. */
export const isSupabaseStudyFilePath = (filePath?: string | null) =>
  (filePath || '').trim().startsWith('supabase:');

export const resolveStudyFileUrl = (filePath?: string | null, assetBase?: string) => {
  const cleanPath = (filePath || '').trim();
  if (!cleanPath) return '#';
  if (/^https?:\/\//i.test(cleanPath)) return cleanPath;
  // This only identifies legacy records. New uploads always use local storage.
  if (isSupabaseStudyFilePath(cleanPath)) return '#';
  const relativePath = cleanPath.replace(/^\/+/, '');
  // While Vite is serving the UI, keep uploads on the current origin.  Vite
  // proxies /storage to Laravel/Apache, so this avoids a browser CORS request
  // to a different localhost port or host name.
  if (typeof window !== 'undefined' && /^517\d$/.test(window.location.port || '')) {
    return `/storage/${relativePath}`;
  }
  const base = (assetBase || '').replace(/\/$/, '');
  return base ? `${base}/storage/${relativePath}` : `/storage/${relativePath}`;
};

export const downloadStudyFileBlob = async (filePath?: string | null): Promise<Blob | null> => {
  if (isSupabaseStudyFilePath(filePath)) {
    throw new Error('ไฟล์เก่านี้อยู่ในที่เก็บภายนอก กรุณาอัปโหลดไฟล์จากเครื่องอีกครั้ง');
  }
  return null;
};
