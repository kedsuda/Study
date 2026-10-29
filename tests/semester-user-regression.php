<?php

require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Http\Controllers\API\SemesterController;
use App\Models\User;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Test against an isolated database, never application records.
config(['database.default' => 'sqlite', 'database.connections.sqlite.database' => ':memory:']);
DB::purge('sqlite');
Schema::create('semester', function (Blueprint $table) {
    $table->increments('semester_id');
    $table->integer('semester');
    $table->integer('academic_year');
});
Schema::create('subjects', function (Blueprint $table) {
    $table->id();
    $table->unsignedBigInteger('user_id');
    $table->unsignedInteger('semester_id')->nullable();
});
DB::table('semester')->insert([
    ['semester_id' => 1, 'semester' => 1, 'academic_year' => 2568],
    ['semester_id' => 2, 'semester' => 2, 'academic_year' => 2568],
    ['semester_id' => 3, 'semester' => 1, 'academic_year' => 2569],
    ['semester_id' => 4, 'semester' => 3, 'academic_year' => 2569],
]);
DB::table('subjects')->insert([
    ['user_id' => 1, 'semester_id' => 1],
    ['user_id' => 1, 'semester_id' => 1],
    ['user_id' => 2, 'semester_id' => 2],
    ['user_id' => 2, 'semester_id' => 3],
]);
$migration = require __DIR__.'/../database/migrations/2026_10_07_000001_create_user_semesters_table.php';
$migration->up();
$migration->up(); // Safe to rerun; duplicate subjects produce one membership.
$check = static function (bool $condition, string $message): void {
    if (! $condition) throw new RuntimeException($message);
};
$check(DB::table('user_semesters')->count() === 3, 'Backfill memberships without duplicates or unused global terms');
$controller = new SemesterController;
$requestFor = static function (int $userId, string $method = 'GET', array $data = [], string $role = 'user') use ($app) {
    $user = new User;
    $user->id = $userId;
    $user->role = $role;
    $request = Request::create('/api/semesters', $method, $data);
    $app->instance('request', $request);
    $request->setUserResolver(fn () => $user);
    return $request;
};
$list = static function (int $userId, string $role = 'user') use ($controller, $requestFor) {
    return array_column($controller->index($requestFor($userId, 'GET', ['user_id' => 2], $role))->getData(true), 'semester_id');
};
$check($list(1) === [1], 'User 1 sees only their term, ignoring supplied user_id');
$check($list(2) === [3, 2], 'User 2 sees only their own terms in existing sort order');
$check($list(3) === [], 'New user sees no other users or unused terms');
$check($list(3, 'admin') === [], 'Personal filters remain scoped for admin accounts');
$response = $controller->store($requestFor(3, 'POST', ['semester' => 3, 'academic_year' => 2570, 'user_id' => 2]));
$check($response->getStatusCode() === 201, 'Create empty semester');
$createdId = $response->getData(true)['semester_id'];
$check($list(3) === [$createdId], 'Created semester appears without subjects');
$check(! in_array($createdId, $list(2), true), 'Created semester does not leak to another user');
$response = $controller->store($requestFor(1, 'POST', ['semester' => 3, 'academic_year' => 2570]));
$check($response->getData(true)['semester_id'] === $createdId, 'Users can independently add the same term definition');
$controller->store($requestFor(1, 'POST', ['semester' => 3, 'academic_year' => 2570]));
$check(DB::table('user_semesters')->where('user_id', 1)->where('semester_id', $createdId)->count() === 1, 'Repeated create keeps one membership');
DB::table('subjects')->insert(['user_id' => 1, 'semester_id' => 4]);
$check(in_array(4, $list(1), true), 'New subjects in an existing term are immediately visible');
$check(! in_array(4, $list(2), true), 'Subject-based membership remains user-scoped');
DB::table('subjects')->where('user_id', 1)->delete();
$check(in_array(1, $list(1), true), 'Backfilled semester remains available after subjects are removed');
echo "Semester user isolation regression checks passed.\n";
