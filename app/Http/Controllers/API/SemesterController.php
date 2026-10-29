<?php

namespace App\Http\Controllers\API;

use App\Http\Controllers\Controller;
use App\Models\Semester;
use App\Models\Subject;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Throwable;

class SemesterController extends Controller
{
    public function __construct()
    {
        $this->middleware('auth:sanctum');
    }

    public function index(Request $request): JsonResponse
    {
        if (! $this->hasTableSafe((new Semester())->getTable())) {
            return response()->json([]);
        }

        $userId = $request->user()->id;
        $subjectTable = (new Subject())->getTable();
        $hasSubjects = $this->hasTableSafe($subjectTable) && Schema::hasColumn($subjectTable, 'semester_id');
        $hasMemberships = $this->hasTableSafe('user_semesters');

        if (! $hasSubjects && ! $hasMemberships) {
            return response()->json([]);
        }

        $semesters = Semester::query()
            ->where(function ($query) use ($userId, $subjectTable, $hasSubjects, $hasMemberships) {
                if ($hasSubjects) {
                    $query->whereExists(function ($subjects) use ($userId, $subjectTable) {
                        $subjects->selectRaw('1')->from($subjectTable)
                            ->whereColumn($subjectTable.'.semester_id', 'semester.semester_id')
                            ->where($subjectTable.'.user_id', $userId);
                    });
                }
                if ($hasMemberships) {
                    $query->orWhereExists(function ($memberships) use ($userId) {
                        $memberships->selectRaw('1')->from('user_semesters')
                            ->whereColumn('user_semesters.semester_id', 'semester.semester_id')
                            ->where('user_semesters.user_id', $userId);
                    });
                }
            })
            ->orderBy('semester')
            ->orderBy('academic_year')
            ->get();

        $payload = $semesters->map(fn (Semester $semester) => [
            'semester_id' => (int) $semester->semester_id,
            'semester' => (int) $semester->semester,
            'academic_year' => (int) $semester->academic_year,
        ]);

        return response()->json($payload);
    }

    public function store(Request $request): JsonResponse
    {
        if (! $this->hasTableSafe((new Semester())->getTable())) {
            return response()->json([
                'message' => 'ไม่พบตารางภาคเรียนในฐานข้อมูล',
            ], 422);
        }

        $data = $request->validate([
            'semester' => ['required', 'integer', 'min:1', 'max:3'],
            'academic_year' => ['required', 'integer', 'digits:4', 'min:2000', 'max:3000'],
        ]);

        $semesterValue = (int) $data['semester'];
        $academicYearValue = (int) $data['academic_year'];

        $semester = Semester::query()
            ->where('semester', $semesterValue)
            ->where('academic_year', $academicYearValue)
            ->first();

        if (! $semester) {
            try {
                $semester = Semester::query()->create([
                    'semester' => $semesterValue,
                    'academic_year' => $academicYearValue,
                ]);
            } catch (Throwable) {
                $nextId = (int) (DB::table('semester')->max('semester_id') ?? 0) + 1;
                DB::table('semester')->insert([
                    'semester_id' => $nextId,
                    'semester' => $semesterValue,
                    'academic_year' => $academicYearValue,
                ]);

                $semester = Semester::query()->find($nextId);
            }
        }

        // Semester definitions may be shared; membership belongs to the authenticated user.
        DB::table('user_semesters')->insertOrIgnore([
            'user_id' => $request->user()->id,
            'semester_id' => $semester->semester_id,
        ]);

        return response()->json([
            'semester_id' => (int) $semester->semester_id,
            'semester' => (int) $semester->semester,
            'academic_year' => (int) $semester->academic_year,
        ], 201);
    }

    private function hasTableSafe(string $table): bool
    {
        try {
            return Schema::hasTable($table);
        } catch (Throwable) {
            return false;
        }
    }
}
