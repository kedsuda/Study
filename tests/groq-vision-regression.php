<?php

require __DIR__.'/../vendor/autoload.php';

use App\Services\AI\AIClientFactory;
use App\Services\AI\AIService;
use Illuminate\Config\Repository;
use Illuminate\Container\Container;
use Illuminate\Http\Client\Factory;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Facade;
use Illuminate\Support\Facades\Http;

$app = new Container;
Container::setInstance($app);
Facade::setFacadeApplication($app);
$app->instance('config', new Repository(['ai' => ['groq' => [
    'api_key' => 'test-key',
    'base_uri' => 'https://groq.test',
    'vision_model' => 'test-vision',
]]]));

$service = new AIService(new AIClientFactory);
$path = tempnam(sys_get_temp_dir(), 'vision-test-');
file_put_contents($path, base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII='));
$image = new UploadedFile($path, 'page.png', 'image/png', null, true);
$source = 'Data structures organize information. An array stores elements in order and allows access using an index.';
$check = static function (bool $condition, string $message): void {
    if (! $condition) {
        throw new RuntimeException($message);
    }
};
$fake = static function (array $body, int $status = 200): void {
    Http::swap(new Factory);
    Http::preventStrayRequests();
    Http::fake(['https://groq.test/*' => Http::response($body, $status)]);
};

try {
    foreach ([null => 900, 600 => 600, 0 => 1] as $configured => $expected) {
        if ($configured !== '') {
            config(['ai.groq.vision_max_completion_tokens' => (int) $configured]);
        }
        $fake(['choices' => [['message' => ['content' => $source], 'finish_reason' => 'stop']]]);
        $check($service->extractDocumentImageText([$image])['text'] === $source, 'OCR text must be preserved.');
        $requests = Http::recorded();
        $check(count($requests) === 1, 'Expected one OCR request.');
        $check($requests[0][0]['max_completion_tokens'] === $expected, 'Incorrect completion budget.');
        $check($requests[0][0]['messages'][0]['content'][1]['type'] === 'image_url', 'Missing image.');
    }

    foreach ([
        [['choices' => [['message' => ['content' => $source], 'finish_reason' => 'length']]], 200, 'ยังอ่านได้ไม่ครบ'],
        [['error' => ['message' => 'Request too large: output tokens per minute (OTPM): Limit 1000, Requested 1142']], 413, 'ขีดจำกัดโทเคน'],
        [['error' => ['message' => 'Rate limit reached']], 429, 'ขีดจำกัดโทเคน'],
        [['choices' => [['message' => ['content' => ''], 'finish_reason' => 'stop']]], 200, 'ไม่พบข้อความ'],
    ] as [$body, $status, $expectedMessage]) {
        $fake($body, $status);
        try {
            $service->extractDocumentImageText([$image]);
            throw new RuntimeException('Expected OCR failure.');
        } catch (RuntimeException $error) {
            $check(str_contains($error->getMessage(), $expectedMessage), 'Unexpected error: '.$error->getMessage());
        }
    }
    echo "Groq Vision regression checks passed.\n";
} finally {
    unlink($path);
}
