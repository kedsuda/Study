<?php

require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Http\Controllers\API\StudyCalendarEventController;
use App\Models\StudyCalendarEvent;
use App\Models\User;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Exercise real controller persistence without touching application data.
config(['database.default' => 'sqlite', 'database.connections.sqlite.database' => ':memory:', 'app.timezone' => 'Asia/Bangkok']);
DB::purge('sqlite');
Schema::create('subjects', function (Blueprint $table) {
    $table->id();
    $table->unsignedBigInteger('user_id');
    $table->string('name');
    $table->date('start_date');
    $table->time('start_time');
    $table->time('end_time');
    $table->timestamps();
});
Schema::create('study_calendar_events', function (Blueprint $table) {
    $table->id();
    $table->unsignedBigInteger('user_id');
    $table->unsignedBigInteger('subject_id')->nullable();
    $table->unsignedBigInteger('study_log_id')->nullable();
    $table->string('title');
    $table->text('description')->nullable();
    $table->dateTime('start_time');
    $table->dateTime('end_time')->nullable();
    $table->string('status')->nullable();
    $table->text('metadata')->nullable();
    $table->timestamps();
});
$check = static function (bool $condition, string $message): void {
    if (! $condition) throw new RuntimeException($message);
};
$subjectId = DB::table('subjects')->insertGetId([
    'user_id' => 1, 'name' => 'Algorithms', 'start_date' => '2026-10-05',
    'start_time' => '12:30:00', 'end_time' => '15:30:00',
]);
$event = StudyCalendarEvent::create([
    'user_id' => 1, 'subject_id' => $subjectId, 'title' => 'Algorithms',
    'start_time' => '2026-10-05 12:30:00', 'end_time' => '2026-10-05 15:30:00',
    'metadata' => ['type' => 'class', 'source' => 'manual'],
]);
$controller = new StudyCalendarEventController;
$update = static function (array $payload) use ($controller, $event) {
    $request = Request::create('/api/calendar-events/'.$event->id, 'PUT', $payload);
    $user = new User;
    $user->id = 1;
    $request->setUserResolver(fn () => $user);
    return $controller->update($request, $event->fresh());
};
DB::table('subjects')->insert([
    'user_id' => 1, 'name' => 'Morning class', 'start_date' => '2026-10-05',
    'start_time' => '08:30:00', 'end_time' => '11:30:00',
]);
foreach (['UTC', 'Asia/Bangkok'] as $appTimezone) {
    config(['app.timezone' => $appTimezone]);
    $response = $update([
        'source' => 'subject', 'type' => 'class',
        'start_time' => '2026-10-05 12:30:00', 'end_time' => '2026-10-05 16:30:00',
    ]);
    $check($response->getStatusCode() === 200, 'Periods 5-8 must not conflict with 08:30-11:30 in '.$appTimezone);
}
config(['app.timezone' => 'UTC']);
$update(['source' => 'manual', 'end_time' => '2026-10-05 15:30:00']);
$response = $update(['start_time' => '2026-10-05 13:30:00']);
$check($response->getStatusCode() === 200, 'Manual class must not conflict with its own subject');
$check($event->fresh()->start_time->format('H:i') === '13:30', 'Move start from period 5 to period 6');
$response = $update(['source' => 'subject', 'type' => 'class', 'start_time' => '2026-10-05 13:30:00']);
$check($response->getStatusCode() === 200, 'Timetable edit succeeds');
$check(DB::table('subjects')->where('id', $subjectId)->value('start_time') === '13:30:00', 'Subject start persists for reload');
DB::table('subjects')->insert([
    'user_id' => 1, 'name' => 'Other class', 'start_date' => '2026-10-05',
    'start_time' => '15:30:00', 'end_time' => '16:30:00',
]);
$response = $update(['end_time' => '2026-10-05 16:30:00']);
$check($response->getStatusCode() === 422, 'Other subject overlap remains blocked');
$check($event->fresh()->end_time->format('H:i') === '15:30', 'Rejected edit preserves previous times');
StudyCalendarEvent::create([
    'user_id' => 1, 'title' => 'Other event',
    'start_time' => '2026-10-05 11:30:00', 'end_time' => '2026-10-05 12:30:00',
    'metadata' => ['type' => 'class', 'source' => 'manual'],
]);
$response = $update(['start_time' => '2026-10-05 11:30:00']);
$check($response->getStatusCode() === 422, 'Other calendar class overlap remains blocked');
$check(str_contains($response->getData(true)['message'], '11:30-12:30'), 'Conflict message keeps timetable wall-clock times');
$check($update(['end_time' => '2026-10-05 13:30:00'])->getStatusCode() === 422, 'Invalid time range remains blocked');
echo "Schedule edit regression checks passed.\n";
