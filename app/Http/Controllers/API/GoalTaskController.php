<?php

namespace App\Http\Controllers\API;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class GoalTaskController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $dates = $request->validate([
            'start' => ['required', 'date_format:Y-m-d'],
            'end' => ['required', 'date_format:Y-m-d', 'after_or_equal:start'],
        ]);

        return response()->json($this->owned($request)
            ->whereBetween('task_date', [$dates['start'], $dates['end']])
            ->orderBy('task_date')->orderBy('start_time')->orderBy('id')->get()
            ->map(fn ($task) => $this->serialize($task)));
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validatedTask($request);
        $id = DB::table('goal_tasks')->insertGetId(array_merge($data, [
            'user_id' => $request->user()->id,
            'completed' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]));

        return response()->json($this->serialize($this->owned($request)->where('id', $id)->first()), 201);
    }

    public function update(Request $request, int $task): JsonResponse
    {
        abort_unless($this->owned($request)->where('id', $task)->exists(), 404);
        $data = $this->validatedTask($request);
        $this->owned($request)->where('id', $task)->update(array_merge($data, ['updated_at' => now()]));

        return response()->json($this->serialize($this->owned($request)->where('id', $task)->first()));
    }

    public function complete(Request $request, int $task): JsonResponse
    {
        abort_unless($this->owned($request)->where('id', $task)->exists(), 404);
        $data = $request->validate(['completed' => ['required', 'boolean']]);
        $this->owned($request)->where('id', $task)->update([
            'completed' => $data['completed'], 'updated_at' => now(),
        ]);

        return response()->json($this->serialize($this->owned($request)->where('id', $task)->first()));
    }

    public function destroy(Request $request, int $task): JsonResponse
    {
        abort_unless($this->owned($request)->where('id', $task)->delete(), 404);

        return response()->json(['message' => 'ลบงานเรียบร้อยแล้ว']);
    }

    private function owned(Request $request)
    {
        return DB::table('goal_tasks')->where('user_id', $request->user()->id);
    }

    private function validatedTask(Request $request): array
    {
        $request->merge(['title' => is_string($request->input('title')) ? trim($request->input('title')) : $request->input('title')]);

        return $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:5000'],
            'task_date' => ['required', 'date_format:Y-m-d'],
            'start_time' => ['nullable', 'required_with:end_time', 'date_format:H:i'],
            'end_time' => ['nullable', 'required_with:start_time', 'date_format:H:i', 'after:start_time'],
        ]) + ['description' => null, 'start_time' => null, 'end_time' => null];
    }

    private function serialize(object $task): array
    {
        return [
            'id' => (int) $task->id,
            'title' => $task->title,
            'description' => $task->description,
            'task_date' => $task->task_date,
            'start_time' => $task->start_time ? substr($task->start_time, 0, 5) : null,
            'end_time' => $task->end_time ? substr($task->end_time, 0, 5) : null,
            'completed' => (bool) $task->completed,
        ];
    }
}
