<?php
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
set_exception_handler(function ($error) { fwrite(STDERR, $error->getMessage()."\n".$error->getTraceAsString()."\n"); exit(1); });

use App\Models\QuizQuestion;
use App\Models\Subject;
use App\Services\AI\AIService;

$service = (new ReflectionClass(AIService::class))->newInstanceWithoutConstructor();
$check = static function ($actual, $expected, $case) {
    if ($actual !== $expected) throw new RuntimeException($case.': '.json_encode($actual, JSON_UNESCAPED_UNICODE));
};
$grade = new ReflectionMethod(AIService::class, 'isQuizAnswerCorrect');
foreach ([
    ['short_answer', 'กรุงเทพมหานคร', 'กรุงเทพ มหานคร', true],
    ['short_answer', 'กรุงเทพมหานคร', 'กรุงเทพ', false],
    ['short_answer', 'กรุงเทพมหานคร', 'ไม่ใช่กรุงเทพมหานคร', false],
    ['short_answer', '1.5', '15', false],
    ['short_answer', '-10', '10', false],
    ['short_answer', '10', '100', false],
    ['short_answer', 'Photosynthesis', 'photosynthesis.', true],
    ['true_false', 'true', 'ถูก', true],
    ['true_false', 'false', 'ถูก', false],
] as [$type, $correct, $answer, $expected]) {
    $question = new QuizQuestion(['question_type' => $type, 'correct_answer' => $correct]);
    $check($grade->invoke($service, $question, $answer), $expected, $type.' '.$answer);
}
$normalize = new ReflectionMethod(AIService::class, 'normalizeQuizQuestions');
$zero = $normalize->invoke($service, [['question_text' => 'ผลลัพธ์เป็นจำนวนใด', 'question_type' => 'short_answer', 'correct_answer' => '0']], 1);
$check($zero[0]['correct_answer'] ?? null, '0', 'zero is a valid answer');
$longAnswer = str_repeat('คำตอบที่ต้องแสดงครบ ', 12);
$questions = $normalize->invoke($service, [[
    'question_text' => 'ข้อใดถูกต้อง', 'question_type' => 'multiple_choice',
    'options' => ['คำตอบอื่น', $longAnswer, 'อีกคำตอบ', 'ไม่ทราบ'], 'correct_answer' => 'B',
]], 1);
$check($questions[0]['correct_answer'], trim($longAnswer), 'letter answer key');
$check(in_array($questions[0]['correct_answer'], $questions[0]['options'], true), true, 'complete answer remains selectable');
$subject = new Subject(['name' => 'วิทยาศาสตร์']);
$source = implode("\n", array_map(fn ($i) => "หัวข้อ{$i} กล่าวถึงแนวคิด{$i} และตัวอย่าง{$i} ที่ปรากฏในเอกสารต้นฉบับ", range(1, 20)));
$quiz = $service->generateLocalQuizFromText($subject, $source, ['question_count' => 10, 'question_types' => ['multiple_choice']]);
$check(count($quiz['questions']), 10, 'requested count');
foreach ($quiz['questions'] as $question) {
    $check(in_array($question['correct_answer'], $question['options'], true), true, 'fallback answer selectable');
    $check(str_contains($question['explanation'], $question['correct_answer']), true, 'fallback grounded in quoted source');
}
// Exercise submissions and history against an isolated database.
config(['database.default' => 'sqlite', 'database.connections.sqlite.database' => ':memory:']);
Illuminate\Support\Facades\DB::purge('sqlite');
foreach ([
    'CREATE TABLE subjects (id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT)',
    'CREATE TABLE quizzes (id INTEGER PRIMARY KEY, subject_id INTEGER, title TEXT)',
    'CREATE TABLE quiz_questions (id INTEGER PRIMARY KEY, quiz_id INTEGER, question_type TEXT, question_text TEXT, correct_answer TEXT, explanation TEXT, options TEXT)',
    'CREATE TABLE quiz_answers (id INTEGER PRIMARY KEY AUTOINCREMENT, question_id INTEGER, user_id INTEGER, selected_answer TEXT, is_correct INTEGER, score INTEGER, answered_at TEXT, created_at TEXT, updated_at TEXT)',
    'CREATE TABLE quiz_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, quiz_id INTEGER, user_id INTEGER, answers TEXT, score INTEGER, passed INTEGER, created_at TEXT, updated_at TEXT)',
] as $sql) Illuminate\Support\Facades\DB::statement($sql);
Illuminate\Support\Facades\DB::table('subjects')->insert(['id' => 1, 'user_id' => 1, 'name' => 'วิทยาศาสตร์']);
Illuminate\Support\Facades\DB::table('quizzes')->insert(['id' => 1, 'subject_id' => 1, 'title' => 'ทดสอบ']);
Illuminate\Support\Facades\DB::table('quiz_questions')->insert(['id' => 1, 'quiz_id' => 1, 'question_type' => 'true_false', 'question_text' => 'ข้อความในเอกสารถูกต้อง', 'correct_answer' => 'true', 'explanation' => 'อ้างอิงจากต้นฉบับ']);
$user = new App\Models\User;
$user->id = 1;
$controller = new App\Http\Controllers\API\QuizController($service);
$submit = function ($answers) use ($app, $user, $controller) {
    $request = App\Http\Requests\QuizAttemptRequest::create('/quizzes/1/attempts', 'POST', ['answers' => $answers]);
    $request->setValidator(Illuminate\Support\Facades\Validator::make(['answers' => $answers], ['answers' => 'required|array']));
    $app->instance('request', $request);
    $request->setUserResolver(fn () => $user);
    return $controller->submitAttempt($request, App\Models\Quiz::find(1))->getData(true);
};
$check($submit([['question_id' => 1, 'selected_answer' => 'false']])['score'], 0, 'first attempt score');
$check($submit([['question_id' => 1, 'selected_answer' => 'true']])['score'], 1, 'second attempt score');
$history = $controller->attempts(App\Models\Quiz::find(1))->getData(true);
$check(count($history), 2, 'both attempts retained');
$check($history[1]['answers'][0]['selected_answer'], 'false', 'original answer retained');
$check($history[1]['answers'][0]['correct_answer'], 'true', 'original answer key retained');
Illuminate\Support\Facades\DB::table('quiz_questions')->where('id', 1)->update(['correct_answer' => 'false']);
$history = $controller->attempts(App\Models\Quiz::find(1))->getData(true);
$check($history[1]['answers'][0]['correct_answer'], 'true', 'snapshot unaffected by changed question');
try {
    $submit([['question_id' => 999, 'selected_answer' => 'true']]);
    throw new RuntimeException('Foreign question accepted');
} catch (Symfony\Component\HttpKernel\Exception\HttpException $error) {
    $check($error->getStatusCode(), 422, 'foreign question rejected');
}
$check(Illuminate\Support\Facades\DB::table('quiz_attempts')->count(), 2, 'invalid submission creates no history');
Illuminate\Support\Facades\DB::statement('CREATE TABLE study_logs (id INTEGER PRIMARY KEY, subject_id INTEGER)');
Illuminate\Support\Facades\DB::statement('CREATE TABLE files (id INTEGER PRIMARY KEY, study_log_id INTEGER, original_name TEXT, file_path TEXT, created_at TEXT)');
Illuminate\Support\Facades\DB::table('subjects')->insert(['id' => 2, 'user_id' => 2, 'name' => 'Other subject']);
Illuminate\Support\Facades\DB::table('files')->insert([
    ['id' => 1, 'study_log_id' => null, 'original_name' => 'quiz.pdf', 'file_path' => 'study-files/1/quiz.pdf', 'created_at' => '2026-10-07 09:00:00'],
    ['id' => 2, 'study_log_id' => null, 'original_name' => 'other.pdf', 'file_path' => 'study-files/2/other.pdf', 'created_at' => '2026-10-07 09:00:00'],
]);
$filesController = new App\Http\Controllers\API\FileController;
$files = $filesController->index(Subject::find(1))->getData(true);
$check(count($files), 1, 'quiz uploads included in subject library');
$check($files[0]['original_name'], 'quiz.pdf', 'other subject files excluded');
$authorizeFile = new ReflectionMethod($filesController, 'authorizeFile');
$authorizeFile->invoke($filesController, App\Models\FileAttachment::find(1));
try {
    $authorizeFile->invoke($filesController, App\Models\FileAttachment::find(2));
    throw new RuntimeException('Other subject file authorized');
} catch (Symfony\Component\HttpKernel\Exception\HttpException $error) {
    $check($error->getStatusCode(), 403, 'file user isolation');
}
// A source document may belong to another subject owned by the same learner.
Illuminate\Support\Facades\DB::table('subjects')->insert(['id' => 3, 'user_id' => 1, 'name' => 'Another owned subject']);
Illuminate\Support\Facades\DB::table('study_logs')->insert(['id' => 1, 'subject_id' => 3]);
Illuminate\Support\Facades\DB::table('files')->insert([
    ['id' => 3, 'study_log_id' => null, 'original_name' => 'owned.pdf', 'file_path' => 'study-files/3/owned.pdf'],
    ['id' => 4, 'study_log_id' => 1, 'original_name' => 'legacy.pdf', 'file_path' => 'legacy/owned.pdf'],
    ['id' => 5, 'study_log_id' => null, 'original_name' => 'unknown.pdf', 'file_path' => 'legacy/unknown.pdf'],
    ['id' => 6, 'study_log_id' => null, 'original_name' => 'nested.pdf', 'file_path' => 'study-files/1/../2/other.pdf'],
]);
$authorizeSourceFile = new ReflectionMethod($controller, 'authorizeSourceFile');
foreach ([1, 3, 4] as $fileId) {
    $authorizeSourceFile->invoke($controller, App\Models\FileAttachment::find($fileId));
}
foreach ([2, 5, 6] as $fileId) {
    try {
        $authorizeSourceFile->invoke($controller, App\Models\FileAttachment::find($fileId));
        throw new RuntimeException('Unauthorized quiz source accepted: '.$fileId);
    } catch (Symfony\Component\HttpKernel\Exception\HttpException $error) {
        $check($error->getStatusCode(), 403, 'quiz source ownership: '.$fileId);
    }
}
$user->id = 2;
try {
    $controller->attempts(App\Models\Quiz::find(1));
    throw new RuntimeException('Other user history accessible');
} catch (Symfony\Component\HttpKernel\Exception\HttpException $error) {
    $check($error->getStatusCode(), 403, 'history user isolation');
}
echo "Quiz feedback, grading, history, file library and user isolation checks passed.\n";
