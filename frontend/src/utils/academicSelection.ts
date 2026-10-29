export type AcademicSelection = { key: string; year: string; semester: string; subject?: string };

export function mergeAcademicSelection(previous: AcademicSelection | null, next: AcademicSelection): AcademicSelection {
  const academicChanged = previous?.year !== next.year || previous?.semester !== next.semester;
  return { ...next, subject: next.subject ?? (academicChanged ? '' : previous?.subject ?? '') };
}

export function selectionFromSearch(params: URLSearchParams, previous: AcademicSelection | null): AcademicSelection | null {
  const hasAcademic = params.has('academic_year') || params.has('semester');
  if (!hasAcademic && !params.has('subject')) return previous;
  const year = hasAcademic ? params.get('academic_year') ?? '' : previous?.year ?? '';
  const semester = hasAcademic ? params.get('semester') ?? '' : previous?.semester ?? '';
  return {
    key: year && semester ? `sy:${semester}-${year}` : year ? `year:${year}` : 'all',
    year,
    semester,
    subject: params.get('subject') ?? '',
  };
}
