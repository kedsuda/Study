<?php
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$rawBody = file_get_contents('php://input');
$data = json_decode($rawBody ?: '{}', true);

if (!is_array($data)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid JSON body']);
    exit;
}

$userMessage = trim((string)($data['message'] ?? ''));
if ($userMessage === '') {
    http_response_code(422);
    echo json_encode(['error' => 'Message is required']);
    exit;
}

$apiKey = getenv('GROQ_API_KEY');
if (!$apiKey) {
    $envPath = dirname(__DIR__) . DIRECTORY_SEPARATOR . '.env';
    if (is_file($envPath)) {
        $env = parse_ini_file($envPath, false, INI_SCANNER_RAW);
        if (is_array($env) && !empty($env['GROQ_API_KEY'])) {
            $apiKey = trim((string)$env['GROQ_API_KEY']);
        }
    }
}

if (!$apiKey) {
    http_response_code(500);
    echo json_encode(['error' => 'GROQ_API_KEY is not configured']);
    exit;
}

$model = trim((string)($data['model'] ?? 'openai/gpt-oss-20b'));
// Allow a browser that still has the old page cached to keep working after
// Groq retired the Llama models.
$deprecatedModels = [
    'llama-3.1-8b-instant' => 'openai/gpt-oss-20b',
    'llama-3.3-70b-versatile' => 'openai/gpt-oss-120b',
];
$model = $deprecatedModels[$model] ?? $model;
$history = $data['history'] ?? [];
$messages = [
    ['role' => 'system', 'content' => 'You are เครื่องมือเพิ่มตารางเรียน. Reply in Thai when user speaks Thai. Explain the schedule format clearly: เพิ่มวิชา [ชื่อวิชา] วัน[วันเรียน] วันที่ [วัน/เดือน/ปี] [เวลาเริ่ม]-[เวลาเลิก] ห้อง [ห้อง] ภาคเรียนที่ [เลขเทอม] ปีการศึกษา [ปี]. Tell users they can add multiple subjects by separating each subject on a new line, and they can ask which subject belongs to which semester.'],
];

if (is_array($history)) {
    foreach ($history as $item) {
        if (!is_array($item)) {
            continue;
        }
        $role = (string)($item['role'] ?? '');
        $content = trim((string)($item['content'] ?? ''));
        if ($content === '') {
            continue;
        }
        if (!in_array($role, ['user', 'assistant'], true)) {
            continue;
        }
        $messages[] = ['role' => $role, 'content' => $content];
    }
}

$messages[] = ['role' => 'user', 'content' => $userMessage];

$payload = [
    'model' => $model,
    'messages' => $messages,
    'temperature' => 0.7,
];

$ch = curl_init('https://api.groq.com/openai/v1/chat/completions');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer ' . $apiKey,
        'Content-Type: application/json',
    ],
    CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
    CURLOPT_TIMEOUT => 45,
]);

$response = curl_exec($ch);
$curlErrNo = curl_errno($ch);
$curlErr = curl_error($ch);
$statusCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($curlErrNo !== 0) {
    http_response_code(502);
    echo json_encode(['error' => 'Upstream connection failed', 'detail' => $curlErr]);
    exit;
}

if (!is_string($response) || $response === '') {
    http_response_code(502);
    echo json_encode(['error' => 'Empty response from Groq']);
    exit;
}

$decoded = json_decode($response, true);
if (!is_array($decoded)) {
    http_response_code(502);
    echo json_encode(['error' => 'Invalid response from Groq', 'raw' => $response]);
    exit;
}

if ($statusCode >= 400) {
    http_response_code($statusCode);
    $message = $decoded['error']['message'] ?? 'Groq API error';
    echo json_encode(['error' => $message]);
    exit;
}

$assistantText = (string)($decoded['choices'][0]['message']['content'] ?? '');

if ($assistantText === '') {
    http_response_code(502);
    echo json_encode(['error' => 'No assistant content returned']);
    exit;
}

echo json_encode([
    'reply' => $assistantText,
    'model' => $decoded['model'] ?? $model,
], JSON_UNESCAPED_UNICODE);
