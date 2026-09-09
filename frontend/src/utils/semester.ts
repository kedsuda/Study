export type SemesterSubjectLike = {
  semester_id?: number | string | null;
  semester?: number | string | null;
  academic_year?: number | string | null;
};

export type SemesterOption = {
  key: string;
  label: string;
  semester?: number | null;
  academic_year?: number | null;
};

export const toNumberOrNull = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const getSemesterKey = (subject?: SemesterSubjectLike | null) => {
  if (!subject) return null;
  const semesterId = toNumberOrNull(subject.semester_id);
  if (semesterId) return `id:${semesterId}`;
  const semester = toNumberOrNull(subject.semester);
  const year = toNumberOrNull(subject.academic_year);
  if (semester && year) return `sy:${semester}-${year}`;
  return null;
};

export const formatSemesterLabel = (semester?: number | null, academicYear?: number | null) => {
  if (semester && academicYear) return `ภาคเรียนที่ ${semester} ปีการศึกษา ${academicYear}`;
  if (semester) return `ภาคเรียนที่ ${semester}`;
  if (academicYear) return `ปีการศึกษา ${academicYear}`;
  return 'ไม่ระบุภาคเรียน';
};

export const buildSemesterOptions = <T extends SemesterSubjectLike>(subjects: T[]): SemesterOption[] => {
  const map = new Map<string, SemesterOption>();
  subjects.forEach(subject => {
    const key = getSemesterKey(subject);
    if (!key || map.has(key)) return;
    const semester = toNumberOrNull(subject.semester);
    const year = toNumberOrNull(subject.academic_year);
    map.set(key, {
      key,
      label: formatSemesterLabel(semester, year),
      semester,
      academic_year: year,
    });
  });

  const ordered = Array.from(map.values()).sort((a, b) => {
    const yearDiff = (b.academic_year ?? 0) - (a.academic_year ?? 0);
    if (yearDiff !== 0) return yearDiff;
    return (a.semester ?? 0) - (b.semester ?? 0);
  });

  return ordered;
};

export const filterBySemester = <T extends SemesterSubjectLike>(subjects: T[], semesterKey: string) => {
  if (!semesterKey || semesterKey === 'all') return subjects;
  return subjects.filter(subject => getSemesterKey(subject) === semesterKey);
};
