<?php

require __DIR__.'/../vendor/autoload.php';

use App\Models\QuizQuestion;
use App\Services\AI\AIService;
use App\Support\ThaiText;

$check = static function ($actual, $expected): void {
    if ($actual !== $expected) {
        throw new RuntimeException('Unexpected result: '.json_encode($actual, JSON_UNESCAPED_UNICODE));
    }
};

foreach (['ISO-8859-1', 'Windows-1252'] as $encoding) {
    $thai = 'ตัวเลือกอื่น ไม่ระบุ คำถาม';
    $broken = mb_convert_encoding($thai, 'UTF-8', $encoding);
    $check(ThaiText::repair($broken), $thai);
    $check(ThaiText::repair('ภาษาไทย '.$broken.' café'), 'ภาษาไทย '.$thai.' café');
    $check(ThaiText::repair(mb_convert_encoding($broken, 'UTF-8', $encoding)), $thai);

    $question = new QuizQuestion;
    $question->setRawAttributes([
        'question_type' => 'multiple_choice',
        'options' => json_encode([$broken, 'คำตอบอื่น']),
        'correct_answer' => $broken,
        'question_text' => $broken,
        'explanation' => $broken,
    ]);
    $check($question->options, [$thai, 'คำตอบอื่น']);
    $check($question->correct_answer, $thai);
    $check($question->question_text, $thai);
    $check($question->explanation, $thai);

    $service = (new ReflectionClass(AIService::class))->newInstanceWithoutConstructor();
    $check((new ReflectionMethod(AIService::class, 'normalizeToUtf8'))->invoke($service, $broken), $thai);
}

foreach (['ภาษาไทยปกติ', 'café déjà vu', 'English 123', '😀', 'à¸', ''] as $text) {
    $check(ThaiText::repair($text), $text);
}

$question->setRawAttributes([
    'question_type' => 'multiple_choice',
    'options' => json_encode(['2', 'หนึ่ง', mb_convert_encoding('สอง', 'UTF-8', 'ISO-8859-1')]),
    'correct_answer' => '2',
]);
$check($question->options, ['หนึ่ง', 'สอง']);
$check($question->correct_answer, 'สอง');

$truncated = 'à¸£à¸²à¸¢à¸‡à¸²à¸';
$context = 'จากข้อความต่อไปนี้ คำสำคัญคืออะไร? "รายงาน: บทที่-3-651463052-เกศสุดา-คำมา"';
$check(ThaiText::repair($truncated, $context), 'รายงาน');
$check(ThaiText::repair($truncated), $truncated);
$check(ThaiText::repair($truncated, 'รายงาน รายงาม'), $truncated);
$question->setRawAttributes([
    'question_type' => 'multiple_choice',
    'question_text' => $context,
    'options' => json_encode([$truncated, 'เกศสุดา', 'บทที่', 'คำมา']),
    'correct_answer' => $truncated,
]);
$check($question->options, ['รายงาน', 'เกศสุดา', 'บทที่', 'คำมา']);
$check($question->correct_answer, 'รายงาน');
foreach (['ISO-8859-1', 'Windows-1252'] as $encoding) {
    $broken = mb_convert_encoding('รายงาน', 'UTF-8', $encoding);
    $keywords = (new ReflectionMethod(AIService::class, 'extractKeywords'))->invoke($service, $broken.': เกศสุดา');
    $check($keywords, ['รายงาน', 'เกศสุดา']);
}

echo "Thai text regression checks passed.\n";
