import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { apiFallbackClients } from '../services/api';
import { buildSemesterOptions, SemesterOption, toNumberOrNull } from '../utils/semester';

type SemesterSource = {
  semester_id?: number | null;
  semester?: number | null;
  academic_year?: number | null;
};

const unwrapCollection = (payload: any) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.data)) return payload.data.data;
  return [];
};

export const useSemesterOptions = () => {
  const [semesterOptions, setSemesterOptions] = useState<SemesterOption[]>([]);

  useEffect(() => {
    const loadSemesters = async () => {
      for (const client of apiFallbackClients) {
        try {
          const res = await client.get('/semesters');
          const rows = unwrapCollection(res.data);
          const semesters: SemesterSource[] = rows
            .map((item: any) => ({
              semester_id: toNumberOrNull(item?.semester_id),
              semester: toNumberOrNull(item?.semester),
              academic_year: toNumberOrNull(item?.academic_year),
            }))
            .filter((item: SemesterSource) =>
              Number.isFinite(item.semester_id) &&
              Number.isFinite(item.semester) &&
              Number.isFinite(item.academic_year)
            );

          setSemesterOptions(buildSemesterOptions(semesters));
          return;
        } catch (err: any) {
          const status = err?.response?.status;
          if (status && status !== 404 && status !== 405 && status !== 500) {
            break;
          }
        }
      }

      setSemesterOptions([]);
    };

    void loadSemesters();
  }, []);

  return semesterOptions;
};

// Keep controlled semester dropdowns on a real option once the list loads.
// This also handles a previously selected semester that was removed.
export const useDefaultSemesterSelection = (
  semesterOptions: SemesterOption[],
  selectedSemesterKey: string,
  setSelectedSemesterKey: Dispatch<SetStateAction<string>>,
) => {
  useEffect(() => {
    if (semesterOptions.length === 0) return;
    if (semesterOptions.some(option => option.key === selectedSemesterKey)) return;
    setSelectedSemesterKey(semesterOptions[0].key);
  }, [selectedSemesterKey, semesterOptions, setSelectedSemesterKey]);
};
