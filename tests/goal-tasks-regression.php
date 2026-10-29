<?php

require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Http\Controllers\API\GoalTaskController;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

// Isolated in-memory database: never use the application's real data.
config(['database.default' => 'sqlite', 'database.connections.sqlite.database' => ':memory:']);
DB::purge('sqlite');
(require __DIR__.'/../database/migrations/2026_09_23_000001_create_goal_tasks_table.php')->up();
$controller = new GoalTaskController;
$request = static function (array $data, int $userId = 1): Request {
    $request = Request::create('/api/goals/tasks', 'POST', $data);
    $user = new User;
    $user->id = $userId;
    $request->setUserResolver(fn () => $user);
    return $request;
};
$check = static function (bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
};
$payload = ['title' => 'อ่านหนังสือ', 'task_date' => '2026-09-23', 'start_time' => '15:00', 'end_time' => '16:00'];
$task = $controller->store($request($payload))->getData(true);
$check($task['completed'] === false && $task['start_time'] === '15:00', 'New task and times');
$id = $task['id'];
$task = $controller->complete($request(['completed' => true]), $id)->getData(true);
$check($task['completed'] === true, 'Complete task');
$controller->complete($request(['completed' => true]), $id);
$task = $controller->complete($request(['completed' => false]), $id)->getData(true);
$check($task['completed'] === false, 'Undo completion');
$dates = ['start' => '2026-09-01', 'end' => '2026-09-30'];
$check(count($controller->index($request($dates))->getData(true)) === 1, 'Reload persisted task');
$check(count($controller->index($request($dates, 2))->getData(true)) === 0, 'User isolation');
foreach (['complete', 'update', 'destroy'] as $method) {
    try {
        $controller->$method($request($payload + ['completed' => true], 2), $id);
        throw new RuntimeException('Another user modified task');
    } catch (HttpException $e) { $check($e->getStatusCode() === 404, 'Ownership returns 404'); }
}
foreach ([['title' => '  '], ['end_time' => '14:00'], ['start_time' => null], ['task_date' => '2026-02-30']] as $invalid) {
    try {
        $controller->store($request(array_replace($payload, $invalid)));
        throw new RuntimeException('Invalid task accepted');
    } catch (ValidationException $e) { /* expected */ }
}
$task = $controller->update($request(['title' => 'สอบ', 'task_date' => '2026-10-01']), $id)->getData(true);
$check($task['start_time'] === null && $task['end_time'] === null, 'Clear scheduled times');
$check(count($controller->index($request($dates))->getData(true)) === 0, 'Moved task excluded from old month');
$controller->destroy($request([]), $id);
$check(DB::table('goal_tasks')->count() === 0, 'Delete persisted');
echo "Goal task regression checks passed.\n";
