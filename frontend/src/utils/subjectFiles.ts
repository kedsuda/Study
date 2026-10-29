type SubjectFile = {
  subject_id?: number | string | null;
  file_path?: string | null;
};

// The endpoint supplies the subject when older records have no subject_id.
// Prefer the explicit relation; the storage folder also identifies orphaned files.
export const belongsToSubject = (file: SubjectFile, subjectId: number): boolean => {
  if (file.subject_id != null) return Number(file.subject_id) === subjectId;
  const match = file.file_path?.match(/^study-files\/(\d+)\//);
  return !match || Number(match[1]) === subjectId;
};
