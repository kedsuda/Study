<?php

require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Http\Controllers\API\LearningStatsController;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

// All fixtures live in memory; the application's database is never changed.
config(['database.default' => 'sqlite', 'database.connections.sqlite.database' => ':memory:']);
DB::purge('sqlite');
DB::statement('CREATE TABLE semester (semester_id INTEGER, semester INTEGER, academic_year INTEGER)');
DB::statement('CREATE TABLE subjects (id INTEGER, user_id INTEGER, semester_id INTEGER, name TEXT)');
DB::statement('CREATE TABLE study_logs (id INTEGER, subject_id INTEGER, log_date TEXT, duration_minutes INTEGER)');
DB::statement('CREATE TABLE quizzes (id INTEGER, subject_id INTEGER)');
DB::statement('CREATE TABLE quiz_questions (id INTEGER, quiz_id INTEGER)');
DB::statement('CREATE TABLE quiz_attempts (id INTEGER, quiz_id INTEGER, user_id INTEGER, score INTEGER, passed INTEGER, created_at TEXT)');
foreach ([[1, 1, 2569], [2, 2, 2569], [3, 1, 2568]] as [$id, $term, $year]) {
    DB::table('semester')->insert(['semester_id' => $id, 'semester' => $term, 'academic_year' => $year]);
}
foreach ([1, 2, 3, 4] as $id) {
    $owner = $id === 4 ? 2 : 1;
    DB::table('subjects')->insert(['id' => $id, 'user_id' => $owner, 'semester_id' => $id === 4 ? 1 : $id, 'name' => 'Subject '.$id]);
    DB::table('study_logs')->insert(['id' => $id, 'subject_id' => $id, 'log_date' => '2026-09-0'.$id, 'duration_minutes' => 60]);
    DB::table('quizzes')->insert(['id' => $id, 'subject_id' => $id]);
    DB::table('quiz_questions')->insert(['id' => $id, 'quiz_id' => $id]);
    DB::table('quiz_attempts')->insert(['id' => $id, 'quiz_id' => $id, 'user_id' => $owner, 'score' => 1, 'passed' => 1, 'created_at' => '2026-09-0'.$id.' 12:00:00']);
}
$controller = new LearningStatsController;
$user = new User;
$user->id = 1;
foreach ([[[], 3], [['academic_year' => 2569], 2], [['academic_year' => 2569, 'semester' => 1], 1], [['academic_year' => 2570], 0], [['subject_id' => 2], 1], [['subject_id' => 4], 0], [['subject_id' => 999], 0], [['subject_id' => 2, 'semester' => 1], 0]] as [$filters, $expected]) {
    $app->instance('request', Request::create('/api/learning-stats/summary', 'GET', $filters));
    foreach (['studyLogs', 'quizAttempts', 'allActivityDates'] as $method) {
        $args = $method === 'allActivityDates' ? [$user] : [$user, Carbon::parse('2026-09-01'), Carbon::parse('2026-09-30')];
        $result = (new ReflectionMethod($controller, $method))->invokeArgs($controller, $args);
        if (count($result) !== $expected) {
            throw new RuntimeException($method.' returned an incorrect count for '.json_encode($filters));
        }
    }
}
echo "Academic statistics filters and user isolation passed.\n";
