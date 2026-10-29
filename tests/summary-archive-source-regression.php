<?php

require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Http\Controllers\API\SubjectArchiveController;
use App\Models\Subject;
use App\Models\SubjectArchive;
use App\Models\User;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

config(['database.default' => 'sqlite', 'database.connections.sqlite.database' => ':memory:']);
DB::purge('sqlite');
Schema::create('subjects_archives', function (Blueprint $table) {
    $table->id();
    $table->unsignedBigInteger('user_id');
    $table->unsignedInteger('original_subject_id')->nullable();
    $table->string('name');
    $table->longText('description')->nullable();
    $table->string('color')->nullable();
    $table->integer('target_hours')->nullable();
    $table->dateTime('start_date')->nullable();
    $table->dateTime('start_time')->nullable();
    $table->dateTime('end_time')->nullable();
    $table->dateTime('archived_at')->nullable();
});
DB::table('subjects_archives')->insert(['user_id' => 1, 'original_subject_id' => 2, 'name' => 'Existing summary', 'description' => 'Keep this summary']);
$migration = require __DIR__.'/../database/migrations/2026_10_06_000001_add_source_type_to_subjects_archives.php';
$migration->up();
$migration->up();
$check = static function (bool $condition, string $message): void {
    if (! $condition) throw new RuntimeException($message);
};
$check(Schema::hasColumn('subjects_archives', 'source_type'), 'Migration adds missing source_type and can be rerun');
$check(DB::table('subjects_archives')->where('id', 1)->value('description') === 'Keep this summary', 'Migration preserves existing summaries');
$controller = new SubjectArchiveController;
$subject = new Subject;
$subject->id = 2;
$subject->user_id = 1;
$subject->name = 'Algorithms';
$subject->start_date = '2026-10-07';
$subject->start_time = '08:30:00';
$subject->end_time = '11:30:00';
$user = new User;
$user->id = 1;
$description = str_repeat('สรุปบทเรียนโครงสร้างข้อมูล ', 4000);
foreach (['document-file', 'audio-file', 'live-audio'] as $source) {
    $request = Request::create('/api/subjects/2/summary-archives', 'POST', ['name' => 'Summary', 'description' => $description, 'source_type' => $source]);
    $app->instance('request', $request);
    $request->setUserResolver(fn () => $user);
    $response = $controller->store($request, $subject);
    $check($response->getStatusCode() === 201, 'Archive saves successfully for '.$source);
    $archive = SubjectArchive::query()->latest('id')->first();
    $check($archive->source_type === $source, 'Source is retained for '.$source);
    $check($archive->description === $description, 'Long Thai summary is retained');
    $check($archive->user_id === 1 && $archive->original_subject_id === 2, 'Archive belongs to the authenticated user and subject');
}
echo "Summary archive source regression checks passed.\n";
