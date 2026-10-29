import { useAcademicSearchParams } from '../hooks/useAcademicSelection';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CaretDown, CaretRight, Folder } from 'phosphor-react';
import learningInfoMedallion from '../img/learning-info-medallion.png';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

type StorageSubject = { id: number; name: string; semester?: number | null; academic_year?: number | null };
type SemesterOption = { semester_id: number; semester: number; academic_year: number };

type SidebarSelectProps = {
  id: string;
  value: string;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
};

const SidebarSelect = ({ id, value, placeholder, options, onChange, disabled = false }: SidebarSelectProps) => {
  return (
    <div className="relative min-w-0 w-full">
      <select
        id={id}
        aria-label={placeholder}
        value={value}
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
        className="h-9 w-full min-w-0 appearance-none rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] pl-2 pr-7 text-xs font-semibold text-[color:var(--text)] outline-none transition focus:border-[color:var(--accent)] focus:ring-1 focus:ring-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <option value="all">{placeholder}</option>
        {options.map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <CaretDown size={14} weight="bold" aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[color:var(--text)]" />
    </div>
  );
};
export const StorageNavigation = ({ icon, dark, to = '/study-storage', label = 'ไฟล์ทั้งหมด', beforeNavigation }: { icon: ReactNode; dark: boolean; to?: string; label?: string; beforeNavigation?: ReactNode }) => {
  const location = useLocation();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useAcademicSearchParams();
  const active = location.pathname === to;
  const idPrefix = to.slice(1);
  const separateAcademicFilters = to === '/archived-summaries';
  const subjectId = searchParams.get('subject');
  const [academicFiltersExpanded, setAcademicFiltersExpanded] = useState(true);
  const [semesterExpanded, setSemesterExpanded] = useState(true);
  const [academicYearExpanded, setAcademicYearExpanded] = useState(true);
  const [subjectsExpanded, setSubjectsExpanded] = useState(true);
  const [subjects, setSubjects] = useState<StorageSubject[]>([]);
  const [semesterRecords, setSemesterRecords] = useState<SemesterOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setSubjects([]);
    setSemesterRecords([]);
    if (!user?.id) return;
    setLoading(true);
    setFailed(false);
    void Promise.all([api.get('/subjects'), api.get('/semesters')]).then(([subjectsResponse, semestersResponse]) => {
      const subjectsPayload = subjectsResponse.data;
      const subjectRows = Array.isArray(subjectsPayload) ? subjectsPayload : Array.isArray(subjectsPayload?.data) ? subjectsPayload.data : subjectsPayload?.data?.data;
      const nextSubjects = (Array.isArray(subjectRows) ? subjectRows : [])
        .map((subject: any) => ({
          id: Number(subject.id),
          name: String(subject.name ?? subject.subject_name ?? '').trim(),
          semester: Number.isFinite(Number(subject.semester)) ? Number(subject.semester) : null,
          academic_year: Number.isFinite(Number(subject.academic_year)) ? Number(subject.academic_year) : null,
        }))
        .filter((subject: StorageSubject) => Number.isFinite(subject.id) && subject.name !== '');
      const semestersPayload = semestersResponse.data;
      const semesterRows = Array.isArray(semestersPayload) ? semestersPayload : Array.isArray(semestersPayload?.data) ? semestersPayload.data : semestersPayload?.data?.data;
      const nextSemesterRecords = (Array.isArray(semesterRows) ? semesterRows : [])
        .map((semester: any) => ({
          semester_id: Number(semester.semester_id),
          semester: Number(semester.semester),
          academic_year: Number(semester.academic_year),
        }))
        .filter((semester: SemesterOption) =>
          Number.isFinite(semester.semester_id) && Number.isFinite(semester.semester) && Number.isFinite(semester.academic_year)
        );
      if (!cancelled) {
        setSubjects(nextSubjects);
        setSemesterRecords(nextSemesterRecords);
      }
    }).catch(() => {
      if (!cancelled) setFailed(true);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [location.pathname, retry, user?.id]);

  const selectedSemesterKey = searchParams.get('semester') ?? 'all';
  const selectedAcademicYearKey = searchParams.get('academic_year') ?? 'all';
  const semesterOptions = useMemo(() => Array.from(new Set([
    ...semesterRecords.filter(record => record.academic_year === Number(selectedAcademicYearKey)).map(record => record.semester),
    ...subjects.filter(subject => subject.academic_year === Number(selectedAcademicYearKey)).flatMap(subject => subject.semester === null || subject.semester === undefined ? [] : [subject.semester]),
  ])).sort((a, b) => a - b), [semesterRecords, subjects, selectedAcademicYearKey]);
  const academicYearOptions = useMemo(() => Array.from(new Set([
    ...semesterRecords
      .map(record => record.academic_year),
    ...subjects
      .flatMap(subject => subject.academic_year === null || subject.academic_year === undefined ? [] : [subject.academic_year]),
  ])).sort((a, b) => b - a), [semesterRecords, subjects]);
  const filteredSubjects = subjects.filter(subject =>
    (selectedSemesterKey === 'all' || subject.semester === Number(selectedSemesterKey)) &&
    (selectedAcademicYearKey === 'all' || subject.academic_year === Number(selectedAcademicYearKey))
  );
  const updateFilter = (name: 'semester' | 'academic_year', value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === 'all') next.delete(name);
    else next.set(name, value);
    if (name === 'academic_year') next.delete('semester');
    next.delete('subject');
    setSearchParams(next);
  };
  const selectSubject = (subjectId: number | null) => {
    const next = new URLSearchParams(searchParams);
    if (subjectId === null) next.delete('subject');
    else next.set('subject', String(subjectId));
    setSearchParams(next);
  };
  const viewSearch = new URLSearchParams();
  for (const key of ['academic_year', 'semester', 'subject']) {
    const value = searchParams.get(key);
    if (value) viewSearch.set(key, value);
  }

  const rowTone = (selected: boolean) => selected
    ? `font-bold bg-[color:rgba(var(--accent-rgb),0.22)] ${dark ? 'text-white' : 'text-[color:var(--text)]'}`
    : dark ? 'text-white/70 hover:bg-white/10 hover:text-white' : 'text-[color:var(--muted)] hover:bg-[color:var(--surface-3)] hover:text-[color:var(--text)]';

  const academicFilters = (
    <>
        <li className="pb-2">
          <button type="button" onClick={() => setAcademicYearExpanded(value => !value)} aria-expanded={academicYearExpanded} aria-controls={`${idPrefix}-academic-year-filter`} className="flex w-full items-center gap-2 rounded-lg py-1.5 text-left text-[13px] font-semibold text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--accent)]">
            <CaretRight size={12} weight="bold" className={`transition-transform ${academicYearExpanded ? 'rotate-90' : ''}`} />
            <Folder size={18} weight="fill" className="text-amber-400" />
            <span>ปีการศึกษา</span>
          </button>
          <div id={`${idPrefix}-academic-year-filter`} hidden={!academicYearExpanded} className="ml-[25px] border-l border-[color:var(--border)] pl-3">
            <SidebarSelect
              id={`${idPrefix}-academic-year-select`}
              value={selectedAcademicYearKey}
              placeholder="เลือกปีการศึกษา"
              options={academicYearOptions.map(year => ({ value: String(year), label: String(year) }))}
              onChange={value => updateFilter('academic_year', value)}
            />
          </div>
        </li>
        <li className="pb-2">
          <button type="button" onClick={() => setSemesterExpanded(value => !value)} aria-expanded={semesterExpanded} aria-controls={`${idPrefix}-semester-filter`} className="flex w-full items-center gap-2 rounded-lg py-1.5 text-left text-[13px] font-semibold text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--accent)]">
            <CaretRight size={12} weight="bold" className={`transition-transform ${semesterExpanded ? 'rotate-90' : ''}`} />
            <Folder size={18} weight="fill" className="text-amber-400" />
            <span>ภาคเรียน</span>
          </button>
          <div id={`${idPrefix}-semester-filter`} hidden={!semesterExpanded} className="ml-[25px] border-l border-[color:var(--border)] pl-3">
            <SidebarSelect
              id={`${idPrefix}-semester-select`}
              key={selectedAcademicYearKey}
              disabled={selectedAcademicYearKey === 'all'}
              value={selectedSemesterKey}
              placeholder={selectedAcademicYearKey === 'all' ? 'เลือกปีการศึกษาก่อน' : 'เลือกภาคเรียน'}
              options={semesterOptions.map(semester => ({ value: String(semester), label: `ภาคเรียนที่ ${semester}` }))}
              onChange={value => updateFilter('semester', value)}
            />
          </div>
        </li>
    </>
  );

  return (
    <div>
      {separateAcademicFilters && (
        <section className="mb-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-2 shadow-sm" aria-labelledby={`${idPrefix}-recommendation-heading`}>
          <h2 id={`${idPrefix}-recommendation-heading`} className="text-[15px] font-semibold text-[color:var(--text)]">
            <button type="button" onClick={() => setAcademicFiltersExpanded(value => !value)} aria-expanded={academicFiltersExpanded} aria-controls={`${idPrefix}-academic-filters`} className="group flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-[color:var(--surface-3)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--accent)]">
              <img src={learningInfoMedallion} alt="" aria-hidden="true" width={36} height={36} className="h-9 w-9 shrink-0 object-contain" />
              <span className="flex-1">ข้อมูลการเรียน</span>
              <CaretRight size={14} weight="bold" aria-hidden="true" className={`shrink-0 text-[color:var(--muted)] transition-transform duration-200 ${academicFiltersExpanded ? 'rotate-90' : ''}`} />
            </button>
          </h2>
          <div id={`${idPrefix}-academic-filters`} hidden={!academicFiltersExpanded} className="mx-2 mt-2 border-t border-[color:var(--border)] pt-3">
            <ul aria-label="ปีการศึกษา ภาคเรียน และรายวิชา">
              {academicFilters}
              <li className="pb-2">
                <button type="button" onClick={() => setSubjectsExpanded(value => !value)} aria-expanded={subjectsExpanded} aria-controls={`${idPrefix}-subject-filter`} className="flex w-full items-center gap-2 rounded-lg py-1.5 text-left text-[13px] font-semibold text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--accent)]">
                  <CaretRight size={12} weight="bold" className={`transition-transform ${subjectsExpanded ? 'rotate-90' : ''}`} />
                  <Folder size={18} weight="fill" className="text-amber-400" />
                  <span>รายวิชา</span>
                </button>
                <div id={`${idPrefix}-subject-filter`} hidden={!subjectsExpanded} className="ml-[25px] border-l border-[color:var(--border)] pl-3">
                  <SidebarSelect
                    id={`${idPrefix}-subject-select`}
                    key={`${selectedAcademicYearKey}-${selectedSemesterKey}`}
                    value={subjectId ?? 'all'}
                    placeholder={selectedAcademicYearKey === 'all' || selectedSemesterKey === 'all' ? 'เลือกปีและภาคเรียนก่อน' : loading ? 'กำลังโหลดรายวิชา...' : failed ? 'โหลดรายวิชาไม่สำเร็จ' : 'เลือกรายวิชา'}
                    disabled={selectedAcademicYearKey === 'all' || selectedSemesterKey === 'all' || loading || failed}
                    options={filteredSubjects.map(subject => ({ value: String(subject.id), label: subject.name }))}
                    onChange={value => selectSubject(value === 'all' ? null : Number(value))}
                  />
                  {!loading && !failed && selectedAcademicYearKey !== 'all' && selectedSemesterKey !== 'all' && filteredSubjects.length === 0 && (
                    <p className="pt-2 text-xs text-[color:var(--muted)]">ยังไม่มีรายวิชาในภาคเรียนนี้</p>
                  )}
                </div>
              </li>
            </ul>
            {failed && <button type="button" onClick={() => setRetry(value => value + 1)} className="py-2 text-left text-xs text-[color:var(--muted)]">โหลดตัวกรองไม่สำเร็จ กรุณาลองอีกครั้ง</button>}
          </div>
        </section>
      )}
      {beforeNavigation && <div className="mb-1.5">{beforeNavigation}</div>}
      <div className={`flex items-center rounded-2xl transition-colors ${active ? 'font-bold text-[color:var(--text)]' : rowTone(false)}`}>
        <Link to={`${to}?${viewSearch.toString()}`} aria-current={active ? 'page' : undefined} className="sidebar-menu-link flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-4 py-2.5 text-[15px]" style={{ color: dark ? '#ffffff' : 'inherit' }}>
          <span className="sidebar-menu-icon flex h-[22px] w-[22px] shrink-0 items-center justify-center">{icon}</span>
          <span className="truncate">{label}</span>
        </Link>
      </div>
      {!separateAcademicFilters && to !== '/study-storage' && <ul id={`${idPrefix}-subject-navigation`} className="mb-3 ml-[27px] mr-2 mt-1 border-l border-[color:var(--border)] pl-3" aria-label="ตัวกรองรายวิชา">
        <li>
          <div className={`px-2 pb-1 pt-2 text-xs font-medium ${dark ? 'text-white/50' : 'text-[color:var(--muted)]'}`}>
            <span>กรองตามรายวิชา</span>
          </div>
          <ul id={`${idPrefix}-subject-list`} className="space-y-1" aria-label="รายวิชา">
            <li>
              <button type="button" onClick={() => selectSubject(null)} aria-pressed={!subjectId} className={`w-full rounded-lg px-2 py-2 text-left text-[13px] ${rowTone(!subjectId)}`}>
                ทุกวิชา
              </button>
            </li>
            {loading ? <li className="py-2 text-xs text-[color:var(--muted)]" role="status">กำลังโหลดรายวิชา...</li> : failed ? (
              <li><button type="button" onClick={() => setRetry(value => value + 1)} className="py-2 text-left text-xs text-[color:var(--muted)]">โหลดรายวิชาไม่สำเร็จ กรุณาลองอีกครั้ง</button></li>
            ) : separateAcademicFilters && (selectedSemesterKey === 'all' || selectedAcademicYearKey === 'all') ? (
              <li className="py-2 text-xs text-[color:var(--muted)]">เลือกปีการศึกษาและภาคเรียนก่อน</li>
            ) : filteredSubjects.length === 0 ? <li className="py-2 text-xs text-[color:var(--muted)]">ยังไม่มีรายวิชา</li> : filteredSubjects.map(subject => {
              const selected = Number(subjectId) === subject.id;
              return (
                <li key={subject.id}>
                  <button
                    type="button"
                    onClick={() => selectSubject(subject.id)}
                    aria-pressed={selected}
                    title={subject.name}
                    className={`flex w-full min-w-0 items-start gap-2 rounded-lg px-2 py-2 text-left text-[13px] leading-5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--accent)] ${selected ? 'font-semibold' : rowTone(false)}`}
                    style={selected ? {
                      backgroundColor: 'var(--accent-strong)',
                      color: 'var(--on-accent)',
                      WebkitTextFillColor: 'var(--on-accent)',
                    } : undefined}
                  >
                    <Folder size={16} weight={selected ? 'fill' : 'regular'} aria-hidden="true" className="mt-0.5 shrink-0 opacity-70" />
                    <span className="min-w-0 whitespace-normal break-words">{subject.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </li>
      </ul>}
    </div>
  );
};
