import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { downloadStudyFileBlob } from '../utils/localStudyFiles';

type StoredFile = { id: number; original_name: string; mime_type?: string; file_path?: string; file_url?: string };
export function SubjectDocumentPicker({ subjectId, disabled, onSelect }: {
  subjectId: string; disabled?: boolean; onSelect: (file: File, fileId: number) => void;
}) {
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setFiles([]); setError('');
    if (!subjectId) return;
    api.get(`/subjects/${subjectId}/files`).then(res => {
      const rows = res.data?.data ?? res.data;
      const list: StoredFile[] = Array.isArray(rows) ? rows : [];
      if (active) setFiles(list.filter(file => /\.(pdf|docx?|txt)$/i.test(file.original_name)));
    }).catch(() => { if (active) setError('โหลดไฟล์ในรายวิชาไม่สำเร็จ'); });
    return () => { active = false; };
  }, [subjectId]);
  const select = async (id: string) => {
    const stored = files.find(file => String(file.id) === id);
    if (!stored) return;
    setBusy(true); setError('');
    try {
      const blob = await downloadStudyFileBlob(stored.file_path)
        ?? (await api.get(`/files/${stored.id}/download`, { responseType: 'blob' })).data as Blob;
      const header = await blob.slice(0, 256).text();
      if (/^\s*(<!doctype html|<html)/i.test(header)) throw new Error('Invalid document response');
      onSelect(new File([blob], stored.original_name, { type: stored.mime_type || blob.type }), stored.id);
    } catch { setError('เปิดไฟล์ต้นฉบับไม่สำเร็จ กรุณาลองอีกครั้ง'); }
    finally { setBusy(false); }
  };
  return <div className="mb-4 space-y-2">
    <label className="block text-sm font-semibold">ใช้ไฟล์ที่อัปโหลดไว้ในรายวิชา
      <select className="mt-2 w-full rounded-xl border border-muted surface px-4 py-3" disabled={disabled || busy || !subjectId} defaultValue="" onChange={event => { void select(event.target.value); event.target.value = ''; }}>
        <option value="">{busy ? 'กำลังเปิดไฟล์...' : 'เลือกไฟล์เดิมเพื่อสรุป โดยไม่อัปโหลดซ้ำ'}</option>
        {files.map(file => <option key={file.id} value={file.id}>{file.original_name}</option>)}
      </select>
    </label>
    {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
  </div>;
}
