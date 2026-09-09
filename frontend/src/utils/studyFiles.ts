import { supabase } from '../supabase';

type SubjectFolderInput = {
  id?: number | null;
  name?: string | null;
  semester?: number | null;
  academic_year?: number | null;
};

const bucketName = import.meta.env.VITE_SUPABASE_STORAGE_BUCKET?.trim() || 'bag';
const supabasePrefix = 'supabase:';

export const isSupabaseStudyFilePath = (filePath?: string | null) =>
  (filePath || '').trim().startsWith(supabasePrefix);

const formatSupabaseStorageError = (error: {
  message?: string;
  statusCode?: string;
  error?: string;
} | null | undefined, context: { bucket: string; path: string }) => {
  const details = [
    error?.message?.trim(),
    error?.error?.trim(),
    error?.statusCode ? `status=${error.statusCode}` : '',
    `bucket=${context.bucket}`,
    `path=${context.path}`,
  ].filter(Boolean);

  return details.length > 0
    ? `Supabase upload failed: ${details.join(' | ')}`
    : `Supabase upload failed: bucket=${context.bucket} | path=${context.path}`;
};

const sanitizeSegment = (value: string) => {
  const trimmed = value.trim();
  const dotIndex = trimmed.lastIndexOf('.');
  const hasExt = dotIndex > 0 && dotIndex < trimmed.length - 1;
  const rawBase = hasExt ? trimmed.slice(0, dotIndex) : trimmed;
  const rawExt = hasExt ? trimmed.slice(dotIndex + 1) : '';

  const normalizePart = (input: string) =>
    input
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

  const base = normalizePart(rawBase) || 'file';
  const ext = normalizePart(rawExt).replace(/\./g, '').toLowerCase();

  return ext ? `${base}.${ext}` : base;
};

const inferFileType = (file: File) => {
  const mime = (file.type || '').toLowerCase();
  const ext = file.name.split('.').pop()?.toLowerCase() || '';

  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
    return 'image';
  }
  if (mime === 'application/pdf' || ext === 'pdf') {
    return 'pdf';
  }
  if (
    mime.startsWith('audio/') ||
    ['mp3', 'wav', 'm4a', 'webm', 'ogg', 'aac', '3gp', '3gpp', 'mp4'].includes(ext)
  ) {
    return 'audio';
  }
  if (
    mime === 'application/msword' ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ['doc', 'docx', 'txt'].includes(ext)
  ) {
    return 'word';
  }
  return 'other';
};

const buildSemesterFolder = (subject?: SubjectFolderInput | null) => {
  const semester = Number(subject?.semester);
  const academicYear = Number(subject?.academic_year);

  if (Number.isFinite(semester) && Number.isFinite(academicYear)) {
    return `semester-${semester}-${academicYear}`;
  }

  return 'semester-unsorted';
};

const buildSubjectFolder = (subject?: SubjectFolderInput | null) => {
  const subjectId = Number(subject?.id);
  if (Number.isFinite(subjectId)) {
    return `subject-${subjectId}`;
  }

  return 'subject-general';
};

export const resolveStudyFileUrl = (filePath?: string | null, assetBase?: string) => {
  const cleanPath = (filePath || '').trim();
  if (!cleanPath) return '#';
  if (/^https?:\/\//i.test(cleanPath)) return cleanPath;
  if (!cleanPath.startsWith(supabasePrefix)) {
    const base = (assetBase || '').replace(/\/$/, '');
    return `${base}/storage/${cleanPath.replace(/^\/+/, '')}`;
  }
  const path = cleanPath.slice(supabasePrefix.length);
  const { data } = supabase.storage.from(bucketName).getPublicUrl(path);
  return data.publicUrl;
};

export const downloadStudyFileBlob = async (filePath?: string | null) => {
  const cleanPath = (filePath || '').trim();
  if (!cleanPath) {
    throw new Error('ไม่พบตำแหน่งไฟล์แนบ');
  }

  if (!cleanPath.startsWith(supabasePrefix)) {
    return null;
  }

  const path = cleanPath.slice(supabasePrefix.length);
  const { data, error } = await supabase.storage.from(bucketName).download(path);

  if (error || !data) {
    throw new Error(error?.message || 'ดาวน์โหลดไฟล์จาก Supabase ไม่สำเร็จ');
  }

  return data;
};

export const uploadStudyFileToSupabase = async ({
  file,
  userId,
  subject,
}: {
  file: File;
  userId?: number | null;
  subject?: SubjectFolderInput | null;
}) => {
  const safeOriginalName = sanitizeSegment(file.name);
  const fileName = `${Date.now()}_${safeOriginalName}`;
  const userFolder = Number.isFinite(Number(userId)) ? `user-${Number(userId)}` : 'user-anonymous';
  const storagePath = [
    userFolder,
    buildSemesterFolder(subject),
    buildSubjectFolder(subject),
    fileName,
  ].join('/');

  if (!bucketName) {
    throw new Error('Supabase upload failed: missing storage bucket name');
  }

  const { error } = await supabase.storage.from(bucketName).upload(storagePath, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || undefined,
  });

  if (error) {
    console.error('supabase storage upload failed', {
      bucket: bucketName,
      path: storagePath,
      file: {
        name: file.name,
        type: file.type,
        size: file.size,
      },
      error,
    });
    throw new Error(formatSupabaseStorageError(error, { bucket: bucketName, path: storagePath }));
  }

  return {
    bucket: bucketName,
    storagePath: `${supabasePrefix}${storagePath}`,
    fileType: inferFileType(file),
    publicUrl: resolveStudyFileUrl(`${supabasePrefix}${storagePath}`),
  };
};
