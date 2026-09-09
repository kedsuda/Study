<?php

// Minimal API fallback for legacy PHP (<= 5.5) environments.

$rootDir = dirname(__DIR__);
$env = array();
$envPath = $rootDir . DIRECTORY_SEPARATOR . '.env';
if (file_exists($envPath)) {
    $parsedEnv = parse_ini_file($envPath, false, INI_SCANNER_RAW);
    if (is_array($parsedEnv)) {
        $env = $parsedEnv;
    }
}

$legacyDebug = false;
if (isset($env['LEGACY_DEBUG'])) {
    $legacyDebug = strtolower(trim($env['LEGACY_DEBUG'])) === 'true';
}
if ($legacyDebug) {
    error_reporting(E_ALL);
    ini_set('display_errors', '1');
} else {
    error_reporting(E_ALL);
    ini_set('display_errors', '0');
}
ini_set('log_errors', '1');
ini_set('error_log', $rootDir . DIRECTORY_SEPARATOR . 'legacy_api_error.log');

register_shutdown_function(function () use ($legacyDebug) {
    $error = error_get_last();
    if (!$error) {
        return;
    }
    $fatalTypes = array(E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR);
    if (!in_array($error['type'], $fatalTypes, true)) {
        return;
    }
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
    }
    $payload = array(
        'message' => 'Legacy API fatal error'
    );
    if ($legacyDebug) {
        $payload['error'] = $error;
    }
    echo json_encode($payload);
});

function env_value($key, $default = null)
{
    global $env;
    return array_key_exists($key, $env) ? $env[$key] : $default;
}

function legacy_db_connect()
{
    global $conn;

    if ($conn) {
        return;
    }

    $host = env_value('DB_HOST', '127.0.0.1');
    $port = env_value('DB_PORT', '3306');
    $database = env_value('DB_DATABASE', '');
    $username = env_value('DB_USERNAME', 'root');
    $password = env_value('DB_PASSWORD', '');
    $charset = env_value('DB_CHARSET', 'utf8');

    if (function_exists('mysqli_connect')) {
        $conn = @mysqli_connect($host, $username, $password, $database, (int) $port);
        if (!$conn) {
            json_response(array('message' => 'ไม่สามารถเชื่อมต่อฐานข้อมูลได้'), 500);
        }
        @mysqli_set_charset($conn, $charset);
        return;
    }

    json_response(array('message' => 'ไม่พบไดรเวอร์ฐานข้อมูลที่รองรับ'), 500);
}

function json_response($data, $status = 200)
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data);
    exit;
}

function get_request_path()
{
    $uri = isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '';
    $path = $uri;
    if (strpos($path, '?') !== false) {
        $parts = explode('?', $path, 2);
        $path = $parts[0];
    }
    $indexPos = strpos($path, 'index.php');
    if ($indexPos !== false) {
        $path = substr($path, $indexPos + strlen('index.php'));
    }
    $path = '/' . ltrim($path, '/');
    $apiPos = strpos($path, '/api');
    if ($apiPos !== false) {
        $path = substr($path, $apiPos);
    }
    return $path;
}

function read_json_body()
{
    $raw = file_get_contents('php://input');
    if (!$raw) {
        return array();
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : array();
}

function get_auth_header()
{
    $headers = array();
    foreach ($_SERVER as $name => $value) {
        if (strpos($name, 'HTTP_') === 0) {
            $key = str_replace(' ', '-', ucwords(strtolower(str_replace('_', ' ', substr($name, 5)))));
            $headers[$key] = $value;
        }
    }
    if (isset($_SERVER['HTTP_AUTHORIZATION'])) {
        return $_SERVER['HTTP_AUTHORIZATION'];
    }
    if (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
        return $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
    }
    return isset($headers['Authorization']) ? $headers['Authorization'] : null;
}

function get_bearer_token()
{
    $header = get_auth_header();
    if (!$header) {
        return null;
    }
    if (stripos($header, 'Bearer ') === 0) {
        return trim(substr($header, 7));
    }
    return null;
}

function base64url_encode($data)
{
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function base64url_decode($data)
{
    $remainder = strlen($data) % 4;
    if ($remainder) {
        $data .= str_repeat('=', 4 - $remainder);
    }
    return base64_decode(strtr($data, '-_', '+/'));
}

function safe_hash_equals($known, $user)
{
    if (function_exists('hash_equals')) {
        return hash_equals($known, $user);
    }
    if (!is_string($known) || !is_string($user)) {
        return false;
    }
    $knownLength = strlen($known);
    if ($knownLength !== strlen($user)) {
        return false;
    }
    $result = 0;
    for ($i = 0; $i < $knownLength; $i++) {
        $result |= ord($known[$i]) ^ ord($user[$i]);
    }
    return $result === 0;
}

function jwt_secret()
{
    $secret = env_value('APP_KEY', 'legacy-secret');
    if (strpos($secret, 'base64:') === 0) {
        $decoded = base64_decode(substr($secret, 7));
        if ($decoded !== false) {
            return $decoded;
        }
    }
    return $secret;
}

function jwt_encode($payload)
{
    $header = array('typ' => 'JWT', 'alg' => 'HS256');
    $segments = array(
        base64url_encode(json_encode($header)),
        base64url_encode(json_encode($payload))
    );
    $signingInput = implode('.', $segments);
    $signature = hash_hmac('sha256', $signingInput, jwt_secret(), true);
    $segments[] = base64url_encode($signature);
    return implode('.', $segments);
}

function jwt_decode($token)
{
    $parts = explode('.', $token);
    if (count($parts) !== 3) {
        return null;
    }
    list($head64, $payload64, $sig64) = $parts;
    $signature = base64url_decode($sig64);
    $expected = hash_hmac('sha256', $head64 . '.' . $payload64, jwt_secret(), true);
    if (!safe_hash_equals($expected, $signature)) {
        return null;
    }
    $payload = json_decode(base64url_decode($payload64), true);
    if (!is_array($payload)) {
        return null;
    }
    if (isset($payload['exp']) && time() > (int) $payload['exp']) {
        return null;
    }
    return $payload;
}

function require_auth_user()
{
    $token = get_bearer_token();
    if (!$token) {
        json_response(array('message' => 'Unauthorized'), 401);
    }
    $payload = jwt_decode($token);
    if (!$payload || !isset($payload['sub'])) {
        json_response(array('message' => 'Unauthorized'), 401);
    }
    $user = db_fetch_one('SELECT * FROM users WHERE id = ' . (int) $payload['sub'] . ' LIMIT 1');
    if (!$user) {
        json_response(array('message' => 'Unauthorized'), 401);
    }
    return $user;
}

function db_conn()
{
    global $conn;
    legacy_db_connect();
    return $conn;
}

function db_escape($value)
{
    $conn = db_conn();
    if ($value === null) {
        return 'NULL';
    }
    if (is_int($value) || is_float($value) || ctype_digit((string) $value)) {
        return (string) $value;
    }
    return "'" . mysqli_real_escape_string($conn, (string) $value) . "'";
}

function db_fetch_all($sql)
{
    $conn = db_conn();
    $res = mysqli_query($conn, $sql);
    if (!$res) {
        return array();
    }
    $rows = array();
    while ($row = mysqli_fetch_assoc($res)) {
        $rows[] = $row;
    }
    return $rows;
}

function db_fetch_one($sql)
{
    $trimmed = rtrim($sql);
    if (preg_match('/^select\\s/i', $trimmed) && stripos($trimmed, ' limit ') === false) {
        $trimmed .= ' LIMIT 1';
    }
    $rows = db_fetch_all($trimmed);
    return count($rows) ? $rows[0] : null;
}

function table_columns($table)
{
    static $cache = array();
    if (isset($cache[$table])) {
        return $cache[$table];
    }
    $rows = db_fetch_all("SHOW COLUMNS FROM {$table}");
    $columns = array();
    foreach ($rows as $row) {
        $columns[] = $row['Field'];
    }
    $cache[$table] = $columns;
    return $columns;
}

function table_has_column($table, $column)
{
    $columns = table_columns($table);
    return in_array($column, $columns, true);
}

function next_id_for($table)
{
    if (!table_has_column($table, 'id')) {
        return null;
    }
    $row = db_fetch_one("SELECT MAX(id) AS max_id FROM {$table}");
    $max = $row && isset($row['max_id']) ? (int) $row['max_id'] : 0;
    return $max + 1;
}

function db_insert($table, $data)
{
    $columns = array();
    $values = array();
    foreach ($data as $column => $value) {
        $columns[] = $column;
        $values[] = db_escape($value);
    }
    $sql = "INSERT INTO {$table} (" . implode(',', $columns) . ") VALUES (" . implode(',', $values) . ")";
    $conn = db_conn();
    $ok = mysqli_query($conn, $sql);
    if (!$ok) {
        return null;
    }
    $insertId = mysqli_insert_id($conn);
    if ($insertId) {
        return $insertId;
    }
    if (isset($data['id'])) {
        return (int) $data['id'];
    }
    return null;
}

function db_update($table, $data, $where)
{
    if (!$data) {
        return false;
    }
    $sets = array();
    foreach ($data as $column => $value) {
        $sets[] = $column . '=' . db_escape($value);
    }
    $sql = "UPDATE {$table} SET " . implode(', ', $sets) . " WHERE {$where}";
    $conn = db_conn();
    return mysqli_query($conn, $sql) ? true : false;
}

function db_exec($sql)
{
    $conn = db_conn();
    return mysqli_query($conn, $sql) ? true : false;
}

function google_token_info($token)
{
    $url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' . urlencode($token);
    $response = null;
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 10);
        $response = curl_exec($ch);
        if ($response === false) {
            $error = curl_error($ch);
            if ($error) {
                error_log('google_token_info curl error: ' . $error);
            }
        } else {
            $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            if ($status && (int) $status !== 200) {
                error_log('google_token_info http status: ' . (int) $status);
            }
        }
        curl_close($ch);
    } else {
        $response = @file_get_contents($url);
        if ($response === false) {
            error_log('google_token_info file_get_contents failed');
        }
    }
    if (!$response) {
        return null;
    }
    $data = json_decode($response, true);
    return is_array($data) ? $data : null;
}

function decode_google_jwt_payload($token)
{
    $parts = explode('.', $token);
    if (count($parts) < 2) {
        return null;
    }
    $payload = json_decode(base64url_decode($parts[1]), true);
    return is_array($payload) ? $payload : null;
}

function allow_insecure_google_token()
{
    $flag = env_value('GOOGLE_ALLOW_INSECURE_TOKEN', 'false');
    return strtolower(trim((string) $flag)) === 'true';
}

function google_payload_is_valid($payload)
{
    if (!$payload || !isset($payload['email'])) {
        return false;
    }
    if (isset($payload['exp']) && time() > (int) $payload['exp']) {
        return false;
    }
    if (isset($payload['iss'])) {
        $allowed = array('https://accounts.google.com', 'accounts.google.com');
        if (!in_array($payload['iss'], $allowed, true)) {
            return false;
        }
    }
    if (isset($payload['email_verified']) && $payload['email_verified'] !== true && $payload['email_verified'] !== 'true') {
        return false;
    }
    return true;
}

function normalize_user($user)
{
    if (!$user) {
        return null;
    }
    return array(
        'id' => isset($user['id']) ? (int) $user['id'] : null,
        'name' => isset($user['name']) ? $user['name'] : null,
        'email' => isset($user['email']) ? $user['email'] : null,
        'profile_pic' => isset($user['profile_pic']) ? $user['profile_pic'] : null,
        'provider' => isset($user['provider']) ? $user['provider'] : null,
        'provider_id' => isset($user['provider_id']) ? $user['provider_id'] : null,
        'education_level' => isset($user['education_level']) ? $user['education_level'] : null,
        'role' => isset($user['role']) ? $user['role'] : null,
    );
}

function find_or_create_user($email, $name, $picture, $providerId)
{
    $safeEmail = db_escape($email);
    $existing = db_fetch_one("SELECT * FROM users WHERE email = {$safeEmail}");
    if ($existing) {
        return $existing;
    }

    $columns = table_columns('users');
    $now = date('Y-m-d H:i:s');
    $data = array();
    if (in_array('id', $columns, true)) {
        $data['id'] = next_id_for('users');
    }
    if (in_array('name', $columns, true)) {
        $data['name'] = $name ? $name : $email;
    }
    if (in_array('email', $columns, true)) {
        $data['email'] = $email;
    }
    if (in_array('password', $columns, true)) {
        $data['password'] = null;
    }
    if (in_array('profile_pic', $columns, true)) {
        $data['profile_pic'] = $picture;
    }
    if (in_array('provider', $columns, true)) {
        $data['provider'] = 'google';
    }
    if (in_array('provider_id', $columns, true)) {
        $data['provider_id'] = $providerId;
    }
    if (in_array('created_at', $columns, true)) {
        $data['created_at'] = $now;
    }
    if (in_array('updated_at', $columns, true)) {
        $data['updated_at'] = $now;
    }

    $newId = db_insert('users', $data);
    if ($newId) {
        return db_fetch_one("SELECT * FROM users WHERE id = " . (int) $newId);
    }

    return db_fetch_one("SELECT * FROM users WHERE email = {$safeEmail}");
}

function build_token_for_user($user)
{
    $payload = array(
        'sub' => isset($user['id']) ? (int) $user['id'] : null,
        'email' => isset($user['email']) ? $user['email'] : null,
        'iat' => time(),
        'exp' => time() + (60 * 60 * 24 * 7)
    );
    return jwt_encode($payload);
}

function subject_with_counts($subject, $userId = null)
{
    $subjectId = isset($subject['id']) ? (int) $subject['id'] : 0;
    $conditions = array('subject_id = ' . $subjectId);
    if ($userId !== null && table_has_column('study_logs', 'user_id')) {
        $conditions[] = 'user_id = ' . (int) $userId;
    }
    if (table_has_column('study_logs', 'note')) {
        $conditions[] = "COALESCE(note, '') <> 'อัปโหลดไฟล์เพื่อสร้างแบบฝึกหัด'";
    }
    $countRow = db_fetch_one('SELECT COUNT(*) AS total FROM study_logs WHERE ' . implode(' AND ', $conditions));
    $subject['study_log_count'] = $countRow ? (int) $countRow['total'] : 0;
    if (isset($subject['tags']) && $subject['tags']) {
        $decoded = json_decode($subject['tags'], true);
        if (is_array($decoded)) {
            $subject['tags'] = $decoded;
        }
    }
    return $subject;
}

function load_study_logs($subjectId, $withDetails, $userId = null)
{
    $conditions = array('subject_id = ' . (int) $subjectId);
    if ($userId !== null && table_has_column('study_logs', 'user_id')) {
        $conditions[] = 'user_id = ' . (int) $userId;
    }
    if (table_has_column('study_logs', 'note')) {
        $conditions[] = "COALESCE(note, '') <> 'อัปโหลดไฟล์เพื่อสร้างแบบฝึกหัด'";
    }
    $logs = db_fetch_all('SELECT * FROM study_logs WHERE ' . implode(' AND ', $conditions) . ' ORDER BY id DESC');
    if (!$withDetails) {
        return $logs;
    }
    foreach ($logs as $index => $log) {
        $logId = isset($log['id']) ? (int) $log['id'] : 0;
        $log['files'] = db_fetch_all('SELECT * FROM files WHERE study_log_id = ' . $logId . ' ORDER BY id DESC');
        $log['summaries'] = db_fetch_all('SELECT * FROM summaries WHERE study_log_id = ' . $logId . ' ORDER BY id DESC');
        $logs[$index] = $log;
    }
    return $logs;
}

function handle_google_login()
{
    $body = read_json_body();
    $credential = isset($body['credential']) ? trim($body['credential']) : '';
    if (!$credential) {
        json_response(array('message' => 'Missing credential'), 400);
    }
    $info = google_token_info($credential);
    if ((!$info || !isset($info['email'])) && allow_insecure_google_token()) {
        $payload = decode_google_jwt_payload($credential);
        if (google_payload_is_valid($payload)) {
            $info = $payload;
        }
    }
    if (!$info || !isset($info['email'])) {
        json_response(array('message' => 'Invalid Google token'), 401);
    }
    $clientId = env_value('GOOGLE_CLIENT_ID');
    if ($clientId && isset($info['aud']) && $info['aud'] !== $clientId) {
        json_response(array('message' => 'Invalid client ID'), 401);
    }
    $user = find_or_create_user(
        $info['email'],
        isset($info['name']) ? $info['name'] : $info['email'],
        isset($info['picture']) ? $info['picture'] : null,
        isset($info['sub']) ? $info['sub'] : null
    );
    if (!$user) {
        json_response(array('message' => 'Unable to create user'), 500);
    }
    $token = build_token_for_user($user);
    json_response(array(
        'token' => $token,
        'user' => normalize_user($user)
    ));
}

function handle_google_config()
{
    $clientId = env_value('GOOGLE_CLIENT_ID', '');
    json_response(array('client_id' => $clientId));
}

function handle_password_login()
{
    $body = read_json_body();
    $email = isset($body['email']) ? trim($body['email']) : '';
    $password = isset($body['password']) ? (string) $body['password'] : '';

    if ($email === '' || $password === '') {
        json_response(array('message' => 'Missing credentials'), 422);
    }

    $safeEmail = db_escape($email);
    $user = db_fetch_one("SELECT * FROM users WHERE email = {$safeEmail} LIMIT 1");
    if (!$user || !isset($user['password'])) {
        json_response(array('message' => 'Invalid credentials'), 422);
    }

    $hash = (string) $user['password'];
    $valid = false;
    if ($hash !== '' && function_exists('password_verify')) {
        $valid = password_verify($password, $hash);
    }
    if (!$valid && $hash !== '') {
        $valid = safe_hash_equals($hash, $password);
    }
    if (!$valid) {
        json_response(array('message' => 'Invalid credentials'), 422);
    }

    $token = build_token_for_user($user);
    json_response(array(
        'token' => $token,
        'user' => normalize_user($user)
    ));
}

function handle_dev_login()
{
    $body = read_json_body();
    $email = isset($body['email']) ? trim($body['email']) : '';
    $name = isset($body['name']) ? trim($body['name']) : '';
    if ($email === '') {
        $user = db_fetch_one('SELECT * FROM users ORDER BY id ASC');
        if (!$user) {
            $email = 'dev-' . time() . '@example.com';
        }
    }
    if ($email !== '') {
        $user = find_or_create_user($email, $name ? $name : $email, null, null);
    }
    if (!$user) {
        json_response(array('message' => 'Unable to login'), 500);
    }
    $token = build_token_for_user($user);
    json_response(array(
        'token' => $token,
        'user' => normalize_user($user)
    ));
}

function handle_auth_me()
{
    $user = require_auth_user();
    json_response(normalize_user($user));
}

function handle_subjects_get()
{
    $user = require_auth_user();
    $includeLogs = false;
    if (isset($_GET['include_study_logs'])) {
        $value = strtolower((string) $_GET['include_study_logs']);
        $includeLogs = $value === '1' || $value === 'true' || $value === 'yes';
    }
    if (!table_has_column('subjects', 'user_id')) {
        error_log('subjects.user_id missing; refusing to list subjects for user ' . (int) $user['id']);
        json_response(array());
    }
    $subjects = db_fetch_all('SELECT * FROM subjects WHERE user_id = ' . (int) $user['id'] . ' ORDER BY id DESC');
    $subjectIdsNeedingSchedule = array();
    if (table_exists('study_calendar_events') && table_has_column('subjects', 'start_date')) {
        foreach ($subjects as $subject) {
            $startDateValue = isset($subject['start_date']) ? trim((string) $subject['start_date']) : '';
            if ($startDateValue === '' && isset($subject['id'])) {
                $subjectIdsNeedingSchedule[] = (int) $subject['id'];
            }
        }
    }
    if ($subjectIdsNeedingSchedule) {
        $idList = implode(',', $subjectIdsNeedingSchedule);
        $eventRows = db_fetch_all(
            'SELECT * FROM study_calendar_events WHERE user_id = ' . (int) $user['id'] . ' AND subject_id IN (' . $idList . ') ORDER BY start_time DESC'
        );
        $eventsBySubject = array();
        foreach ($eventRows as $row) {
            if (!isset($row['subject_id'])) {
                continue;
            }
            $meta = parse_event_metadata(isset($row['metadata']) ? $row['metadata'] : null);
            $source = isset($meta['source']) ? $meta['source'] : null;
            $type = isset($meta['type']) ? $meta['type'] : null;
            if ($source === 'study_log') {
                continue;
            }
            if ($type && $type !== 'class') {
                continue;
            }
            $subjectId = (int) $row['subject_id'];
            if (!isset($eventsBySubject[$subjectId])) {
                $eventsBySubject[$subjectId] = array(
                    'row' => $row,
                    'meta' => $meta,
                );
            }
        }
        if ($eventsBySubject) {
            $subjectColumns = table_columns('subjects');
            $now = date('Y-m-d H:i:s');
            foreach ($subjects as $index => $subject) {
                $subjectId = isset($subject['id']) ? (int) $subject['id'] : 0;
                if (!$subjectId || !isset($eventsBySubject[$subjectId])) {
                    continue;
                }
                $row = $eventsBySubject[$subjectId]['row'];
                $meta = $eventsBySubject[$subjectId]['meta'];
                $startTimeValue = isset($row['start_time']) ? (string) $row['start_time'] : '';
                if ($startTimeValue === '') {
                    continue;
                }
                $startDate = substr($startTimeValue, 0, 10);
                $startClock = substr($startTimeValue, 11, 8);
                $endClock = isset($row['end_time']) && $row['end_time'] ? substr((string) $row['end_time'], 11, 8) : null;
                $allDay = normalize_bool(isset($meta['all_day']) ? $meta['all_day'] : false);

                $updateData = array();
                if (in_array('start_date', $subjectColumns, true)) {
                    $updateData['start_date'] = $startDate !== '' ? $startDate : null;
                }
                if (in_array('start_time', $subjectColumns, true)) {
                    $updateData['start_time'] = $allDay ? null : ($startClock ?: null);
                }
                if (in_array('end_time', $subjectColumns, true)) {
                    $updateData['end_time'] = $allDay ? null : ($endClock ?: null);
                }
                if (in_array('updated_at', $subjectColumns, true)) {
                    $updateData['updated_at'] = $now;
                }

                if ($updateData) {
                    db_update('subjects', $updateData, 'id = ' . $subjectId);
                    $subjects[$index] = array_merge($subject, $updateData);
                }
            }
        }
    }
    $result = array();
    foreach ($subjects as $subject) {
        $subject = subject_with_counts($subject, $user['id']);
        if ($includeLogs) {
            $subject['study_logs'] = load_study_logs($subject['id'], false, $user['id']);
        }
        $result[] = $subject;
    }
    json_response($result);
}

function handle_subjects_create()
{
    $user = require_auth_user();
    $body = read_json_body();
    if (!$body && !empty($_POST)) {
        $body = $_POST;
    }
    $columns = table_columns('subjects');
    if (!in_array('user_id', $columns, true)) {
        json_response(array('message' => 'Subjects table must include user_id'), 422);
    }
    $now = date('Y-m-d H:i:s');
    $data = array();
    if (in_array('id', $columns, true)) {
        $data['id'] = next_id_for('subjects');
    }
    if (in_array('user_id', $columns, true)) {
        $data['user_id'] = (int) $user['id'];
    }
    if (in_array('name', $columns, true)) {
        $data['name'] = isset($body['name']) ? $body['name'] : 'Untitled';
    }
    if (in_array('code', $columns, true)) {
        $data['code'] = isset($body['code']) && $body['code'] ? $body['code'] : ('SUBJ-' . time());
    }
    if (in_array('description', $columns, true)) {
        $data['description'] = isset($body['description']) ? $body['description'] : null;
    }
    if (in_array('credits', $columns, true)) {
        $data['credits'] = isset($body['credits']) ? (int) $body['credits'] : 3;
    }
    if (in_array('level', $columns, true)) {
        $data['level'] = isset($body['level']) ? $body['level'] : null;
    }
    if (in_array('tags', $columns, true) && isset($body['tags'])) {
        $data['tags'] = json_encode($body['tags']);
    }
    if (in_array('color', $columns, true)) {
        $data['color'] = isset($body['color']) ? $body['color'] : null;
    }
    if (in_array('target_hours', $columns, true)) {
        $data['target_hours'] = isset($body['target_hours']) ? $body['target_hours'] : null;
    }
    $startDateInput = isset($body['start_date']) ? trim((string) $body['start_date']) : '';
    $startDate = $startDateInput !== '' ? normalize_date_value($startDateInput) : '';
    if ($startDateInput !== '' && !$startDate) {
        json_response(array('message' => 'รูปแบบวันที่ไม่ถูกต้อง'), 422);
    }
    $startTime = isset($body['start_time']) ? normalize_time_value($body['start_time'], '') : '';
    $endTime = isset($body['end_time']) ? normalize_time_value($body['end_time'], '') : '';
    if (($startTime !== '' || $endTime !== '') && $startDate === '') {
        json_response(array('message' => 'ต้องระบุวันที่เริ่มก่อนเวลาเริ่ม/เวลาเลิก'), 422);
    }
    if ($endTime !== '' && $startTime === '') {
        json_response(array('message' => 'ต้องระบุเวลาเริ่มก่อนเวลาเลิก'), 422);
    }
    if ($startDate !== '' && $startTime !== '' && $endTime !== '') {
        $startTs = strtotime($startDate . ' ' . $startTime);
        $endTs = strtotime($startDate . ' ' . $endTime);
        if ($startTs && $endTs && $endTs < $startTs) {
            json_response(array('message' => 'เวลาเลิกต้องไม่ก่อนเวลาเริ่ม'), 422);
        }
    }
    if (in_array('start_date', $columns, true)) {
        $data['start_date'] = $startDate !== '' ? $startDate : null;
    }
    if (in_array('start_time', $columns, true)) {
        $data['start_time'] = $startTime !== '' ? $startTime : null;
    }
    if (in_array('end_time', $columns, true)) {
        $data['end_time'] = $endTime !== '' ? $endTime : null;
    }
    if (in_array('created_at', $columns, true)) {
        $data['created_at'] = $now;
    }
    if (in_array('updated_at', $columns, true)) {
        $data['updated_at'] = $now;
    }
    $newId = db_insert('subjects', $data);
    if (!$newId) {
        json_response(array('message' => 'Unable to create subject'), 500);
    }

    if ($startDate !== '' && table_exists('study_logs')) {
        $logColumns = table_columns('study_logs');
        $logData = array();
        if (in_array('id', $logColumns, true)) {
            $logData['id'] = next_id_for('study_logs');
        }
        if (in_array('user_id', $logColumns, true)) {
            $logData['user_id'] = (int) $user['id'];
        }
        if (in_array('subject_id', $logColumns, true)) {
            $logData['subject_id'] = (int) $newId;
        }
        if (in_array('title', $logColumns, true)) {
            $logData['title'] = 'เริ่มบันทึก';
        }
        if (in_array('note', $logColumns, true)) {
            $logData['note'] = null;
        }
        if (in_array('log_date', $logColumns, true)) {
            $logData['log_date'] = $startDate;
        }
        if (in_array('duration_minutes', $logColumns, true)) {
            $logData['duration_minutes'] = null;
        }
        if (in_array('created_at', $logColumns, true)) {
            $logData['created_at'] = $now;
        }
        if (in_array('updated_at', $logColumns, true)) {
            $logData['updated_at'] = $now;
        }
        $logId = db_insert('study_logs', $logData);

        if ($logId && table_exists('study_calendar_events')) {
            $eventColumns = table_columns('study_calendar_events');
            $eventData = array();
            $allDay = $startTime === '';
            $startAtRaw = $startDate . ($startTime !== '' ? (' ' . $startTime) : ' 00:00:00');
            $startAt = normalize_datetime_for_db($startAtRaw) ?: $startAtRaw;
            $endAt = null;
            if ($endTime !== '') {
                $endAtRaw = $startDate . ' ' . $endTime;
                $endAt = normalize_datetime_for_db($endAtRaw) ?: $endAtRaw;
            }
            if (in_array('id', $eventColumns, true)) {
                $eventData['id'] = next_id_for('study_calendar_events');
            }
            if (in_array('user_id', $eventColumns, true)) {
                $eventData['user_id'] = (int) $user['id'];
            }
            if (in_array('subject_id', $eventColumns, true)) {
                $eventData['subject_id'] = (int) $newId;
            }
            if (in_array('study_log_id', $eventColumns, true)) {
                $eventData['study_log_id'] = (int) $logId;
            }
            if (in_array('title', $eventColumns, true)) {
                $eventData['title'] = isset($data['name']) && $data['name'] ? $data['name'] : 'ตารางเรียน';
            }
            if (in_array('description', $eventColumns, true)) {
                $eventData['description'] = null;
            }
            if (in_array('start_time', $eventColumns, true)) {
                $eventData['start_time'] = $startAt;
            }
            if (in_array('end_time', $eventColumns, true)) {
                $eventData['end_time'] = $endAt;
            }
            if (in_array('status', $eventColumns, true)) {
                $eventData['status'] = 'planned';
            }
            if (in_array('metadata', $eventColumns, true)) {
                $eventData['metadata'] = json_encode(array(
                    'type' => 'class',
                    'all_day' => $allDay,
                    'source' => 'subject',
                ));
            }
            if (in_array('created_at', $eventColumns, true)) {
                $eventData['created_at'] = $now;
            }
            if (in_array('updated_at', $eventColumns, true)) {
                $eventData['updated_at'] = $now;
            }
            db_insert('study_calendar_events', $eventData);
        }
    }

    $subject = db_fetch_one('SELECT * FROM subjects WHERE id = ' . (int) $newId);
    $subject = subject_with_counts($subject, $user['id']);
    json_response($subject);
}

function handle_subject_update($subjectId)
{
    $user = require_auth_user();
    $subject = fetch_subject_for_user($subjectId, $user);
    $body = read_json_body();
    if (!$body && !empty($_POST)) {
        $body = $_POST;
    }
    $columns = table_columns('subjects');
    $now = date('Y-m-d H:i:s');
    $data = array();
    $subjectId = (int) $subjectId;

    if (array_key_exists('name', $body) && in_array('name', $columns, true)) {
        $name = trim((string) $body['name']);
        if ($name !== '') {
            $data['name'] = $name;
        }
    }
    if (array_key_exists('description', $body) && in_array('description', $columns, true)) {
        $desc = isset($body['description']) ? trim((string) $body['description']) : '';
        $data['description'] = $desc !== '' ? $desc : null;
    }
    if (array_key_exists('color', $body) && in_array('color', $columns, true)) {
        $color = isset($body['color']) ? trim((string) $body['color']) : '';
        $data['color'] = $color !== '' ? $color : null;
    }
    if (array_key_exists('target_hours', $body) && in_array('target_hours', $columns, true)) {
        $target = $body['target_hours'];
        $data['target_hours'] = ($target === '' || $target === null) ? null : (int) $target;
    }

    $hasStartDate = array_key_exists('start_date', $body);
    $hasStartTime = array_key_exists('start_time', $body);
    $hasEndTime = array_key_exists('end_time', $body);
    $startDateInput = $hasStartDate ? trim((string) $body['start_date']) : null;
    $startDateNormalized = $startDateInput !== null && $startDateInput !== ''
        ? normalize_date_value($startDateInput)
        : null;
    if ($startDateInput !== null && $startDateInput !== '' && !$startDateNormalized) {
        json_response(array('message' => 'รูปแบบวันที่ไม่ถูกต้อง'), 422);
    }
    $startTimeInput = $hasStartTime ? normalize_time_value($body['start_time'], '') : null;
    $endTimeInput = $hasEndTime ? normalize_time_value($body['end_time'], '') : null;

    if ($hasStartDate || $hasStartTime || $hasEndTime) {
        $effectiveStartDate = $hasStartDate
            ? ($startDateNormalized ?? '')
            : (isset($subject['start_date']) ? trim((string) $subject['start_date']) : '');
        $effectiveStartTime = $hasStartTime
            ? $startTimeInput
            : (isset($subject['start_time']) ? normalize_time_value($subject['start_time'], '') : '');
        $effectiveEndTime = $hasEndTime
            ? $endTimeInput
            : (isset($subject['end_time']) ? normalize_time_value($subject['end_time'], '') : '');

        if (($effectiveStartTime !== '' || $effectiveEndTime !== '') && $effectiveStartDate === '') {
            json_response(array('message' => 'ต้องระบุวันที่เริ่มก่อนเวลาเริ่ม/เวลาเลิก'), 422);
        }
        if ($effectiveEndTime !== '' && $effectiveStartTime === '') {
            json_response(array('message' => 'ต้องระบุเวลาเริ่มก่อนเวลาเลิก'), 422);
        }
        if ($effectiveStartDate !== '' && $effectiveStartTime !== '' && $effectiveEndTime !== '') {
            $startTs = strtotime($effectiveStartDate . ' ' . $effectiveStartTime);
            $endTs = strtotime($effectiveStartDate . ' ' . $effectiveEndTime);
            if ($startTs && $endTs && $endTs < $startTs) {
                json_response(array('message' => 'เวลาเลิกต้องไม่ก่อนเวลาเริ่ม'), 422);
            }
        }
    }

    if ($hasStartDate && in_array('start_date', $columns, true)) {
        $data['start_date'] = $startDateNormalized ? $startDateNormalized : null;
        if ($startDateInput === '') {
            if (in_array('start_time', $columns, true) && !$hasStartTime) {
                $data['start_time'] = null;
            }
            if (in_array('end_time', $columns, true) && !$hasEndTime) {
                $data['end_time'] = null;
            }
        }
    }
    if ($hasStartTime && in_array('start_time', $columns, true)) {
        $data['start_time'] = $startTimeInput !== '' ? $startTimeInput : null;
    }
    if ($hasEndTime && in_array('end_time', $columns, true)) {
        $data['end_time'] = $endTimeInput !== '' ? $endTimeInput : null;
    }

    if (in_array('updated_at', $columns, true)) {
        $data['updated_at'] = $now;
    }

    if ($data) {
        $ok = db_update('subjects', $data, 'id = ' . $subjectId);
        if (!$ok) {
            json_response(array('message' => 'Unable to update subject'), 500);
        }
    }

    $subject = db_fetch_one('SELECT * FROM subjects WHERE id = ' . $subjectId);
    if ($subject && table_exists('study_calendar_events')) {
        $eventColumns = table_columns('study_calendar_events');
        $startDate = isset($subject['start_date']) ? trim((string) $subject['start_date']) : '';
        $startTime = isset($subject['start_time']) ? normalize_time_value($subject['start_time'], '') : '';
        $endTime = isset($subject['end_time']) ? normalize_time_value($subject['end_time'], '') : '';

        $event = db_fetch_one(
            'SELECT * FROM study_calendar_events WHERE subject_id = ' . $subjectId . ' AND user_id = ' . (int) $user['id'] . ' ORDER BY id DESC'
        );

        if ($startDate === '') {
            if ($event && isset($event['id'])) {
                db_exec('DELETE FROM study_calendar_events WHERE id = ' . (int) $event['id']);
            }
        } else {
            $allDay = $startTime === '';
            $startAtRaw = $startDate . ($startTime !== '' ? (' ' . $startTime) : ' 00:00:00');
            $startAt = normalize_datetime_for_db($startAtRaw) ?: $startAtRaw;
            $endAt = null;
            if ($endTime !== '') {
                $endAtRaw = $startDate . ' ' . $endTime;
                $endAt = normalize_datetime_for_db($endAtRaw) ?: $endAtRaw;
            }
            $metadata = array(
                'type' => 'class',
                'all_day' => $allDay,
                'source' => 'subject',
            );

            $eventData = array();
            if ($event) {
                if (in_array('study_log_id', $eventColumns, true) && isset($event['study_log_id'])) {
                    $eventData['study_log_id'] = $event['study_log_id'];
                }
            } elseif (in_array('study_log_id', $eventColumns, true) && table_exists('study_logs')) {
                $logRow = db_fetch_one('SELECT id FROM study_logs WHERE subject_id = ' . $subjectId . ' ORDER BY id ASC');
                if ($logRow && isset($logRow['id'])) {
                    $eventData['study_log_id'] = (int) $logRow['id'];
                }
            }

            if (in_array('user_id', $eventColumns, true)) {
                $eventData['user_id'] = (int) $user['id'];
            }
            if (in_array('subject_id', $eventColumns, true)) {
                $eventData['subject_id'] = $subjectId;
            }
            if (in_array('title', $eventColumns, true)) {
                $eventData['title'] = isset($subject['name']) ? $subject['name'] : 'ตารางเรียน';
            }
            if (in_array('description', $eventColumns, true)) {
                $eventData['description'] = null;
            }
            if (in_array('start_time', $eventColumns, true)) {
                $eventData['start_time'] = $startAt;
            }
            if (in_array('end_time', $eventColumns, true)) {
                $eventData['end_time'] = $endAt;
            }
            if (in_array('status', $eventColumns, true)) {
                $eventData['status'] = 'planned';
            }
            if (in_array('metadata', $eventColumns, true)) {
                $eventData['metadata'] = json_encode($metadata);
            }
            if (in_array('updated_at', $eventColumns, true)) {
                $eventData['updated_at'] = $now;
            }

            if ($event && isset($event['id'])) {
                db_update('study_calendar_events', $eventData, 'id = ' . (int) $event['id']);
            } else {
                if (in_array('id', $eventColumns, true)) {
                    $eventData['id'] = next_id_for('study_calendar_events');
                }
                if (in_array('created_at', $eventColumns, true)) {
                    $eventData['created_at'] = $now;
                }
                db_insert('study_calendar_events', $eventData);
            }
        }
    }

    $subject = db_fetch_one('SELECT * FROM subjects WHERE id = ' . $subjectId);
    $subject = subject_with_counts($subject, $user['id']);
    json_response($subject);
}

function handle_subject_get($subjectId)
{
    $user = require_auth_user();
    $subject = fetch_subject_for_user($subjectId, $user);
    $subject = subject_with_counts($subject);
    json_response($subject);
}

function handle_subject_delete($subjectId)
{
    $user = require_auth_user();
    fetch_subject_for_user($subjectId, $user);
    $subjectId = (int) $subjectId;

    if (table_exists('study_logs')) {
        $logRows = db_fetch_all('SELECT id FROM study_logs WHERE subject_id = ' . $subjectId);
        $logIds = array();
        foreach ($logRows as $row) {
            if (isset($row['id'])) {
                $logIds[] = (int) $row['id'];
            }
        }

        if ($logIds) {
            $logIdList = implode(',', $logIds);
            if (table_exists('files')) {
                db_exec('DELETE FROM files WHERE study_log_id IN (' . $logIdList . ')');
            }
            if (table_exists('summaries')) {
                db_exec('DELETE FROM summaries WHERE study_log_id IN (' . $logIdList . ')');
            }
            if (table_exists('audio_summaries')) {
                db_exec('DELETE FROM audio_summaries WHERE study_log_id IN (' . $logIdList . ')');
            }
            if (table_exists('audio_transcription_jobs')) {
                db_exec('DELETE FROM audio_transcription_jobs WHERE study_log_id IN (' . $logIdList . ')');
            }
            if (table_exists('topic_materials')) {
                db_exec('DELETE FROM topic_materials WHERE study_log_id IN (' . $logIdList . ')');
            }
            if (table_exists('study_calendar_events') && table_has_column('study_calendar_events', 'study_log_id')) {
                db_exec('DELETE FROM study_calendar_events WHERE study_log_id IN (' . $logIdList . ')');
            }
            if (table_exists('learning_notifications') && table_has_column('learning_notifications', 'study_log_id')) {
                db_exec('DELETE FROM learning_notifications WHERE study_log_id IN (' . $logIdList . ')');
            }
        }

        db_exec('DELETE FROM study_logs WHERE subject_id = ' . $subjectId);
    }

    if (table_exists('lessons')) {
        db_exec('DELETE FROM lessons WHERE subject_id = ' . $subjectId);
    }
    if (table_exists('schedules')) {
        db_exec('DELETE FROM schedules WHERE subject_id = ' . $subjectId);
    }
    if (table_exists('mood_logs')) {
        db_exec('DELETE FROM mood_logs WHERE subject_id = ' . $subjectId);
    }
    if (table_exists('study_calendar_events')) {
        db_exec('DELETE FROM study_calendar_events WHERE subject_id = ' . $subjectId);
    }
    if (table_exists('learning_notifications')) {
        db_exec('DELETE FROM learning_notifications WHERE subject_id = ' . $subjectId);
    }
    if (table_exists('study_notifications')) {
        db_exec('DELETE FROM study_notifications WHERE subject_id = ' . $subjectId);
    }
    if (table_exists('lesson_summaries')) {
        db_exec('DELETE FROM lesson_summaries WHERE subject_id = ' . $subjectId);
    }
    if (table_exists('career_recommendations')) {
        db_exec('DELETE FROM career_recommendations WHERE subject_id = ' . $subjectId);
    }

    if (table_exists('quizzes')) {
        $quizRows = db_fetch_all('SELECT id FROM quizzes WHERE subject_id = ' . $subjectId);
        $quizIds = array();
        foreach ($quizRows as $row) {
            if (isset($row['id'])) {
                $quizIds[] = (int) $row['id'];
            }
        }
        if ($quizIds) {
            $quizIdList = implode(',', $quizIds);
            if (table_exists('quiz_questions')) {
                $questionRows = db_fetch_all('SELECT id FROM quiz_questions WHERE quiz_id IN (' . $quizIdList . ')');
                $questionIds = array();
                foreach ($questionRows as $row) {
                    if (isset($row['id'])) {
                        $questionIds[] = (int) $row['id'];
                    }
                }
                if ($questionIds && table_exists('quiz_answers')) {
                    $questionIdList = implode(',', $questionIds);
                    db_exec('DELETE FROM quiz_answers WHERE question_id IN (' . $questionIdList . ')');
                }
                db_exec('DELETE FROM quiz_questions WHERE quiz_id IN (' . $quizIdList . ')');
            }
            if (table_exists('quiz_attempts')) {
                db_exec('DELETE FROM quiz_attempts WHERE quiz_id IN (' . $quizIdList . ')');
            }
            db_exec('DELETE FROM quizzes WHERE id IN (' . $quizIdList . ')');
        }
    }

    if (!db_exec('DELETE FROM subjects WHERE id = ' . $subjectId)) {
        json_response(array('message' => 'ลบวิชาไม่สำเร็จ'), 500);
    }

    $remaining = db_fetch_one('SELECT id FROM subjects WHERE id = ' . $subjectId);
    if ($remaining) {
        json_response(array('message' => 'ลบวิชาไม่สำเร็จ'), 500);
    }

    json_response(array('success' => true));
}

function handle_subject_delete_by_payload()
{
    $user = require_auth_user();
    $body = read_json_body();
    $subjectId = 0;

    if (isset($body['subject_id'])) {
        $subjectId = (int) $body['subject_id'];
    } elseif (isset($body['id'])) {
        $subjectId = (int) $body['id'];
    }

    if ($subjectId <= 0) {
        json_response(array('message' => 'Not found'), 404);
    }

    fetch_subject_for_user($subjectId, $user);
    handle_subject_delete($subjectId);
}

function handle_study_logs_get($subjectId)
{
    $user = require_auth_user();
    fetch_subject_for_user($subjectId, $user);
    $logs = load_study_logs($subjectId, true, $user['id']);
    json_response($logs);
}

function handle_study_logs_create($subjectId)
{
    $user = require_auth_user();
    fetch_subject_for_user($subjectId, $user);
    $body = read_json_body();
    if (!$body && !empty($_POST)) {
        $body = $_POST;
    }
    $columns = table_columns('study_logs');
    $now = date('Y-m-d H:i:s');
    $data = array();
    if (in_array('id', $columns, true)) {
        $data['id'] = next_id_for('study_logs');
    }
    if (in_array('subject_id', $columns, true)) {
        $data['subject_id'] = (int) $subjectId;
    }
    if (in_array('user_id', $columns, true)) {
        $data['user_id'] = (int) $user['id'];
    }
    if (in_array('title', $columns, true)) {
        $data['title'] = isset($body['title']) ? $body['title'] : 'Untitled';
    }
    if (in_array('note', $columns, true)) {
        $data['note'] = isset($body['note']) ? $body['note'] : null;
    }
    if (in_array('log_date', $columns, true)) {
        $logDateInput = isset($body['log_date']) ? trim((string) $body['log_date']) : '';
        if ($logDateInput !== '') {
            $logDate = normalize_date_value($logDateInput);
            if (!$logDate) {
                json_response(array('message' => 'รูปแบบวันที่ไม่ถูกต้อง'), 422);
            }
        } else {
            $logDate = date('Y-m-d');
        }
        $data['log_date'] = $logDate;
    }
    if (in_array('duration_minutes', $columns, true)) {
        if (!isset($body['duration_minutes']) || $body['duration_minutes'] === '' || $body['duration_minutes'] === null) {
            $data['duration_minutes'] = null;
        } else {
            $data['duration_minutes'] = (int) $body['duration_minutes'];
        }
    }
    if (in_array('mood', $columns, true)) {
        $data['mood'] = isset($body['mood']) ? $body['mood'] : null;
    }
    if (in_array('created_at', $columns, true)) {
        $data['created_at'] = $now;
    }
    if (in_array('updated_at', $columns, true)) {
        $data['updated_at'] = $now;
    }
    $newId = db_insert('study_logs', $data);
    if (!$newId) {
        json_response(array('message' => 'Unable to create study log'), 500);
    }
    $log = db_fetch_one('SELECT * FROM study_logs WHERE id = ' . (int) $newId);
    $log['files'] = array();
    $log['summaries'] = array();
    json_response($log);
}

function handle_file_upload($logId)
{
    $user = require_auth_user();
    fetch_study_log_for_user($logId, $user);
    if (!isset($_FILES['file'])) {
        json_response(array('message' => 'Missing file'), 400);
    }
    $file = $_FILES['file'];
    if ($file['error'] !== UPLOAD_ERR_OK) {
        json_response(array('message' => 'Upload failed'), 400);
    }
    $originalName = $file['name'];
    $extension = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
    $fileType = 'other';
    if ($extension === 'pdf') {
        $fileType = 'pdf';
    } elseif (in_array($extension, array('doc', 'docx'), true)) {
        $fileType = 'word';
    } elseif (in_array($extension, array('mp3', 'wav', 'm4a'), true)) {
        $fileType = 'audio';
    }
    $uploadsDir = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'public' . DIRECTORY_SEPARATOR . 'storage' . DIRECTORY_SEPARATOR . 'uploads';
    if (!is_dir($uploadsDir)) {
        mkdir($uploadsDir, 0755, true);
    }
    $filename = uniqid('file_', true) . ($extension ? '.' . $extension : '');
    $destination = $uploadsDir . DIRECTORY_SEPARATOR . $filename;
    if (!move_uploaded_file($file['tmp_name'], $destination)) {
        json_response(array('message' => 'Unable to save file'), 500);
    }
    $relativePath = 'uploads/' . $filename;
    $columns = table_columns('files');
    $now = date('Y-m-d H:i:s');
    $data = array();
    if (in_array('id', $columns, true)) {
        $data['id'] = next_id_for('files');
    }
    if (in_array('study_log_id', $columns, true)) {
        $data['study_log_id'] = (int) $logId;
    }
    if (in_array('original_name', $columns, true)) {
        $data['original_name'] = $originalName;
    }
    if (in_array('file_path', $columns, true)) {
        $data['file_path'] = $relativePath;
    }
    if (in_array('file_type', $columns, true)) {
        $data['file_type'] = $fileType;
    }
    if (in_array('mime_type', $columns, true)) {
        $data['mime_type'] = isset($file['type']) ? $file['type'] : null;
    }
    if (in_array('file_size', $columns, true)) {
        $data['file_size'] = isset($file['size']) ? (int) $file['size'] : null;
    }
    if (in_array('created_at', $columns, true)) {
        $data['created_at'] = $now;
    }
    if (in_array('updated_at', $columns, true)) {
        $data['updated_at'] = $now;
    }
    $newId = db_insert('files', $data);
    if (!$newId) {
        json_response(array('message' => 'Unable to save file metadata'), 500);
    }
    $fileRow = db_fetch_one('SELECT * FROM files WHERE id = ' . (int) $newId);
    json_response($fileRow);
}

function handle_summary_create($logId)
{
    $user = require_auth_user();
    $log = fetch_study_log_for_user($logId, $user);
    $content = 'Summary is not available in legacy mode.';
    if (isset($log['note']) && trim($log['note']) !== '') {
        $content = "Summary:\n" . $log['note'];
    }
    $columns = table_columns('summaries');
    $now = date('Y-m-d H:i:s');
    $data = array();
    if (in_array('id', $columns, true)) {
        $data['id'] = next_id_for('summaries');
    }
    if (in_array('study_log_id', $columns, true)) {
        $data['study_log_id'] = (int) $logId;
    }
    if (in_array('content', $columns, true)) {
        $data['content'] = $content;
    }
    if (in_array('ai_model', $columns, true)) {
        $data['ai_model'] = 'legacy';
    }
    if (in_array('metadata', $columns, true)) {
        $data['metadata'] = json_encode(array('source' => 'legacy'));
    }
    if (in_array('created_at', $columns, true)) {
        $data['created_at'] = $now;
    }
    if (in_array('updated_at', $columns, true)) {
        $data['updated_at'] = $now;
    }
    $newId = db_insert('summaries', $data);
    if (!$newId) {
        json_response(array('message' => 'Unable to create summary'), 500);
    }
    $summary = db_fetch_one('SELECT * FROM summaries WHERE id = ' . (int) $newId);
    json_response($summary);
}

function is_allowed_document_extension($ext)
{
    return in_array($ext, array('pdf', 'doc', 'docx', 'txt'), true);
}

function resolve_document_mime_type($file, $ext)
{
    $mime = isset($file['type']) ? (string) $file['type'] : '';
    if ($mime !== '' && $mime !== 'application/octet-stream') {
        return $mime;
    }
    $map = array(
        'pdf' => 'application/pdf',
        'doc' => 'application/msword',
        'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'txt' => 'text/plain',
    );
    return isset($map[$ext]) ? $map[$ext] : 'application/octet-stream';
}

function extract_docx_text_legacy($filePath)
{
    if (!class_exists('ZipArchive')) {
        return null;
    }
    $archive = new ZipArchive();
    if ($archive->open($filePath) !== true) {
        return null;
    }
    $xml = $archive->getFromName('word/document.xml');
    $archive->close();
    if ($xml === false) {
        return null;
    }
    $xml = str_replace(array('</w:p>', '</w:tr>', '</w:tab>'), array("\n", "\n", "\t"), $xml);
    $text = strip_tags($xml);
    $text = html_entity_decode($text, ENT_QUOTES | ENT_XML1, 'UTF-8');
    $text = preg_replace("/\n{2,}/", "\n\n", $text);
    return trim((string) $text);
}

function can_run_shell_command()
{
    if (!function_exists('shell_exec')) {
        return false;
    }
    $disabled = ini_get('disable_functions');
    if (!$disabled) {
        return true;
    }
    $list = array_map('trim', explode(',', $disabled));
    return !in_array('shell_exec', $list, true);
}

function find_executable($name)
{
    if (!can_run_shell_command()) {
        return null;
    }
    $command = stripos(PHP_OS, 'WIN') === 0 ? 'where' : 'command -v';
    $output = @shell_exec($command . ' ' . escapeshellarg($name));
    if (!$output) {
        return null;
    }
    $lines = preg_split('/\r\n|\r|\n/', trim((string) $output));
    return isset($lines[0]) && $lines[0] !== '' ? $lines[0] : null;
}

function extract_pdf_text_basic($filePath)
{
    $content = @file_get_contents($filePath, false, null, 0, 5 * 1024 * 1024);
    if ($content === false || $content === '') {
        return null;
    }
    $matches = array();
    preg_match_all('/\\(([^\\r\\n\\)]{1,1000})\\)\\s*T[Jj]/', $content, $matches);
    if (empty($matches[1])) {
        return null;
    }
    $chunks = array();
    foreach ($matches[1] as $chunk) {
        $chunk = preg_replace('/\\\\([\\\\\\(\\)\\r\\n\\t])/', '$1', $chunk);
        $chunk = str_replace(array("\r", "\n", "\t"), ' ', $chunk);
        $chunk = trim($chunk);
        if ($chunk !== '') {
            $chunks[] = $chunk;
        }
    }
    if (!$chunks) {
        return null;
    }
    return trim(implode(' ', $chunks));
}

function extract_pdf_text_via_pdftotext($filePath)
{
    $binary = find_executable('pdftotext');
    if (!$binary) {
        return null;
    }
    $cmd = escapeshellarg($binary) . ' -layout -nopgbrk ' . escapeshellarg($filePath) . ' -';
    $output = @shell_exec($cmd);
    if (!$output) {
        return null;
    }
    $text = trim((string) $output);
    return $text !== '' ? $text : null;
}

function extract_doc_text_via_command($filePath)
{
    $binary = find_executable('antiword');
    if ($binary) {
        $output = @shell_exec(escapeshellarg($binary) . ' ' . escapeshellarg($filePath));
        if ($output && trim($output) !== '') {
            return trim((string) $output);
        }
    }

    $binary = find_executable('catdoc');
    if ($binary) {
        $output = @shell_exec(escapeshellarg($binary) . ' ' . escapeshellarg($filePath));
        if ($output && trim($output) !== '') {
            return trim((string) $output);
        }
    }

    return null;
}

function extract_local_document_text($filePath, $ext)
{
    if ($ext === 'txt') {
        $content = @file_get_contents($filePath);
        return $content !== false ? trim((string) $content) : null;
    }
    if ($ext === 'docx') {
        return extract_docx_text_legacy($filePath);
    }
    if ($ext === 'doc') {
        return extract_doc_text_via_command($filePath);
    }
    if ($ext === 'pdf') {
        $text = extract_pdf_text_via_pdftotext($filePath);
        if ($text) {
            return $text;
        }
        return extract_pdf_text_basic($filePath);
    }
    return null;
}

function normalize_gemini_model($model)
{
    $model = trim((string) $model);
    if ($model === '') {
        return $model;
    }
    if (strpos($model, 'models/') === 0) {
        return substr($model, 7);
    }
    return $model;
}

function gemini_api_key()
{
    return env_value('GEMINI_API_KEY');
}

function gemini_model_name()
{
    $model = env_value('GEMINI_MODEL', 'gemini-2.0-flash');
    return normalize_gemini_model($model);
}

function gemini_generate_content($parts)
{
    $apiKey = gemini_api_key();
    if (!$apiKey) {
        json_response(array('message' => 'Gemini API key is missing.'), 422);
    }
    $model = gemini_model_name();
    $payload = array(
        'contents' => array(
            array(
                'role' => 'user',
                'parts' => $parts,
            ),
        ),
    );
    $url = 'https://generativelanguage.googleapis.com/v1/models/' . $model . ':generateContent?key=' . $apiKey;
    $body = json_encode($payload);
    $responseBody = null;
    $status = 0;

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, array('Content-Type: application/json'));
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        curl_setopt($ch, CURLOPT_TIMEOUT, 60);
        $responseBody = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        if ($responseBody === false) {
            $error = curl_error($ch);
            curl_close($ch);
            json_response(array('message' => $error ? $error : 'Gemini request failed'), 422);
        }
        curl_close($ch);
    } else {
        $context = stream_context_create(array(
            'http' => array(
                'method' => 'POST',
                'header' => "Content-Type: application/json\r\n",
                'content' => $body,
                'timeout' => 60,
            ),
        ));
        $responseBody = @file_get_contents($url, false, $context);
        if (isset($http_response_header[0])) {
            if (preg_match('#HTTP/\d+\.\d+\s+(\d+)#', $http_response_header[0], $matches)) {
                $status = (int) $matches[1];
            }
        }
    }

    if ($status < 200 || $status >= 300 || !$responseBody) {
        json_response(array('message' => 'Gemini request failed'), 422);
    }

    $decoded = json_decode($responseBody, true);
    if (!is_array($decoded)) {
        json_response(array('message' => 'Gemini response is invalid'), 422);
    }

    $parts = array();
    if (isset($decoded['candidates'][0]['content']['parts']) && is_array($decoded['candidates'][0]['content']['parts'])) {
        $parts = $decoded['candidates'][0]['content']['parts'];
    }
    $chunks = array();
    foreach ($parts as $part) {
        if (isset($part['text']) && trim($part['text']) !== '') {
            $chunks[] = trim($part['text']);
        }
    }
    return trim(implode("\n", $chunks));
}

function gemini_generate_content_safe($parts, &$error = null)
{
    $apiKey = gemini_api_key();
    if (!$apiKey) {
        $error = 'Gemini API key is missing.';
        return null;
    }

    $model = gemini_model_name();
    $payload = array(
        'contents' => array(
            array(
                'role' => 'user',
                'parts' => $parts,
            ),
        ),
    );
    $url = 'https://generativelanguage.googleapis.com/v1/models/' . $model . ':generateContent?key=' . $apiKey;
    $body = json_encode($payload);
    $responseBody = null;
    $status = 0;

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, array('Content-Type: application/json'));
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        curl_setopt($ch, CURLOPT_TIMEOUT, 60);
        $responseBody = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        if ($responseBody === false) {
            $error = curl_error($ch) ?: 'Gemini request failed';
            curl_close($ch);
            return null;
        }
        curl_close($ch);
    } else {
        $context = stream_context_create(array(
            'http' => array(
                'method' => 'POST',
                'header' => "Content-Type: application/json\r\n",
                'content' => $body,
                'timeout' => 60,
            ),
        ));
        $responseBody = @file_get_contents($url, false, $context);
        if (isset($http_response_header[0])) {
            if (preg_match('#HTTP/\d+\.\d+\s+(\d+)#', $http_response_header[0], $matches)) {
                $status = (int) $matches[1];
            }
        }
    }

    if ($status < 200 || $status >= 300 || !$responseBody) {
        $errorMessage = 'Gemini request failed';
        if ($responseBody) {
            $decodedError = json_decode($responseBody, true);
            if (is_array($decodedError) && isset($decodedError['error']['message'])) {
                $errorMessage = (string) $decodedError['error']['message'];
            }
        }
        $error = $errorMessage;
        if ($responseBody) {
            error_log('Gemini request failed (status ' . $status . '): ' . $responseBody);
        } else {
            error_log('Gemini request failed (status ' . $status . '): empty response');
        }
        return null;
    }

    $decoded = json_decode($responseBody, true);
    if (!is_array($decoded)) {
        $error = 'Gemini response is invalid';
        error_log('Gemini response is invalid: ' . $responseBody);
        return null;
    }

    $partsResponse = array();
    if (isset($decoded['candidates'][0]['content']['parts']) && is_array($decoded['candidates'][0]['content']['parts'])) {
        $partsResponse = $decoded['candidates'][0]['content']['parts'];
    }
    $chunks = array();
    foreach ($partsResponse as $part) {
        if (isset($part['text']) && trim($part['text']) !== '') {
            $chunks[] = trim($part['text']);
        }
    }
    $result = trim(implode("\n", $chunks));
    if ($result === '') {
        $error = 'Gemini response is empty';
        error_log('Gemini response is empty: ' . $responseBody);
        return null;
    }
    return $result;
}

function simple_summary_text($text)
{
    $sentences = preg_split('/[.!?]/', $text);
    $important = array_slice($sentences, 0, min(5, count($sentences)));
    return trim(implode('. ', $important)) . '.';
}

function handle_ai_document_analyze()
{
    require_auth_user();
    if (!isset($_FILES['file'])) {
        json_response(array('message' => 'Missing file'), 400);
    }
    $file = $_FILES['file'];
    if ($file['error'] !== UPLOAD_ERR_OK) {
        json_response(array('message' => 'Upload failed'), 400);
    }
    $originalName = isset($file['name']) ? $file['name'] : '';
    $ext = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
    if (!is_allowed_document_extension($ext)) {
        json_response(array('message' => 'รองรับเฉพาะไฟล์ PDF, DOC, DOCX หรือ TXT เท่านั้น'), 422);
    }
    $localText = extract_local_document_text($file['tmp_name'], $ext);
    if ($localText !== null && trim($localText) !== '') {
        json_response(array(
            'text' => $localText,
            'model' => 'local',
        ));
    }
    $prompt = 'Extract the raw text from the attached study material. Return only the extracted text.';
    $mimeType = resolve_document_mime_type($file, $ext);
    $parts = array(
        array('text' => $prompt),
        array(
            'inlineData' => array(
                'mimeType' => $mimeType,
                'data' => base64_encode(@file_get_contents($file['tmp_name'])),
            ),
        ),
    );
    $error = null;
    $content = gemini_generate_content_safe($parts, $error);
    if ($content !== null) {
        json_response(array(
            'text' => $content,
            'model' => gemini_model_name(),
        ));
    }
    if (!$error) {
        $error = 'ไม่สามารถดึงข้อความจากไฟล์นี้ได้';
    }
    if (!gemini_api_key()) {
        $error = 'ยังไม่ได้ตั้งค่า GEMINI_API_KEY สำหรับการอ่านไฟล์เอกสาร';
    }
    json_response(array('message' => $error), 422);
}

function handle_ai_document_summarize()
{
    require_auth_user();
    if (!isset($_FILES['file'])) {
        json_response(array('message' => 'Missing file'), 400);
    }
    $file = $_FILES['file'];
    if ($file['error'] !== UPLOAD_ERR_OK) {
        json_response(array('message' => 'Upload failed'), 400);
    }
    $originalName = isset($file['name']) ? $file['name'] : '';
    $ext = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
    if (!is_allowed_document_extension($ext)) {
        json_response(array('message' => 'รองรับเฉพาะไฟล์ PDF, DOC, DOCX หรือ TXT เท่านั้น'), 422);
    }
    $localText = extract_local_document_text($file['tmp_name'], $ext);
    $prompt = 'อ่านเนื้อหาต่อไปนี้ แล้วสรุปใจความสำคัญเป็นภาษาไทยแบบกระชับ ระบุ bullet หัวข้อสำคัญและ action items สั้นๆ';

    if ($localText !== null && trim($localText) !== '') {
        $summary = null;
        $summaryModel = 'local';
        if (gemini_api_key()) {
            $parts = array(
                array('text' => $prompt),
                array('text' => $localText),
            );
            $error = null;
            $summary = gemini_generate_content_safe($parts, $error);
            if ($summary !== null) {
                $summaryModel = gemini_model_name();
            }
        }
        if ($summary === null) {
            $summary = simple_summary_text($localText);
        }
        json_response(array(
            'summary' => $summary,
            'model' => $summaryModel,
            'text' => $localText,
        ));
    }

    $mimeType = resolve_document_mime_type($file, $ext);
    $parts = array(
        array('text' => $prompt),
        array(
            'inlineData' => array(
                'mimeType' => $mimeType,
                'data' => base64_encode(@file_get_contents($file['tmp_name'])),
            ),
        ),
    );
    $error = null;
    $summary = gemini_generate_content_safe($parts, $error);
    if ($summary !== null) {
        json_response(array(
            'summary' => $summary,
            'model' => gemini_model_name(),
        ));
    }
    if (!$error) {
        $error = 'ไม่สามารถสรุปไฟล์นี้ได้';
    }
    if (!gemini_api_key()) {
        $error = 'ยังไม่ได้ตั้งค่า GEMINI_API_KEY สำหรับการสรุปไฟล์เอกสาร';
    }
    json_response(array('message' => $error), 422);
}

function subject_display_name($subject)
{
    if (!$subject) {
        return 'Subject';
    }
    $nameColumn = subject_name_column();
    if (isset($subject[$nameColumn]) && trim((string) $subject[$nameColumn]) !== '') {
        return $subject[$nameColumn];
    }
    if (isset($subject['name']) && trim((string) $subject['name']) !== '') {
        return $subject['name'];
    }
    if (isset($subject['subject_name']) && trim((string) $subject['subject_name']) !== '') {
        return $subject['subject_name'];
    }
    return 'Subject';
}

function fetch_subject_for_user($subjectId, $user)
{
    $subject = db_fetch_one('SELECT * FROM subjects WHERE id = ' . (int) $subjectId);
    if (!$subject) {
        json_response(array('message' => 'Subject not found'), 404);
    }
    if ($user) {
        if (!table_has_column('subjects', 'user_id') || !isset($subject['user_id'])) {
            json_response(array('message' => 'Unauthorized'), 403);
        }
        if ((int) $subject['user_id'] !== (int) $user['id']) {
            json_response(array('message' => 'Unauthorized'), 403);
        }
    }
    return $subject;
}

function fetch_study_log_for_user($logId, $user)
{
    $log = db_fetch_one('SELECT * FROM study_logs WHERE id = ' . (int) $logId);
    if (!$log) {
        json_response(array('message' => 'Study log not found'), 404);
    }
    if ($user && isset($log['subject_id'])) {
        fetch_subject_for_user((int) $log['subject_id'], $user);
    }
    return $log;
}

function quiz_trim_context($text, $limit)
{
    $text = trim((string) $text);
    if ($text === '') {
        return '';
    }
    if (strlen($text) <= $limit) {
        return $text;
    }
    return substr($text, 0, $limit) . '...';
}

function quiz_extract_json_block($content)
{
    $start = strpos($content, '{');
    $end = strrpos($content, '}');
    if ($start === false || $end === false || $end <= $start) {
        return null;
    }
    return substr($content, $start, $end - $start + 1);
}

function quiz_decode_json_payload($content, $label)
{
    $decoded = json_decode($content, true);
    if (is_array($decoded)) {
        return $decoded;
    }
    $json = quiz_extract_json_block($content);
    if ($json) {
        $decoded = json_decode($json, true);
        if (is_array($decoded)) {
            return $decoded;
        }
    }
    json_response(array('message' => 'AI response is not valid JSON.'), 422);
}

function quiz_normalize_difficulty($value)
{
    $value = strtolower(trim((string) $value));
    if (!in_array($value, array('easy', 'medium', 'hard'), true)) {
        return 'medium';
    }
    return $value;
}

function quiz_normalize_types($types)
{
    $allowed = array('multiple_choice', 'true_false', 'short_answer');
    $result = array();
    if (is_string($types)) {
        $types = explode(',', $types);
    }
    if (is_array($types)) {
        foreach ($types as $type) {
            $type = strtolower(trim((string) $type));
            if ($type !== '' && in_array($type, $allowed, true) && !in_array($type, $result, true)) {
                $result[] = $type;
            }
        }
    }
    if (!$result) {
        $result = array('multiple_choice', 'short_answer');
    }
    return $result;
}

function quiz_normalize_question_type($type)
{
    $type = strtolower(trim((string) $type));
    $allowed = array('multiple_choice', 'true_false', 'short_answer');
    return in_array($type, $allowed, true) ? $type : 'multiple_choice';
}

function quiz_normalize_options($options, $type)
{
    if ($type === 'true_false') {
        return array('true', 'false');
    }
    if (is_string($options)) {
        $options = preg_split("/\r?\n|\|/", $options);
    }
    if (!is_array($options)) {
        return null;
    }
    $clean = array();
    foreach ($options as $option) {
        $option = trim((string) $option);
        if ($option !== '') {
            $clean[] = $option;
        }
    }
    return $clean ? array_values($clean) : null;
}

function quiz_normalize_questions($questions, $questionCount)
{
    if (!is_array($questions)) {
        $questions = array();
    }
    $result = array();
    foreach ($questions as $question) {
        if (!is_array($question)) {
            continue;
        }
        $questionText = '';
        if (isset($question['question_text'])) {
            $questionText = $question['question_text'];
        } elseif (isset($question['question'])) {
            $questionText = $question['question'];
        }
        $questionText = trim((string) $questionText);
        if ($questionText === '') {
            $questionText = 'Question';
        }
        $type = quiz_normalize_question_type(isset($question['question_type']) ? $question['question_type'] : null);
        $options = quiz_normalize_options(isset($question['options']) ? $question['options'] : null, $type);
        $result[] = array(
            'question_text' => $questionText,
            'question_type' => $type,
            'options' => $options,
            'correct_answer' => isset($question['correct_answer']) ? $question['correct_answer'] : null,
            'explanation' => isset($question['explanation']) ? $question['explanation'] : null,
        );
        if (count($result) >= $questionCount) {
            break;
        }
    }
    return $result;
}

function quiz_context_for_subject($subject)
{
    $subjectId = isset($subject['id']) ? (int) $subject['id'] : 0;
    if ($subjectId <= 0) {
        return array('context' => '', 'source' => 'subject');
    }

    if (table_exists('summaries') && table_exists('study_logs')) {
        $rows = db_fetch_all('SELECT summaries.content, study_logs.title, study_logs.log_date FROM summaries JOIN study_logs ON summaries.study_log_id = study_logs.id WHERE study_logs.subject_id = ' . $subjectId . ' ORDER BY summaries.id DESC LIMIT 3');
        $lines = array();
        foreach ($rows as $row) {
            $title = isset($row['title']) && $row['title'] !== '' ? $row['title'] : 'Study Log';
            $date = isset($row['log_date']) ? $row['log_date'] : null;
            $label = $date ? $title . ' (' . $date . ')' : $title;
            $content = quiz_trim_context(isset($row['content']) ? $row['content'] : '', 400);
            if ($content !== '') {
                $lines[] = '- ' . $label . ': ' . $content;
            }
        }
        if ($lines) {
            return array('context' => implode("\n", $lines), 'source' => 'summary');
        }
    }

    if (table_exists('study_logs')) {
        $rows = db_fetch_all('SELECT title, note, log_date FROM study_logs WHERE subject_id = ' . $subjectId . ' ORDER BY log_date DESC LIMIT 3');
        $lines = array();
        foreach ($rows as $row) {
            $title = isset($row['title']) && $row['title'] !== '' ? $row['title'] : 'Study Log';
            $date = isset($row['log_date']) ? $row['log_date'] : null;
            $label = $date ? $title . ' (' . $date . ')' : $title;
            $note = quiz_trim_context(isset($row['note']) ? $row['note'] : '', 400);
            if ($note !== '') {
                $lines[] = '- ' . $label . ': ' . $note;
            } else {
                $lines[] = '- ' . $label;
            }
        }
        if ($lines) {
            return array('context' => implode("\n", $lines), 'source' => 'study_log');
        }
    }

    $fallback = '';
    if (isset($subject['description']) && trim((string) $subject['description']) !== '') {
        $fallback = quiz_trim_context($subject['description'], 400);
    }
    if ($fallback === '') {
        $fallback = subject_display_name($subject);
    }

    return array('context' => $fallback, 'source' => 'subject');
}

function quiz_generate_payload($subject, $context, $preferences, $contextLabel, $source)
{
    $questionCount = isset($preferences['question_count']) ? (int) $preferences['question_count'] : 5;
    if ($questionCount < 3) {
        $questionCount = 3;
    }
    if ($questionCount > 50) {
        $questionCount = 50;
    }
    $difficulty = quiz_normalize_difficulty(isset($preferences['difficulty']) ? $preferences['difficulty'] : 'medium');
    $types = quiz_normalize_types(isset($preferences['question_types']) ? $preferences['question_types'] : null);
    $titleHint = isset($preferences['title']) ? trim((string) $preferences['title']) : '';
    $subjectName = subject_display_name($subject);
    $context = quiz_trim_context($context, 4000);
    if ($context === '') {
        $context = $subjectName;
    }

    $typeHint = implode(', ', $types);
    $typeMixHint = in_array('multiple_choice', $types, true) && in_array('short_answer', $types, true)
        ? 'Include a mix of multiple_choice and short_answer questions (at least 1 of each).'
        : 'Use only the allowed question types.';
    $titleLine = $titleHint !== '' ? 'Use the title "' . $titleHint . "\" if possible.\n" : '';
    $prompt = sprintf(
        "Generate a %s difficulty quiz for the subject \"%s\" with %d questions.\n%sAllowed question types: %s.\n%s\nUse ONLY the information from the %s below.\n\n%s:\n%s\n\nRespond in JSON with title, description, and questions (question_text, question_type, options, correct_answer, explanation). For multiple_choice questions, provide 4 options.",
        $difficulty,
        $subjectName,
        $questionCount,
        $titleLine,
        $typeHint,
        $typeMixHint,
        $contextLabel,
        ucfirst($contextLabel),
        $context
    );
    $content = gemini_generate_content(array(array('text' => "You generate structured JSON quizzes with questions array.\n\n" . $prompt)));
    $decoded = quiz_decode_json_payload($content, 'quiz');
    if ($titleHint !== '' && (!isset($decoded['title']) || trim((string) $decoded['title']) === '')) {
        $decoded['title'] = $titleHint;
    }
    $questions = quiz_normalize_questions(isset($decoded['questions']) ? $decoded['questions'] : array(), $questionCount);
    if (!$questions) {
        json_response(array('message' => 'ไม่สามารถสร้างคำถามจากข้อมูลได้'), 422);
    }
    return array(
        'title' => isset($decoded['title']) && trim((string) $decoded['title']) !== '' ? $decoded['title'] : ($subjectName . ' Quiz'),
        'description' => isset($decoded['description']) ? $decoded['description'] : null,
        'model' => gemini_model_name(),
        'metadata' => array(
            'difficulty' => $difficulty,
            'requested_types' => $types,
            'source' => $source,
        ),
        'questions' => $questions,
    );
}

function quiz_extract_document_text($file)
{
    $originalName = isset($file['name']) ? $file['name'] : '';
    $ext = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
    if (!is_allowed_document_extension($ext)) {
        json_response(array('message' => 'รองรับเฉพาะไฟล์ PDF, DOC, DOCX หรือ TXT เท่านั้น'), 422);
    }
    $localText = extract_local_document_text($file['tmp_name'], $ext);
    if ($localText !== null && trim($localText) !== '') {
        return $localText;
    }
    $prompt = 'Extract the raw text from the attached study material. Return only the extracted text.';
    $mimeType = resolve_document_mime_type($file, $ext);
    $parts = array(
        array('text' => $prompt),
        array(
            'inlineData' => array(
                'mimeType' => $mimeType,
                'data' => base64_encode(@file_get_contents($file['tmp_name'])),
            ),
        ),
    );
    return gemini_generate_content($parts);
}

function quiz_save_uploaded_file($file, $folder)
{
    $originalName = isset($file['name']) ? $file['name'] : '';
    $extension = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
    $uploadsDir = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'public' . DIRECTORY_SEPARATOR . 'storage' . DIRECTORY_SEPARATOR . $folder;
    if (!is_dir($uploadsDir)) {
        mkdir($uploadsDir, 0755, true);
    }
    $filename = uniqid('file_', true) . ($extension ? '.' . $extension : '');
    $destination = $uploadsDir . DIRECTORY_SEPARATOR . $filename;
    if (!move_uploaded_file($file['tmp_name'], $destination)) {
        json_response(array('message' => 'Unable to save file'), 500);
    }
    return array(
        'relative_path' => $folder . '/' . $filename,
        'extension' => $extension,
        'destination' => $destination,
    );
}

function quiz_create_study_log($subjectId, $title, $userId = null)
{
    if (!table_exists('study_logs')) {
        return null;
    }
    $columns = table_columns('study_logs');
    $now = date('Y-m-d H:i:s');
    $data = array();
    if (in_array('id', $columns, true)) {
        $data['id'] = next_id_for('study_logs');
    }
    if (in_array('subject_id', $columns, true)) {
        $data['subject_id'] = (int) $subjectId;
    }
    if (in_array('user_id', $columns, true) && $userId !== null) {
        $data['user_id'] = (int) $userId;
    }
    if (in_array('title', $columns, true)) {
        $data['title'] = $title;
    }
    if (in_array('note', $columns, true)) {
        $data['note'] = 'อัปโหลดไฟล์เพื่อสร้างแบบฝึกหัด';
    }
    if (in_array('log_date', $columns, true)) {
        $data['log_date'] = date('Y-m-d');
    }
    if (in_array('created_at', $columns, true)) {
        $data['created_at'] = $now;
    }
    if (in_array('updated_at', $columns, true)) {
        $data['updated_at'] = $now;
    }
    $newId = db_insert('study_logs', $data);
    return $newId ? (int) $newId : null;
}

function quiz_create_file_record($studyLogId, $file, $relativePath, $extension)
{
    if (!table_exists('files')) {
        return null;
    }
    $columns = table_columns('files');
    $now = date('Y-m-d H:i:s');
    $fileType = 'other';
    if ($extension === 'pdf') {
        $fileType = 'pdf';
    } elseif (in_array($extension, array('doc', 'docx'), true)) {
        $fileType = 'word';
    }
    $data = array();
    if (in_array('id', $columns, true)) {
        $data['id'] = next_id_for('files');
    }
    if (in_array('study_log_id', $columns, true)) {
        $data['study_log_id'] = $studyLogId ? (int) $studyLogId : null;
    }
    if (in_array('original_name', $columns, true)) {
        $data['original_name'] = isset($file['name']) ? $file['name'] : null;
    }
    if (in_array('file_path', $columns, true)) {
        $data['file_path'] = $relativePath;
    }
    if (in_array('file_type', $columns, true)) {
        $data['file_type'] = $fileType;
    }
    if (in_array('mime_type', $columns, true)) {
        $data['mime_type'] = isset($file['type']) ? $file['type'] : null;
    }
    if (in_array('file_size', $columns, true)) {
        $data['file_size'] = isset($file['size']) ? (int) $file['size'] : null;
    }
    if (in_array('created_at', $columns, true)) {
        $data['created_at'] = $now;
    }
    if (in_array('updated_at', $columns, true)) {
        $data['updated_at'] = $now;
    }
    $newId = db_insert('files', $data);
    return $newId ? (int) $newId : null;
}

function quiz_create_record($subjectId, $payload)
{
    if (!table_exists('quizzes')) {
        json_response(array('message' => 'Quiz table is missing.'), 422);
    }
    $columns = table_columns('quizzes');
    $now = date('Y-m-d H:i:s');
    $data = array();
    if (in_array('id', $columns, true)) {
        $data['id'] = next_id_for('quizzes');
    }
    if (in_array('subject_id', $columns, true)) {
        $data['subject_id'] = (int) $subjectId;
    }
    if (in_array('title', $columns, true)) {
        $data['title'] = $payload['title'];
    }
    if (in_array('description', $columns, true)) {
        $data['description'] = $payload['description'];
    }
    if (in_array('ai_model', $columns, true)) {
        $data['ai_model'] = isset($payload['model']) ? $payload['model'] : null;
    }
    if (in_array('metadata', $columns, true) && isset($payload['metadata'])) {
        $data['metadata'] = json_encode($payload['metadata']);
    }
    if (in_array('created_at', $columns, true)) {
        $data['created_at'] = $now;
    }
    if (in_array('updated_at', $columns, true)) {
        $data['updated_at'] = $now;
    }
    $newId = db_insert('quizzes', $data);
    if (!$newId) {
        json_response(array('message' => 'บันทึกแบบฝึกหัดไม่สำเร็จ'), 500);
    }
    return db_fetch_one('SELECT * FROM quizzes WHERE id = ' . (int) $newId);
}

function quiz_create_questions($quizId, $questions)
{
    if (!table_exists('quiz_questions')) {
        json_response(array('message' => 'Quiz questions table is missing.'), 422);
    }
    $columns = table_columns('quiz_questions');
    $now = date('Y-m-d H:i:s');
    $result = array();
    foreach ($questions as $question) {
        $data = array();
        if (in_array('id', $columns, true)) {
            $data['id'] = next_id_for('quiz_questions');
        }
        if (in_array('quiz_id', $columns, true)) {
            $data['quiz_id'] = (int) $quizId;
        }
        if (in_array('question_type', $columns, true)) {
            $data['question_type'] = $question['question_type'];
        }
        if (in_array('question_text', $columns, true)) {
            $data['question_text'] = $question['question_text'];
        }
        if (in_array('options', $columns, true)) {
            $data['options'] = $question['options'] ? json_encode($question['options']) : null;
        }
        if (in_array('correct_answer', $columns, true)) {
            $data['correct_answer'] = $question['correct_answer'];
        }
        if (in_array('points', $columns, true)) {
            $data['points'] = 1;
        }
        if (in_array('explanation', $columns, true)) {
            $data['explanation'] = $question['explanation'];
        }
        if (in_array('created_at', $columns, true)) {
            $data['created_at'] = $now;
        }
        if (in_array('updated_at', $columns, true)) {
            $data['updated_at'] = $now;
        }
        $newId = db_insert('quiz_questions', $data);
        if ($newId) {
            $row = db_fetch_one('SELECT * FROM quiz_questions WHERE id = ' . (int) $newId);
            if ($row) {
                $result[] = $row;
            }
        }
    }
    return $result;
}

function quiz_decode_metadata($raw)
{
    if (is_array($raw)) {
        return $raw;
    }
    if (!is_string($raw) || trim($raw) === '') {
        return null;
    }
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : null;
}

function quiz_question_payload($row)
{
    $options = null;
    if (isset($row['options'])) {
        $decoded = json_decode($row['options'], true);
        if (is_array($decoded)) {
            $options = $decoded;
        }
    }
    return array(
        'id' => isset($row['id']) ? (int) $row['id'] : null,
        'quiz_id' => isset($row['quiz_id']) ? (int) $row['quiz_id'] : null,
        'question_text' => isset($row['question_text']) ? $row['question_text'] : (isset($row['question']) ? $row['question'] : ''),
        'question_type' => isset($row['question_type']) ? $row['question_type'] : 'multiple_choice',
        'options' => $options,
        'correct_answer' => isset($row['correct_answer']) ? $row['correct_answer'] : null,
        'explanation' => isset($row['explanation']) ? $row['explanation'] : null,
    );
}

function quiz_questions_for_response($rows)
{
    $payload = array();
    foreach ($rows as $row) {
        $payload[] = quiz_question_payload($row);
    }
    return $payload;
}

function quiz_build_response($quizRow, $questions)
{
    $metadata = null;
    if (isset($quizRow['metadata'])) {
        $metadata = quiz_decode_metadata($quizRow['metadata']);
    }
    $payload = array(
        'id' => isset($quizRow['id']) ? (int) $quizRow['id'] : null,
        'subject_id' => isset($quizRow['subject_id']) ? (int) $quizRow['subject_id'] : null,
        'title' => isset($quizRow['title']) ? $quizRow['title'] : null,
        'description' => isset($quizRow['description']) ? $quizRow['description'] : null,
        'ai_model' => isset($quizRow['ai_model']) ? $quizRow['ai_model'] : null,
        'metadata' => $metadata,
    );
    if ($questions !== null) {
        $payload['questions'] = $questions;
    }
    return $payload;
}

function quiz_latest_attempt_for_user($quizId, $userId)
{
    if (!table_exists('quiz_answers')) {
        return null;
    }
    $questionRows = db_fetch_all('SELECT id FROM quiz_questions WHERE quiz_id = ' . (int) $quizId);
    if (!$questionRows) {
        return null;
    }
    $questionIds = array();
    foreach ($questionRows as $row) {
        if (isset($row['id'])) {
            $questionIds[] = (int) $row['id'];
        }
    }
    if (!$questionIds) {
        return null;
    }
    $answeredColumn = table_has_column('quiz_answers', 'answered_at') ? 'answered_at' : 'created_at';
    $sql = 'SELECT ' . $answeredColumn . ' AS answered_at, SUM(score) AS score, COUNT(*) AS total FROM quiz_answers WHERE user_id = ' . (int) $userId . ' AND question_id IN (' . implode(',', $questionIds) . ') AND ' . $answeredColumn . ' IS NOT NULL GROUP BY ' . $answeredColumn . ' ORDER BY ' . $answeredColumn . ' DESC LIMIT 1';
    $row = db_fetch_one($sql);
    if (!$row) {
        return null;
    }
    $total = isset($row['total']) ? (int) $row['total'] : 0;
    $score = isset($row['score']) ? (int) $row['score'] : 0;
    return array(
        'score' => $score,
        'total' => $total,
        'percentage' => $total > 0 ? round(($score / $total) * 100) : 0,
        'answered_at' => isset($row['answered_at']) ? $row['answered_at'] : null,
    );
}

function handle_subject_quizzes_list($subjectId)
{
    $user = require_auth_user();
    fetch_subject_for_user($subjectId, $user);
    if (!table_exists('quizzes')) {
        json_response(array());
    }
    $rows = db_fetch_all('SELECT * FROM quizzes WHERE subject_id = ' . (int) $subjectId . ' ORDER BY id DESC');
    $payload = array();
    foreach ($rows as $row) {
        $item = quiz_build_response($row, null);
        $item['latest_attempt'] = quiz_latest_attempt_for_user(isset($row['id']) ? (int) $row['id'] : 0, (int) $user['id']);
        $payload[] = $item;
    }
    json_response($payload);
}

function handle_subject_quizzes_create($subjectId)
{
    $user = require_auth_user();
    $subject = fetch_subject_for_user($subjectId, $user);
    $body = read_json_body();
    $preferences = array(
        'title' => isset($body['title']) ? $body['title'] : null,
        'difficulty' => isset($body['difficulty']) ? $body['difficulty'] : null,
        'question_count' => isset($body['question_count']) ? $body['question_count'] : null,
        'question_types' => isset($body['question_types']) ? $body['question_types'] : null,
    );
    $contextData = quiz_context_for_subject($subject);
    $payload = quiz_generate_payload($subject, $contextData['context'], $preferences, 'study summaries', $contextData['source']);
    $quizRow = quiz_create_record($subjectId, $payload);
    $questionRows = quiz_create_questions(isset($quizRow['id']) ? (int) $quizRow['id'] : 0, $payload['questions']);
    $response = quiz_build_response($quizRow, quiz_questions_for_response($questionRows));
    json_response($response, 201);
}

function handle_subject_quizzes_from_file($subjectId)
{
    $user = require_auth_user();
    $subject = fetch_subject_for_user($subjectId, $user);
    if (!isset($_FILES['file'])) {
        json_response(array('message' => 'Missing file'), 400);
    }
    $file = $_FILES['file'];
    if ($file['error'] !== UPLOAD_ERR_OK) {
        json_response(array('message' => 'Upload failed'), 400);
    }

    $text = quiz_extract_document_text($file);
    if (trim((string) $text) === '') {
        json_response(array('message' => 'ไม่สามารถดึงข้อความจากไฟล์ได้'), 422);
    }

    $preferences = array(
        'title' => isset($_POST['title']) ? $_POST['title'] : null,
        'difficulty' => isset($_POST['difficulty']) ? $_POST['difficulty'] : null,
        'question_count' => isset($_POST['question_count']) ? $_POST['question_count'] : null,
        'question_types' => isset($_POST['question_types']) ? $_POST['question_types'] : null,
    );
    $payload = quiz_generate_payload($subject, $text, $preferences, 'document text', 'document');

    $upload = quiz_save_uploaded_file($file, 'uploads');
    $logTitle = isset($file['name']) ? trim(pathinfo($file['name'], PATHINFO_FILENAME)) : '';
    $logTitle = $logTitle !== '' ? 'แบบฝึกหัดจากไฟล์: ' . $logTitle : 'แบบฝึกหัดจากไฟล์เอกสาร';
    // Retain the relation for legacy databases where files.study_log_id is NOT NULL.
    // The marked legacy row is excluded from the study-summary menu in admin.php.
    $studyLogId = quiz_create_study_log($subjectId, $logTitle, $user['id']);
    $fileId = quiz_create_file_record($studyLogId, $file, $upload['relative_path'], $upload['extension']);

    if (isset($payload['metadata']) && is_array($payload['metadata'])) {
        $payload['metadata']['file_name'] = isset($file['name']) ? $file['name'] : null;
        $payload['metadata']['file_id'] = $fileId;
        $payload['metadata']['study_log_id'] = $studyLogId;
        $payload['metadata']['source'] = 'document';
    }

    $quizRow = quiz_create_record($subjectId, $payload);
    $questionRows = quiz_create_questions(isset($quizRow['id']) ? (int) $quizRow['id'] : 0, $payload['questions']);
    $response = quiz_build_response($quizRow, quiz_questions_for_response($questionRows));
    json_response($response, 201);
}

function handle_quiz_show($quizId)
{
    $user = require_auth_user();
    $quizRow = db_fetch_one('SELECT * FROM quizzes WHERE id = ' . (int) $quizId);
    if (!$quizRow) {
        json_response(array('message' => 'Quiz not found'), 404);
    }
    $subjectId = isset($quizRow['subject_id']) ? (int) $quizRow['subject_id'] : 0;
    fetch_subject_for_user($subjectId, $user);
    $questionRows = db_fetch_all('SELECT * FROM quiz_questions WHERE quiz_id = ' . (int) $quizId . ' ORDER BY id ASC');
    $response = quiz_build_response($quizRow, quiz_questions_for_response($questionRows));
    json_response($response);
}

function quiz_answers_match($expected, $actual)
{
    $expected = strtolower(trim((string) $expected));
    $actual = strtolower(trim((string) $actual));
    if ($expected === '' || $actual === '') {
        return false;
    }
    return $expected === $actual;
}

function handle_quiz_attempts_submit($quizId)
{
    $user = require_auth_user();
    $quizRow = db_fetch_one('SELECT * FROM quizzes WHERE id = ' . (int) $quizId);
    if (!$quizRow) {
        json_response(array('message' => 'Quiz not found'), 404);
    }
    $subjectId = isset($quizRow['subject_id']) ? (int) $quizRow['subject_id'] : 0;
    fetch_subject_for_user($subjectId, $user);
    $questionRows = db_fetch_all('SELECT * FROM quiz_questions WHERE quiz_id = ' . (int) $quizId);
    if (!$questionRows) {
        json_response(array('message' => 'ไม่พบคำถามในแบบฝึกหัดนี้'), 422);
    }

    $body = read_json_body();
    $answers = isset($body['answers']) && is_array($body['answers']) ? $body['answers'] : array();
    $answersByQuestion = array();
    foreach ($answers as $answer) {
        if (!is_array($answer) || !isset($answer['question_id'])) {
            continue;
        }
        $answersByQuestion[(int) $answer['question_id']] = isset($answer['selected_answer']) ? $answer['selected_answer'] : null;
    }

    $answerColumns = table_exists('quiz_answers') ? table_columns('quiz_answers') : array();
    $now = date('Y-m-d H:i:s');
    $totalScore = 0;
    $resultAnswers = array();

    foreach ($questionRows as $question) {
        $questionId = isset($question['id']) ? (int) $question['id'] : 0;
        $selected = isset($answersByQuestion[$questionId]) ? $answersByQuestion[$questionId] : null;
        $correct = isset($question['correct_answer']) ? $question['correct_answer'] : null;
        $isCorrect = $questionId ? quiz_answers_match($correct, $selected) : false;
        $questionScore = $isCorrect ? 1 : 0;
        $totalScore += $questionScore;

        if ($answerColumns) {
            $data = array();
            if (in_array('id', $answerColumns, true)) {
                $data['id'] = next_id_for('quiz_answers');
            }
            if (in_array('question_id', $answerColumns, true)) {
                $data['question_id'] = $questionId;
            }
            if (in_array('user_id', $answerColumns, true)) {
                $data['user_id'] = (int) $user['id'];
            }
            if (in_array('selected_answer', $answerColumns, true)) {
                $data['selected_answer'] = $selected;
            }
            if (in_array('is_correct', $answerColumns, true)) {
                $data['is_correct'] = $isCorrect ? 1 : 0;
            }
            if (in_array('score', $answerColumns, true)) {
                $data['score'] = $questionScore;
            }
            if (in_array('metadata', $answerColumns, true)) {
                $data['metadata'] = json_encode(array('quiz_id' => (int) $quizId));
            }
            if (in_array('answered_at', $answerColumns, true)) {
                $data['answered_at'] = $now;
            }
            if (in_array('created_at', $answerColumns, true)) {
                $data['created_at'] = $now;
            }
            if (in_array('updated_at', $answerColumns, true)) {
                $data['updated_at'] = $now;
            }
            db_insert('quiz_answers', $data);
        }

        $payload = quiz_question_payload($question);
        $resultAnswers[] = array(
            'question_id' => $questionId,
            'selected_answer' => $selected,
            'is_correct' => $isCorrect,
            'correct_answer' => $correct,
            'explanation' => isset($payload['explanation']) ? $payload['explanation'] : null,
            'question_text' => isset($payload['question_text']) ? $payload['question_text'] : null,
            'question_type' => isset($payload['question_type']) ? $payload['question_type'] : null,
            'options' => isset($payload['options']) ? $payload['options'] : null,
        );
    }

    json_response(array(
        'score' => $totalScore,
        'total' => count($questionRows),
        'answers' => $resultAnswers,
    ));
}

function table_exists($table)
{
    $row = db_fetch_one('SHOW TABLES LIKE ' . db_escape($table));
    return $row !== null;
}

function normalize_datetime_for_db($value)
{
    $value = trim((string) $value);
    if ($value === '') {
        return null;
    }
    $ts = strtotime($value);
    if ($ts === false) {
        return null;
    }
    return date('Y-m-d H:i:s', $ts);
}

function normalize_datetime_for_output($value)
{
    $value = trim((string) $value);
    if ($value === '') {
        return null;
    }
    $ts = strtotime($value);
    if ($ts === false) {
        return $value;
    }
    return date('c', $ts);
}

function normalize_bool($value)
{
    if (is_bool($value)) {
        return $value;
    }
    $value = strtolower(trim((string) $value));
    return in_array($value, array('1', 'true', 'yes', 'on'), true);
}

function subject_name_column()
{
    if (table_has_column('subjects', 'name')) {
        return 'name';
    }
    if (table_has_column('subjects', 'subject_name')) {
        return 'subject_name';
    }
    return 'name';
}

function load_subject_map($userId)
{
    $nameColumn = subject_name_column();
    if (!table_has_column('subjects', 'user_id')) {
        error_log('subjects.user_id missing; returning empty subject map for user ' . (int) $userId);
        return array();
    }
    $rows = db_fetch_all('SELECT * FROM subjects WHERE user_id = ' . (int) $userId);
    $map = array();
    foreach ($rows as $row) {
        $id = isset($row['id']) ? (int) $row['id'] : null;
        if (!$id) {
            continue;
        }
        $map[$id] = array(
            'id' => $id,
            'name' => isset($row[$nameColumn]) ? $row[$nameColumn] : null,
        );
    }
    return $map;
}

function parse_event_metadata($raw)
{
    if (is_array($raw)) {
        return $raw;
    }
    if (!is_string($raw) || trim($raw) === '') {
        return array();
    }
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : array();
}

function build_calendar_event_payload($row, $subjectMap, $fallbackSource)
{
    $metadata = parse_event_metadata(isset($row['metadata']) ? $row['metadata'] : null);
    $subjectId = isset($row['subject_id']) ? (int) $row['subject_id'] : null;
    $source = isset($metadata['source']) ? $metadata['source'] : $fallbackSource;

    return array(
        'id' => isset($row['id']) ? (int) $row['id'] : null,
        'subject_id' => $subjectId ?: null,
        'study_log_id' => isset($row['study_log_id']) ? (int) $row['study_log_id'] : null,
        'title' => isset($row['title']) ? $row['title'] : '',
        'description' => isset($row['description']) ? $row['description'] : null,
        'start_time' => normalize_datetime_for_output(isset($row['start_time']) ? $row['start_time'] : null),
        'end_time' => normalize_datetime_for_output(isset($row['end_time']) ? $row['end_time'] : null),
        'status' => isset($row['status']) ? $row['status'] : 'planned',
        'type' => isset($metadata['type']) ? $metadata['type'] : null,
        'all_day' => normalize_bool(isset($metadata['all_day']) ? $metadata['all_day'] : false),
        'source' => $source,
        'metadata' => $metadata,
        'subject' => $subjectId && isset($subjectMap[$subjectId]) ? $subjectMap[$subjectId] : null,
        'created_at' => isset($row['created_at']) ? $row['created_at'] : null,
        'updated_at' => isset($row['updated_at']) ? $row['updated_at'] : null,
    );
}

function load_calendar_events($userId)
{
    $subjectMap = load_subject_map($userId);
    if (table_has_column('study_calendar_events', 'id')) {
        $conditions = array('user_id = ' . (int) $userId);
        if (isset($_GET['start']) && $_GET['start'] !== '') {
            $start = normalize_datetime_for_db($_GET['start']);
            if ($start) {
                $conditions[] = "start_time >= " . db_escape($start);
            }
        }
        if (isset($_GET['end']) && $_GET['end'] !== '') {
            $end = normalize_datetime_for_db($_GET['end']);
            if ($end) {
                $conditions[] = "start_time <= " . db_escape($end);
            }
        }
        $sql = 'SELECT * FROM study_calendar_events WHERE ' . implode(' AND ', $conditions) . ' ORDER BY start_time ASC';
        $rows = db_fetch_all($sql);
        $payload = array();
        foreach ($rows as $row) {
            $payload[] = build_calendar_event_payload($row, $subjectMap, 'manual');
        }
        return $payload;
    }

    if (table_has_column('calendar_notes', 'id')) {
        $sql = 'SELECT * FROM calendar_notes WHERE user_id = ' . (int) $userId . ' ORDER BY note_date ASC, note_time ASC';
        $rows = db_fetch_all($sql);
        $payload = array();
        foreach ($rows as $row) {
            $startTime = null;
            if (isset($row['note_date'])) {
                $startTime = $row['note_date'];
                if (isset($row['note_time']) && $row['note_time'] !== '') {
                    $startTime .= ' ' . $row['note_time'];
                }
            }
            $payload[] = array(
                'id' => isset($row['id']) ? (int) $row['id'] : null,
                'subject_id' => null,
                'study_log_id' => null,
                'title' => isset($row['title']) ? $row['title'] : '',
                'description' => isset($row['description']) ? $row['description'] : null,
                'start_time' => normalize_datetime_for_output($startTime),
                'end_time' => null,
                'status' => 'planned',
                'type' => null,
                'all_day' => false,
                'source' => 'manual',
                'metadata' => array('source' => 'manual', 'all_day' => false),
                'subject' => null,
                'created_at' => isset($row['created_at']) ? $row['created_at'] : null,
                'updated_at' => isset($row['updated_at']) ? $row['updated_at'] : null,
            );
        }
        return $payload;
    }

    return array();
}

function handle_calendar_events_index()
{
    $user = require_auth_user();
    $events = load_calendar_events((int) $user['id']);
    json_response($events);
}

function handle_calendar_events_store()
{
    $user = require_auth_user();
    $body = read_json_body();

    $title = isset($body['title']) ? trim((string) $body['title']) : '';
    $startInput = isset($body['start_time']) ? $body['start_time'] : '';
    $startTime = normalize_datetime_for_db($startInput);

    if ($title === '' || !$startTime) {
        json_response(array('message' => 'กรุณากรอกชื่อกิจกรรมและเวลาเริ่ม'), 422);
    }

    $endTime = null;
    if (array_key_exists('end_time', $body) && $body['end_time']) {
        $endTime = normalize_datetime_for_db($body['end_time']);
    }

    if ($endTime && $startTime && strtotime($endTime) < strtotime($startTime)) {
        json_response(array('message' => 'เวลาเลิกต้องไม่ก่อนเวลาเริ่ม'), 422);
    }

    $subjectId = null;
    if (isset($body['subject_id']) && $body['subject_id'] !== '') {
        $subjectId = (int) $body['subject_id'];
    }

    if ($subjectId) {
        fetch_subject_for_user($subjectId, $user);
    }

    if (table_has_column('study_calendar_events', 'id')) {
        $columns = table_columns('study_calendar_events');
        $now = date('Y-m-d H:i:s');
        $eventType = isset($body['type']) ? $body['type'] : 'class';
        $isSubjectSchedule = $subjectId && $eventType === 'class';
        $metadata = array(
            'type' => $eventType,
            'all_day' => normalize_bool(isset($body['all_day']) ? $body['all_day'] : false),
            'source' => $isSubjectSchedule ? 'subject' : 'manual',
        );

        $data = array();
        if (in_array('user_id', $columns, true)) {
            $data['user_id'] = (int) $user['id'];
        }
        if (in_array('subject_id', $columns, true)) {
            $data['subject_id'] = $subjectId ?: null;
        }
        if (in_array('study_log_id', $columns, true)) {
            $data['study_log_id'] = null;
        }
        if (in_array('title', $columns, true)) {
            $data['title'] = $title;
        }
        if (in_array('description', $columns, true)) {
            $data['description'] = isset($body['description']) ? $body['description'] : null;
        }
        if (in_array('start_time', $columns, true)) {
            $data['start_time'] = $startTime;
        }
        if (in_array('end_time', $columns, true)) {
            $data['end_time'] = $endTime;
        }
        if (in_array('status', $columns, true)) {
            $data['status'] = isset($body['status']) ? $body['status'] : 'planned';
        }
        if (in_array('metadata', $columns, true)) {
            $data['metadata'] = json_encode($metadata);
        }
        if (in_array('updated_at', $columns, true)) {
            $data['updated_at'] = $now;
        }

        $existingEvent = null;
        if ($isSubjectSchedule) {
            $rows = db_fetch_all(
                'SELECT * FROM study_calendar_events WHERE subject_id = ' . (int) $subjectId . ' AND user_id = ' . (int) $user['id'] . ' ORDER BY id DESC'
            );
            foreach ($rows as $row) {
                $rowMeta = parse_event_metadata(isset($row['metadata']) ? $row['metadata'] : null);
                if (isset($rowMeta['source']) && $rowMeta['source'] === 'subject') {
                    $existingEvent = $row;
                    break;
                }
            }
        }

        if ($existingEvent && isset($existingEvent['id'])) {
            if (in_array('created_at', $columns, true)) {
                unset($data['created_at']);
            }
            $newId = (int) $existingEvent['id'];
            db_update('study_calendar_events', $data, 'id = ' . (int) $existingEvent['id']);
        } else {
            if (in_array('id', $columns, true)) {
                $data['id'] = next_id_for('study_calendar_events');
            }
            if (in_array('created_at', $columns, true)) {
                $data['created_at'] = $now;
            }
            $newId = db_insert('study_calendar_events', $data);
        }
        if (!$newId) {
            json_response(array('message' => 'บันทึกตารางไม่สำเร็จ'), 500);
        }

        if ($isSubjectSchedule && table_exists('subjects')) {
            $subjectColumns = table_columns('subjects');
            $subjectData = array();
            $startDate = substr($startTime, 0, 10);
            $startClock = substr($startTime, 11, 8);
            $endClock = $endTime ? substr($endTime, 11, 8) : null;
            $allDay = normalize_bool(isset($metadata['all_day']) ? $metadata['all_day'] : false);

            if (in_array('start_date', $subjectColumns, true)) {
                $subjectData['start_date'] = $startDate !== '' ? $startDate : null;
            }
            if (in_array('start_time', $subjectColumns, true)) {
                $subjectData['start_time'] = $allDay ? null : ($startClock ?: null);
            }
            if (in_array('end_time', $subjectColumns, true)) {
                $subjectData['end_time'] = $allDay ? null : ($endClock ?: null);
            }
            if (in_array('updated_at', $subjectColumns, true)) {
                $subjectData['updated_at'] = $now;
            }

            if ($subjectData) {
                db_update('subjects', $subjectData, 'id = ' . (int) $subjectId);
            }
        }

        $row = db_fetch_one('SELECT * FROM study_calendar_events WHERE id = ' . (int) $newId);
        $subjectMap = load_subject_map((int) $user['id']);
        $payload = build_calendar_event_payload($row, $subjectMap, 'manual');
        json_response($payload, 201);
    }

    if (table_has_column('calendar_notes', 'id')) {
        $columns = table_columns('calendar_notes');
        $noteDate = substr($startTime, 0, 10);
        $noteTime = substr($startTime, 11, 5);
        $now = date('Y-m-d H:i:s');
        $data = array();
        if (in_array('id', $columns, true)) {
            $data['id'] = next_id_for('calendar_notes');
        }
        if (in_array('user_id', $columns, true)) {
            $data['user_id'] = (int) $user['id'];
        }
        if (in_array('note_date', $columns, true)) {
            $data['note_date'] = $noteDate;
        }
        if (in_array('note_time', $columns, true)) {
            $data['note_time'] = $noteTime;
        }
        if (in_array('title', $columns, true)) {
            $data['title'] = $title;
        }
        if (in_array('description', $columns, true)) {
            $data['description'] = isset($body['description']) ? $body['description'] : null;
        }
        if (in_array('created_at', $columns, true)) {
            $data['created_at'] = $now;
        }
        if (in_array('updated_at', $columns, true)) {
            $data['updated_at'] = $now;
        }
        $newId = db_insert('calendar_notes', $data);
        if (!$newId) {
            json_response(array('message' => 'บันทึกตารางไม่สำเร็จ'), 500);
        }
        $row = db_fetch_one('SELECT * FROM calendar_notes WHERE id = ' . (int) $newId);
        $startTime = null;
        if ($row && isset($row['note_date'])) {
            $startTime = $row['note_date'];
            if (isset($row['note_time']) && $row['note_time'] !== '') {
                $startTime .= ' ' . $row['note_time'];
            }
        }
        json_response(array(
            'id' => $row ? (int) $row['id'] : (int) $newId,
            'subject_id' => null,
            'study_log_id' => null,
            'title' => $row && isset($row['title']) ? $row['title'] : $title,
            'description' => $row && isset($row['description']) ? $row['description'] : null,
            'start_time' => normalize_datetime_for_output($startTime),
            'end_time' => null,
            'status' => 'planned',
            'type' => null,
            'all_day' => false,
            'source' => 'manual',
            'metadata' => array('source' => 'manual', 'all_day' => false),
            'subject' => null,
            'created_at' => $row && isset($row['created_at']) ? $row['created_at'] : null,
            'updated_at' => $row && isset($row['updated_at']) ? $row['updated_at'] : null,
        ), 201);
    }

    json_response(array('message' => 'Calendar table is missing'), 422);
}

function handle_calendar_events_update($eventId)
{
    $user = require_auth_user();
    $eventId = (int) $eventId;
    if ($eventId <= 0) {
        json_response(array('message' => 'Event not found'), 404);
    }

    $body = read_json_body();
    if (table_has_column('study_calendar_events', 'id')) {
        $row = db_fetch_one('SELECT * FROM study_calendar_events WHERE id = ' . $eventId . ' AND user_id = ' . (int) $user['id']);
        if (!$row) {
            json_response(array('message' => 'Event not found'), 404);
        }
        if (isset($row['study_log_id']) && $row['study_log_id']) {
            json_response(array('message' => 'ไม่สามารถแก้ไขตารางที่มาจากบันทึกการเรียนได้'), 422);
        }

        $startTime = array_key_exists('start_time', $body)
            ? normalize_datetime_for_db($body['start_time'])
            : normalize_datetime_for_db(isset($row['start_time']) ? $row['start_time'] : null);
        $endTime = array_key_exists('end_time', $body)
            ? ($body['end_time'] ? normalize_datetime_for_db($body['end_time']) : null)
            : (isset($row['end_time']) && $row['end_time'] ? normalize_datetime_for_db($row['end_time']) : null);
        if (!$startTime) {
            json_response(array('message' => 'กรุณาระบุเวลาเริ่ม'), 422);
        }
        if ($endTime && strtotime($endTime) <= strtotime($startTime)) {
            json_response(array('message' => 'เวลาเลิกต้องมากกว่าเวลาเริ่ม'), 422);
        }

        $subjectId = array_key_exists('subject_id', $body) ? (int) $body['subject_id'] : (int) (isset($row['subject_id']) ? $row['subject_id'] : 0);
        if ($subjectId) {
            fetch_subject_for_user($subjectId, $user);
        }

        $columns = table_columns('study_calendar_events');
        $metadata = parse_event_metadata(isset($row['metadata']) ? $row['metadata'] : null);
        $eventType = isset($body['event_type']) ? $body['event_type'] : (isset($body['type']) ? $body['type'] : (isset($metadata['type']) ? $metadata['type'] : 'class'));
        $metadata['type'] = $eventType;
        $metadata['all_day'] = array_key_exists('all_day', $body) ? normalize_bool($body['all_day']) : normalize_bool(isset($metadata['all_day']) ? $metadata['all_day'] : false);
        $metadata['source'] = 'manual';

        $data = array();
        if (in_array('subject_id', $columns, true)) $data['subject_id'] = $subjectId ?: null;
        if (in_array('title', $columns, true) && array_key_exists('title', $body)) $data['title'] = trim((string) $body['title']);
        if (in_array('description', $columns, true) && array_key_exists('description', $body)) $data['description'] = $body['description'];
        if (in_array('start_time', $columns, true)) $data['start_time'] = $startTime;
        if (in_array('end_time', $columns, true)) $data['end_time'] = $endTime;
        if (in_array('status', $columns, true) && array_key_exists('status', $body)) $data['status'] = $body['status'];
        if (in_array('event_type', $columns, true)) $data['event_type'] = $eventType;
        if (in_array('room', $columns, true) && array_key_exists('room', $body)) $data['room'] = $body['room'];
        if (in_array('metadata', $columns, true)) $data['metadata'] = json_encode($metadata);
        if (in_array('updated_at', $columns, true)) $data['updated_at'] = date('Y-m-d H:i:s');

        if (!db_update('study_calendar_events', $data, 'id = ' . $eventId)) {
            json_response(array('message' => 'บันทึกตารางไม่สำเร็จ'), 500);
        }
        $updated = db_fetch_one('SELECT * FROM study_calendar_events WHERE id = ' . $eventId);
        json_response(build_calendar_event_payload($updated, load_subject_map((int) $user['id']), 'manual'));
    }

    json_response(array('message' => 'Calendar table is missing'), 422);
}

function handle_calendar_events_delete($eventId)
{
    $user = require_auth_user();
    $eventId = (int) $eventId;
    if ($eventId <= 0) {
        json_response(array('message' => 'Event not found'), 404);
    }

    if (table_has_column('study_calendar_events', 'id')) {
        $row = db_fetch_one('SELECT * FROM study_calendar_events WHERE id = ' . $eventId);
        if (!$row) {
            json_response(array('message' => 'Event not found'), 404);
        }
        if (isset($row['user_id']) && (int) $row['user_id'] !== (int) $user['id']) {
            json_response(array('message' => 'Unauthorized'), 403);
        }
        if (!empty($row['study_log_id'])) {
            json_response(array('message' => 'ไม่สามารถลบตารางที่มาจากบันทึกการเรียนได้'), 422);
        }
        $metadata = parse_event_metadata(isset($row['metadata']) ? $row['metadata'] : null);
        if (isset($metadata['source']) && $metadata['source'] === 'study_log') {
            json_response(array('message' => 'ไม่สามารถลบตารางที่มาจากบันทึกการเรียนได้'), 422);
        }

        if (isset($metadata['source']) && $metadata['source'] === 'subject' && !empty($row['subject_id'])) {
            $subjectColumns = table_columns('subjects');
            $subjectData = array();
            if (in_array('start_date', $subjectColumns, true)) {
                $subjectData['start_date'] = null;
            }
            if (in_array('start_time', $subjectColumns, true)) {
                $subjectData['start_time'] = null;
            }
            if (in_array('end_time', $subjectColumns, true)) {
                $subjectData['end_time'] = null;
            }
            if (in_array('updated_at', $subjectColumns, true)) {
                $subjectData['updated_at'] = date('Y-m-d H:i:s');
            }
            if ($subjectData) {
                db_update('subjects', $subjectData, 'id = ' . (int) $row['subject_id']);
            }
        }

        $conn = db_conn();
        mysqli_query($conn, 'DELETE FROM study_calendar_events WHERE id = ' . $eventId);
        json_response(array('success' => true));
    }

    if (table_has_column('calendar_notes', 'id')) {
        $row = db_fetch_one('SELECT * FROM calendar_notes WHERE id = ' . $eventId);
        if (!$row) {
            json_response(array('message' => 'Event not found'), 404);
        }
        if (isset($row['user_id']) && (int) $row['user_id'] !== (int) $user['id']) {
            json_response(array('message' => 'Unauthorized'), 403);
        }
        $conn = db_conn();
        mysqli_query($conn, 'DELETE FROM calendar_notes WHERE id = ' . $eventId);
        json_response(array('success' => true));
    }

    json_response(array('message' => 'Event not found'), 404);
}

function handle_calendar_events_delete_by_payload()
{
    $body = read_json_body();
    $eventId = 0;
    if (isset($body['id'])) {
        $eventId = (int) $body['id'];
    } elseif (isset($_POST['id'])) {
        $eventId = (int) $_POST['id'];
    }

    if ($eventId <= 0) {
        json_response(array('message' => 'Event not found'), 404);
    }

    handle_calendar_events_delete($eventId);
}

function notifications_table_name()
{
    if (table_exists('learning_notifications')) {
        return 'learning_notifications';
    }
    if (table_exists('study_notifications')) {
        return 'study_notifications';
    }
    return null;
}

function notifications_table_is_learning($table)
{
    return $table === 'learning_notifications';
}

function normalize_time_value($value, $fallback)
{
    $value = trim((string) $value);
    $value = str_replace('.', ':', $value);
    if (preg_match('/^\d{2}:\d{2}$/', $value)) {
        return $value . ':00';
    }
    if (preg_match('/^\d{2}:\d{2}:\d{2}$/', $value)) {
        return $value;
    }
    return $fallback;
}

function normalize_date_value($value)
{
    $value = trim((string) $value);
    if ($value === '') {
        return null;
    }
    $ts = strtotime($value);
    if ($ts === false) {
        return null;
    }
    return date('Y-m-d', $ts);
}

function notification_settings_get($userId)
{
    $defaults = array(
        'send_time' => '20:00:00',
        'timezone' => 'Asia/Bangkok',
        'email_enabled' => true,
        'email_address' => null,
    );

    if (!table_exists('notification_email_settings')) {
        return $defaults;
    }

    $row = db_fetch_one('SELECT * FROM notification_email_settings WHERE user_id = ' . (int) $userId);
    if (!$row) {
        return $defaults;
    }

    $sendTime = isset($row['send_time']) ? $row['send_time'] : $defaults['send_time'];
    return array(
        'send_time' => normalize_time_value($sendTime, $defaults['send_time']),
        'timezone' => isset($row['timezone']) ? $row['timezone'] : $defaults['timezone'],
        'email_enabled' => isset($row['email_enabled']) ? (bool) $row['email_enabled'] : $defaults['email_enabled'],
        'email_address' => isset($row['email_address']) ? $row['email_address'] : null,
    );
}

function notification_settings_update($userId, $payload)
{
    $settings = notification_settings_get($userId);
    $sendTime = normalize_time_value(isset($payload['send_time']) ? $payload['send_time'] : '', $settings['send_time']);
    $timezone = isset($payload['timezone']) ? $payload['timezone'] : $settings['timezone'];
    $emailEnabled = isset($payload['email_enabled']) ? (bool) $payload['email_enabled'] : $settings['email_enabled'];
    $emailAddress = isset($payload['email_address']) ? $payload['email_address'] : $settings['email_address'];

    if (!table_exists('notification_email_settings')) {
        return array(
            'send_time' => $sendTime,
            'timezone' => $timezone,
            'email_enabled' => $emailEnabled,
            'email_address' => $emailAddress,
        );
    }

    $columns = table_columns('notification_email_settings');
    $now = date('Y-m-d H:i:s');
    $existing = db_fetch_one('SELECT * FROM notification_email_settings WHERE user_id = ' . (int) $userId);

    $data = array();
    if (!$existing && in_array('id', $columns, true)) {
        $data['id'] = next_id_for('notification_email_settings');
    }
    if (in_array('user_id', $columns, true)) {
        $data['user_id'] = (int) $userId;
    }
    if (in_array('email_enabled', $columns, true)) {
        $data['email_enabled'] = $emailEnabled ? 1 : 0;
    }
    if (in_array('email_address', $columns, true)) {
        $data['email_address'] = $emailAddress;
    }
    if (in_array('digest_type', $columns, true)) {
        $data['digest_type'] = $existing && isset($existing['digest_type']) ? $existing['digest_type'] : 'daily';
    }
    if (in_array('days_ahead', $columns, true)) {
        $data['days_ahead'] = $existing && isset($existing['days_ahead']) ? $existing['days_ahead'] : 1;
    }
    if (in_array('send_time', $columns, true)) {
        $data['send_time'] = $sendTime;
    }
    if (in_array('timezone', $columns, true)) {
        $data['timezone'] = $timezone;
    }
    if (in_array('updated_at', $columns, true)) {
        $data['updated_at'] = $now;
    }
    if (!$existing && in_array('created_at', $columns, true)) {
        $data['created_at'] = $now;
    }

    if ($existing) {
        db_update('notification_email_settings', $data, 'user_id = ' . (int) $userId);
    } else {
        db_insert('notification_email_settings', $data);
    }

    return array(
        'send_time' => $sendTime,
        'timezone' => $timezone,
        'email_enabled' => $emailEnabled,
        'email_address' => $emailAddress,
    );
}

function notification_is_read($row)
{
    if (isset($row['is_read'])) {
        return (bool) $row['is_read'];
    }
    $meta = parse_event_metadata(isset($row['metadata']) ? $row['metadata'] : null);
    if (isset($meta['is_read'])) {
        return (bool) $meta['is_read'];
    }
    if (isset($row['status']) && $row['status'] !== 'pending') {
        return true;
    }
    return false;
}

function notification_row_to_payload($row, $table)
{
    $meta = parse_event_metadata(isset($row['metadata']) ? $row['metadata'] : null);
    $message = isset($row['message']) ? $row['message'] : (isset($row['body']) ? $row['body'] : null);
    $notifyAt = isset($row['notify_at']) ? normalize_datetime_for_output($row['notify_at']) : null;
    $type = isset($row['type']) ? $row['type'] : (isset($meta['type']) ? $meta['type'] : 'schedule');

    return array(
        'id' => isset($row['id']) ? (int) $row['id'] : null,
        'title' => isset($row['title']) ? $row['title'] : '',
        'message' => $message,
        'notify_at' => $notifyAt,
        'is_read' => notification_is_read($row),
        'type' => $type,
    );
}

function fetch_notifications($userId)
{
    $table = notifications_table_name();
    if (!$table) {
        return array();
    }
    $rows = db_fetch_all('SELECT * FROM ' . $table . ' WHERE user_id = ' . (int) $userId . ' ORDER BY notify_at DESC');
    $items = array();
    foreach ($rows as $row) {
        $items[] = notification_row_to_payload($row, $table);
    }
    return $items;
}

function update_notification_read($userId, $notificationId)
{
    $table = notifications_table_name();
    if (!$table) {
        return false;
    }
    $row = db_fetch_one('SELECT * FROM ' . $table . ' WHERE id = ' . (int) $notificationId . ' AND user_id = ' . (int) $userId);
    if (!$row) {
        return false;
    }
    $data = array();
    if (table_has_column($table, 'is_read')) {
        $data['is_read'] = 1;
    } elseif (table_has_column($table, 'metadata')) {
        $meta = parse_event_metadata(isset($row['metadata']) ? $row['metadata'] : null);
        $meta['is_read'] = true;
        $data['metadata'] = json_encode($meta);
    }
    if (table_has_column($table, 'updated_at')) {
        $data['updated_at'] = date('Y-m-d H:i:s');
    }
    if ($data) {
        db_update($table, $data, 'id = ' . (int) $notificationId);
    }
    return true;
}

function update_notification_time($userId, $notificationId, $notifyDate, $notifyTime)
{
    $table = notifications_table_name();
    if (!$table) {
        return false;
    }
    $row = db_fetch_one('SELECT * FROM ' . $table . ' WHERE id = ' . (int) $notificationId . ' AND user_id = ' . (int) $userId);
    if (!$row) {
        return false;
    }
    $currentDate = isset($row['notify_at']) ? date('Y-m-d', strtotime($row['notify_at'])) : date('Y-m-d');
    $dateValue = $notifyDate ? $notifyDate : $currentDate;
    $timeValue = $notifyTime ? $notifyTime : date('H:i', strtotime($row['notify_at']));
    $newNotifyAt = normalize_datetime_for_db($dateValue . ' ' . $timeValue);
    if (!$newNotifyAt) {
        return false;
    }
    $data = array(
        'notify_at' => $newNotifyAt,
    );
    if (table_has_column($table, 'status')) {
        $data['status'] = 'pending';
    }
    if (table_has_column($table, 'updated_at')) {
        $data['updated_at'] = date('Y-m-d H:i:s');
    }
    db_update($table, $data, 'id = ' . (int) $notificationId);
    return true;
}

function delete_notification($userId, $notificationId)
{
    $table = notifications_table_name();
    if (!$table) {
        return false;
    }
    $conn = db_conn();
    mysqli_query($conn, 'DELETE FROM ' . $table . ' WHERE id = ' . (int) $notificationId . ' AND user_id = ' . (int) $userId);
    return true;
}

function build_notification_message($events)
{
    if (!$events) {
        return '';
    }
    $lines = array();
    foreach ($events as $event) {
        $subjectName = null;
        if (isset($event['subject']) && is_array($event['subject'])) {
            $subjectName = isset($event['subject']['name']) ? $event['subject']['name'] : null;
        }
        $label = $subjectName ? $subjectName : (isset($event['title']) ? $event['title'] : 'กิจกรรม');
        $timeLabel = 'ทั้งวัน';
        if (isset($event['all_day']) && $event['all_day']) {
            $timeLabel = 'ทั้งวัน';
        } elseif (!empty($event['start_time'])) {
            $start = date('H:i', strtotime($event['start_time']));
            $timeLabel = $start;
            if (!empty($event['end_time'])) {
                $end = date('H:i', strtotime($event['end_time']));
                $timeLabel = $start . ' - ' . $end;
            }
        }
        $lines[] = '- ' . $label . ' (' . $timeLabel . ')';
    }
    return implode("\n", $lines);
}

function build_notification_title($date)
{
    return 'แจ้งเตือนการเรียน ' . $date;
}

function thai_day_name($date)
{
    $dayMap = array(
        'Monday' => 'จันทร์',
        'Tuesday' => 'อังคาร',
        'Wednesday' => 'พุธ',
        'Thursday' => 'พฤหัสบดี',
        'Friday' => 'ศุกร์',
        'Saturday' => 'เสาร์',
        'Sunday' => 'อาทิตย์',
    );
    $ts = strtotime($date);
    if ($ts === false) {
        return '';
    }
    $dayNameEn = date('l', $ts);
    return isset($dayMap[$dayNameEn]) ? $dayMap[$dayNameEn] : $dayNameEn;
}

function format_schedule_event_label($event)
{
    $subjectName = null;
    if (isset($event['subject']) && is_array($event['subject'])) {
        $subjectName = isset($event['subject']['name']) ? $event['subject']['name'] : null;
    }
    $label = $subjectName ? $subjectName : (isset($event['title']) ? $event['title'] : 'กิจกรรม');
    $allDay = isset($event['all_day']) ? (bool) $event['all_day'] : false;
    if ($allDay) {
        return $label;
    }
    $start = isset($event['start_time']) ? $event['start_time'] : null;
    $end = isset($event['end_time']) ? $event['end_time'] : null;
    if (!$start && !$end) {
        return $label;
    }
    $startLabel = $start ? date('H:i', strtotime($start)) : '';
    $endLabel = $end ? date('H:i', strtotime($end)) : '';
    $timeLabel = $endLabel ? ($startLabel ? $startLabel . '-' . $endLabel : $endLabel) : $startLabel;
    return $timeLabel ? $label . ' เวลา ' . $timeLabel : $label;
}

function build_range_notification_message($eventsByDate, $startDate, $days)
{
    $lines = array();
    for ($i = 0; $i < $days; $i++) {
        $date = date('Y-m-d', strtotime($startDate . ' +' . $i . ' day'));
        $dayName = thai_day_name($date);
        $label = $i === 0 ? 'พรุ่งนี้' : date('d M', strtotime($date));
        $events = isset($eventsByDate[$date]) ? $eventsByDate[$date] : array();
        if (!$events) {
            $lines[] = $label . ' (' . $dayName . ') ว่าง';
            continue;
        }
        $parts = array();
        foreach ($events as $event) {
            $parts[] = format_schedule_event_label($event);
        }
        $lines[] = $label . ' (' . $dayName . '): ' . implode('; ', $parts);
    }
    return implode(' | ', $lines);
}

function create_notification_record($userId, $subjectId, $title, $message, $notifyAt, $type = null, $channel = null, $status = null, $metadata = null)
{
    $table = notifications_table_name();
    if (!$table) {
        return null;
    }
    $columns = table_columns($table);
    $now = date('Y-m-d H:i:s');
    $data = array();
    if (in_array('id', $columns, true)) {
        $data['id'] = next_id_for($table);
    }
    if (in_array('user_id', $columns, true)) {
        $data['user_id'] = (int) $userId;
    }
    if (in_array('subject_id', $columns, true)) {
        $data['subject_id'] = $subjectId ? (int) $subjectId : null;
    }
    if (in_array('study_log_id', $columns, true)) {
        $data['study_log_id'] = null;
    }
    if (in_array('calendar_event_id', $columns, true)) {
        $data['calendar_event_id'] = null;
    }
    $resolvedType = $type ? $type : 'schedule';
    if (in_array('type', $columns, true)) {
        $data['type'] = $resolvedType;
    }
    if (in_array('title', $columns, true)) {
        $data['title'] = $title;
    }
    if (in_array('message', $columns, true)) {
        $data['message'] = $message;
    }
    if (in_array('body', $columns, true)) {
        $data['body'] = $message;
    }
    if (in_array('notify_at', $columns, true)) {
        $data['notify_at'] = $notifyAt;
    }
    if (in_array('is_read', $columns, true)) {
        $data['is_read'] = 0;
    }
    if (in_array('channel', $columns, true)) {
        $data['channel'] = $channel ? $channel : 'email';
    }
    if (in_array('status', $columns, true)) {
        $data['status'] = $status ? $status : 'pending';
    }
    if (in_array('metadata', $columns, true)) {
        $meta = is_array($metadata) ? $metadata : array();
        if (!isset($meta['type'])) {
            $meta['type'] = $resolvedType;
        }
        if (!isset($meta['is_read'])) {
            $meta['is_read'] = false;
        }
        $data['metadata'] = json_encode($meta);
    }
    if (in_array('created_at', $columns, true)) {
        $data['created_at'] = $now;
    }
    if (in_array('updated_at', $columns, true)) {
        $data['updated_at'] = $now;
    }

    $newId = db_insert($table, $data);
    if (!$newId) {
        return null;
    }
    $row = db_fetch_one('SELECT * FROM ' . $table . ' WHERE id = ' . (int) $newId);
    return $row ? notification_row_to_payload($row, $table) : null;
}

function collect_events_for_range($userId, $startDate, $endDate, $subjectId)
{
    $events = load_calendar_events($userId);
    $filtered = array();
    foreach ($events as $event) {
        if (!empty($subjectId) && isset($event['subject_id']) && (int) $event['subject_id'] !== (int) $subjectId) {
            continue;
        }
        $start = isset($event['start_time']) ? $event['start_time'] : null;
        if (!$start) {
            continue;
        }
        $date = date('Y-m-d', strtotime($start));
        if ($date < $startDate || $date > $endDate) {
            continue;
        }
        if (!isset($filtered[$date])) {
            $filtered[$date] = array();
        }
        $filtered[$date][] = $event;
    }
    return $filtered;
}

function collect_events_for_date($userId, $date, $subjectId)
{
    $dateValue = normalize_date_value($date);
    if (!$dateValue) {
        return array();
    }
    $eventsByDate = collect_events_for_range($userId, $dateValue, $dateValue, $subjectId);
    return isset($eventsByDate[$dateValue]) ? $eventsByDate[$dateValue] : array();
}

function gmail_client_id()
{
    return env_value('GOOGLE_CLIENT_ID');
}

function gmail_client_secret()
{
    return env_value('GOOGLE_CLIENT_SECRET');
}

function gmail_redirect_uri()
{
    $uri = env_value('GOOGLE_REDIRECT_URI');
    if ($uri) {
        return $uri;
    }
    $frontend = env_value('FRONTEND_URL');
    return $frontend ? rtrim($frontend, '/') . '/notifications' : null;
}

function gmail_state_token($userId)
{
    return jwt_encode(array(
        'user_id' => (int) $userId,
        'exp' => time() + 600,
    ));
}

function gmail_parse_state($state)
{
    return jwt_decode($state);
}

function gmail_authorize_url($userId)
{
    $clientId = gmail_client_id();
    $redirectUri = gmail_redirect_uri();
    if (!$clientId || !$redirectUri) {
        json_response(array('message' => 'Google OAuth config is missing.'), 422);
    }
    $state = gmail_state_token($userId);
    $params = array(
        'client_id' => $clientId,
        'redirect_uri' => $redirectUri,
        'response_type' => 'code',
        'access_type' => 'offline',
        'prompt' => 'consent',
        'include_granted_scopes' => 'true',
        'scope' => 'https://www.googleapis.com/auth/gmail.send openid email',
        'state' => $state,
    );
    return 'https://accounts.google.com/o/oauth2/v2/auth?' . http_build_query($params);
}

function http_post_form($url, $data)
{
    $body = http_build_query($data, '', '&');
    $responseBody = null;
    $status = 0;
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, array('Content-Type: application/x-www-form-urlencoded'));
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        curl_setopt($ch, CURLOPT_TIMEOUT, 30);
        $responseBody = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        if ($responseBody === false) {
            $error = curl_error($ch);
            curl_close($ch);
            return array('error' => $error ? $error : 'Request failed', 'status' => 0);
        }
        curl_close($ch);
    } else {
        $context = stream_context_create(array(
            'http' => array(
                'method' => 'POST',
                'header' => "Content-Type: application/x-www-form-urlencoded\r\n",
                'content' => $body,
                'timeout' => 30,
            ),
        ));
        $responseBody = @file_get_contents($url, false, $context);
        if (isset($http_response_header[0]) && preg_match('#HTTP/\d+\.\d+\s+(\d+)#', $http_response_header[0], $matches)) {
            $status = (int) $matches[1];
        }
    }
    return array('status' => $status, 'body' => $responseBody);
}

function http_get_json($url, $headers)
{
    $responseBody = null;
    $status = 0;
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch, CURLOPT_TIMEOUT, 30);
        $responseBody = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
    } else {
        $context = stream_context_create(array(
            'http' => array(
                'method' => 'GET',
                'header' => implode("\r\n", $headers) . "\r\n",
                'timeout' => 30,
            ),
        ));
        $responseBody = @file_get_contents($url, false, $context);
        if (isset($http_response_header[0]) && preg_match('#HTTP/\d+\.\d+\s+(\d+)#', $http_response_header[0], $matches)) {
            $status = (int) $matches[1];
        }
    }
    return array('status' => $status, 'body' => $responseBody);
}

function http_post_json($url, $payload, $headers)
{
    $body = json_encode($payload);
    $responseBody = null;
    $status = 0;
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        curl_setopt($ch, CURLOPT_TIMEOUT, 30);
        $responseBody = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
    } else {
        $context = stream_context_create(array(
            'http' => array(
                'method' => 'POST',
                'header' => implode("\r\n", $headers) . "\r\n",
                'content' => $body,
                'timeout' => 30,
            ),
        ));
        $responseBody = @file_get_contents($url, false, $context);
        if (isset($http_response_header[0]) && preg_match('#HTTP/\d+\.\d+\s+(\d+)#', $http_response_header[0], $matches)) {
            $status = (int) $matches[1];
        }
    }
    return array('status' => $status, 'body' => $responseBody);
}

function gmail_fetch_token_with_code($code)
{
    $clientId = gmail_client_id();
    $clientSecret = gmail_client_secret();
    $redirectUri = gmail_redirect_uri();
    if (!$clientId || !$clientSecret || !$redirectUri) {
        json_response(array('message' => 'Google OAuth config is missing.'), 422);
    }
    $response = http_post_form('https://oauth2.googleapis.com/token', array(
        'code' => $code,
        'client_id' => $clientId,
        'client_secret' => $clientSecret,
        'redirect_uri' => $redirectUri,
        'grant_type' => 'authorization_code',
    ));
    if (!$response['body'] || $response['status'] < 200 || $response['status'] >= 300) {
        return null;
    }
    $decoded = json_decode($response['body'], true);
    return is_array($decoded) ? $decoded : null;
}

function gmail_refresh_access_token($refreshToken)
{
    $clientId = gmail_client_id();
    $clientSecret = gmail_client_secret();
    if (!$clientId || !$clientSecret || !$refreshToken) {
        return null;
    }
    $response = http_post_form('https://oauth2.googleapis.com/token', array(
        'client_id' => $clientId,
        'client_secret' => $clientSecret,
        'refresh_token' => $refreshToken,
        'grant_type' => 'refresh_token',
    ));
    if (!$response['body'] || $response['status'] < 200 || $response['status'] >= 300) {
        return null;
    }
    $decoded = json_decode($response['body'], true);
    return is_array($decoded) ? $decoded : null;
}

function gmail_fetch_userinfo($accessToken)
{
    if (!$accessToken) {
        return null;
    }
    $response = http_get_json('https://openidconnect.googleapis.com/v1/userinfo', array(
        'Authorization: Bearer ' . $accessToken,
    ));
    if (!$response['body'] || $response['status'] < 200 || $response['status'] >= 300) {
        return null;
    }
    $decoded = json_decode($response['body'], true);
    return is_array($decoded) ? $decoded : null;
}

function gmail_account_row($userId)
{
    if (!table_exists('email_provider_accounts')) {
        return null;
    }
    return db_fetch_one("SELECT * FROM email_provider_accounts WHERE user_id = " . (int) $userId . " AND provider = 'gmail' AND auth_type = 'oauth' ORDER BY id DESC");
}

function gmail_store_account($userId, $token, $email)
{
    if (!table_exists('email_provider_accounts')) {
        return;
    }
    $columns = table_columns('email_provider_accounts');
    $now = date('Y-m-d H:i:s');
    $expiresAt = null;
    if (isset($token['expires_in'])) {
        $expiresAt = date('Y-m-d H:i:s', time() + (int) $token['expires_in']);
    }
    $scopes = isset($token['scope']) ? explode(' ', (string) $token['scope']) : array();

    $existing = gmail_account_row($userId);
    $data = array();
    if (!$existing && in_array('id', $columns, true)) {
        $data['id'] = next_id_for('email_provider_accounts');
    }
    if (in_array('user_id', $columns, true)) {
        $data['user_id'] = (int) $userId;
    }
    if (in_array('provider', $columns, true)) {
        $data['provider'] = 'gmail';
    }
    if (in_array('auth_type', $columns, true)) {
        $data['auth_type'] = 'oauth';
    }
    if (in_array('provider_email', $columns, true)) {
        $data['provider_email'] = $email;
    }
    if (in_array('access_token', $columns, true)) {
        $data['access_token'] = json_encode($token);
    }
    if (in_array('refresh_token', $columns, true) && isset($token['refresh_token'])) {
        $data['refresh_token'] = $token['refresh_token'];
    }
    if (in_array('token_expires_at', $columns, true)) {
        $data['token_expires_at'] = $expiresAt;
    }
    if (in_array('scopes', $columns, true)) {
        $data['scopes'] = json_encode($scopes);
    }
    if (in_array('status', $columns, true)) {
        $data['status'] = 'active';
    }
    if (in_array('last_error', $columns, true)) {
        $data['last_error'] = null;
    }
    if (in_array('updated_at', $columns, true)) {
        $data['updated_at'] = $now;
    }
    if (!$existing && in_array('created_at', $columns, true)) {
        $data['created_at'] = $now;
    }

    if ($existing) {
        db_update('email_provider_accounts', $data, 'id = ' . (int) $existing['id']);
    } else {
        db_insert('email_provider_accounts', $data);
    }
}

function gmail_access_token_from_account($account)
{
    if (!$account) {
        return null;
    }
    $tokenRaw = isset($account['access_token']) ? $account['access_token'] : null;
    $token = null;
    if ($tokenRaw) {
        $decoded = json_decode($tokenRaw, true);
        if (is_array($decoded)) {
            $token = $decoded;
        }
    }
    $accessToken = null;
    if ($token && isset($token['access_token'])) {
        $accessToken = $token['access_token'];
    } elseif (is_string($tokenRaw)) {
        $accessToken = $tokenRaw;
    }

    $expiresAt = isset($account['token_expires_at']) ? $account['token_expires_at'] : null;
    $refreshToken = isset($account['refresh_token']) ? $account['refresh_token'] : null;
    if ($expiresAt && strtotime($expiresAt) <= time() && $refreshToken) {
        $refreshed = gmail_refresh_access_token($refreshToken);
        if ($refreshed && isset($refreshed['access_token'])) {
            $accessToken = $refreshed['access_token'];
            $token = $refreshed;
            gmail_store_account((int) $account['user_id'], $token, isset($account['provider_email']) ? $account['provider_email'] : null);
        }
    }

    return $accessToken;
}

function gmail_send_message($accessToken, $toEmail, $subject, $body)
{
    if (!$accessToken) {
        return array('success' => false, 'message' => 'Missing access token');
    }
    $raw = "To: {$toEmail}\r\n";
    $raw .= "Subject: {$subject}\r\n";
    $raw .= "Content-Type: text/plain; charset=UTF-8\r\n\r\n";
    $raw .= $body;
    $payload = array(
        'raw' => base64url_encode($raw),
    );
    $response = http_post_json(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        $payload,
        array(
            'Authorization: Bearer ' . $accessToken,
            'Content-Type: application/json',
        )
    );
    if (!$response['body'] || $response['status'] < 200 || $response['status'] >= 300) {
        return array('success' => false, 'message' => 'Gmail send failed');
    }
    $decoded = json_decode($response['body'], true);
    if (!is_array($decoded)) {
        return array('success' => true, 'message' => null);
    }
    return array('success' => true, 'message_id' => isset($decoded['id']) ? $decoded['id'] : null);
}

function send_due_notifications($user, $settings)
{
    $table = notifications_table_name();
    if (!$table || !notifications_table_is_learning($table)) {
        return;
    }
    if (!$settings['email_enabled']) {
        return;
    }
    $account = gmail_account_row($user['id']);
    if (!$account || (isset($account['status']) && $account['status'] !== 'active')) {
        return;
    }
    $accessToken = gmail_access_token_from_account($account);
    if (!$accessToken) {
        return;
    }
    $toEmail = isset($account['provider_email']) && $account['provider_email'] ? $account['provider_email'] : $user['email'];
    if (!$toEmail) {
        return;
    }

    $now = date('Y-m-d H:i:s');
    $rows = db_fetch_all("SELECT * FROM {$table} WHERE user_id = " . (int) $user['id'] . " AND status = 'pending' AND notify_at <= " . db_escape($now));
    foreach ($rows as $row) {
        $subject = isset($row['title']) ? $row['title'] : 'Study Notification';
        $body = isset($row['body']) ? $row['body'] : (isset($row['message']) ? $row['message'] : '');
        $result = gmail_send_message($accessToken, $toEmail, $subject, $body);
        $data = array(
            'updated_at' => $now,
        );
        if ($result['success']) {
            $data['status'] = 'sent';
            $data['delivered_at'] = $now;
        } else {
            $data['status'] = 'failed';
        }
        db_update($table, $data, 'id = ' . (int) $row['id']);
    }
}

function handle_dashboard_overview()
{
    $user = require_auth_user();
    $userId = (int) $user['id'];

    $subjectsScoped = table_exists('subjects') && table_has_column('subjects', 'user_id');

    $subjectCount = 0;
    if ($subjectsScoped) {
        $row = db_fetch_one('SELECT COUNT(*) AS total FROM subjects WHERE user_id = ' . $userId);
        $subjectCount = $row && isset($row['total']) ? (int) $row['total'] : 0;
    }

    $studyLogCount = 0;
    if ($subjectsScoped && table_exists('study_logs')) {
        $sql = 'SELECT COUNT(*) AS total FROM study_logs JOIN subjects ON study_logs.subject_id = subjects.id';
        $sql .= ' WHERE subjects.user_id = ' . $userId;
        $row = db_fetch_one($sql);
        $studyLogCount = $row && isset($row['total']) ? (int) $row['total'] : 0;
    }

    $quizCount = 0;
    if ($subjectsScoped && table_exists('quizzes')) {
        $sql = 'SELECT COUNT(*) AS total FROM quizzes JOIN subjects ON quizzes.subject_id = subjects.id';
        $sql .= ' WHERE subjects.user_id = ' . $userId;
        $row = db_fetch_one($sql);
        $quizCount = $row && isset($row['total']) ? (int) $row['total'] : 0;
    }

    $quizAttemptCount = 0;
    if (table_exists('quiz_attempts')) {
        if (table_has_column('quiz_attempts', 'user_id')) {
            $row = db_fetch_one('SELECT COUNT(*) AS total FROM quiz_attempts WHERE user_id = ' . $userId);
            $quizAttemptCount = $row && isset($row['total']) ? (int) $row['total'] : 0;
        } elseif ($subjectsScoped && table_exists('quizzes')) {
            $sql = 'SELECT COUNT(*) AS total FROM quiz_attempts JOIN quizzes ON quiz_attempts.quiz_id = quizzes.id JOIN subjects ON quizzes.subject_id = subjects.id';
            $sql .= ' WHERE subjects.user_id = ' . $userId;
            $row = db_fetch_one($sql);
            $quizAttemptCount = $row && isset($row['total']) ? (int) $row['total'] : 0;
        }
    }

    $stats = array(
        'subjects' => $subjectCount,
        'study_logs' => $studyLogCount,
        'quizzes' => $quizCount,
        'quiz_attempts' => $quizAttemptCount
    );
    json_response($stats);
}

function handle_dashboard_progress()
{
    require_auth_user();
    json_response(array(
        'study_trend' => array(),
        'quiz_trend' => array()
    ));
}

function handle_notifications_list()
{
    $user = require_auth_user();
    $settings = notification_settings_get($user['id']);
    send_due_notifications($user, $settings);
    $items = fetch_notifications($user['id']);
    json_response($items);
}

function handle_notifications_create()
{
    $user = require_auth_user();
    $body = read_json_body();

    $subjectId = isset($body['subject_id']) && $body['subject_id'] !== null ? (int) $body['subject_id'] : null;
    if (!$subjectId) {
        json_response(array('message' => 'กรุณาเลือกวิชา'), 422);
    }

    $subject = fetch_subject_for_user($subjectId, $user);
    $subjectName = subject_display_name($subject);

    $notifyAtRaw = isset($body['notify_at']) ? (string) $body['notify_at'] : '';
    $notifyAt = normalize_datetime_for_db($notifyAtRaw);
    if (!$notifyAt) {
        json_response(array('message' => 'กรุณาระบุวัน/เวลาแจ้งเตือนให้ถูกต้อง'), 422);
    }

    $title = isset($body['title']) && trim((string) $body['title']) !== ''
        ? trim((string) $body['title'])
        : ('แจ้งเตือนวิชา: ' . $subjectName);
    $message = isset($body['message']) && trim((string) $body['message']) !== ''
        ? trim((string) $body['message'])
        : ('ถึงเวลาเรียน "' . $subjectName . '" แล้ว');

    $type = isset($body['type']) && trim((string) $body['type']) !== '' ? trim((string) $body['type']) : 'subject_reminder';
    $channel = isset($body['channel']) && trim((string) $body['channel']) !== '' ? trim((string) $body['channel']) : 'email';

    $record = create_notification_record(
        $user['id'],
        $subjectId,
        $title,
        $message,
        $notifyAt,
        $type,
        $channel,
        'pending',
        array('type' => $type, 'is_read' => false)
    );

    if (!$record) {
        json_response(array('message' => 'สร้างแจ้งเตือนไม่สำเร็จ'), 500);
    }

    $settings = notification_settings_get($user['id']);
    if (strtotime($notifyAt) <= time()) {
        send_due_notifications($user, $settings);
    }

    json_response($record, 201);
}

function handle_notifications_settings()
{
    $user = require_auth_user();
    $method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET';
    if ($method === 'PUT') {
        $body = read_json_body();
        $updated = notification_settings_update($user['id'], $body);
        json_response(array(
            'send_time' => $updated['send_time'],
            'timezone' => $updated['timezone'],
            'email_enabled' => (bool) $updated['email_enabled'],
        ));
    }
    $settings = notification_settings_get($user['id']);
    json_response(array(
        'send_time' => $settings['send_time'],
        'timezone' => $settings['timezone'],
        'email_enabled' => (bool) $settings['email_enabled'],
    ));
}

function handle_notifications_schedule_range()
{
    $user = require_auth_user();
    $body = read_json_body();
    $days = isset($body['days']) ? (int) $body['days'] : 7;
    if ($days < 1) {
        $days = 1;
    }
    if ($days > 30) {
        $days = 30;
    }
    $subjectId = isset($body['subject_id']) && $body['subject_id'] !== null ? (int) $body['subject_id'] : null;
    $settings = notification_settings_get($user['id']);
    $notifyTime = normalize_time_value(isset($body['notify_time']) ? $body['notify_time'] : '', $settings['send_time']);

    $startDate = date('Y-m-d', strtotime('+1 day'));
    $endDate = date('Y-m-d', strtotime($startDate . ' +' . ($days - 1) . ' day'));
    $eventsByDate = collect_events_for_range($user['id'], $startDate, $endDate, $subjectId);
    $title = 'ตารางเรียน ' . $days . ' วันข้างหน้า';
    $message = build_range_notification_message($eventsByDate, $startDate, $days);
    $notifyAt = normalize_datetime_for_db(date('Y-m-d') . ' ' . $notifyTime);
    if (!$notifyAt) {
        json_response(array('message' => 'รูปแบบเวลาไม่ถูกต้อง'), 422);
    }

    $record = create_notification_record(
        $user['id'],
        $subjectId,
        $title,
        $message,
        $notifyAt,
        'schedule_range',
        'email',
        'pending',
        array('type' => 'schedule_range', 'is_read' => false)
    );

    if (!$record) {
        json_response(array('message' => 'สร้างแจ้งเตือนไม่สำเร็จ'), 500);
    }

    if (strtotime($notifyAt) <= time()) {
        send_due_notifications($user, $settings);
    }

    json_response($record, 201);
}

function handle_notifications_schedule_day()
{
    $user = require_auth_user();
    $body = read_json_body();
    $dateValue = normalize_date_value(isset($body['date']) ? $body['date'] : '');
    if (!$dateValue) {
        json_response(array('message' => 'กรุณาเลือกวันที่แจ้งเตือน'), 422);
    }

    $settings = notification_settings_get($user['id']);
    $notifyTime = normalize_time_value(isset($body['notify_time']) ? $body['notify_time'] : '', $settings['send_time']);
    $notifyAt = normalize_datetime_for_db($dateValue . ' ' . $notifyTime);
    if (!$notifyAt) {
        json_response(array('message' => 'รูปแบบเวลาไม่ถูกต้อง'), 422);
    }

    $events = collect_events_for_date($user['id'], $dateValue, null);
    $title = isset($body['title']) && trim((string) $body['title']) !== ''
        ? trim((string) $body['title'])
        : build_notification_title($dateValue);
    $message = build_notification_message($events);
    if ($message === '') {
        $message = $dateValue . ' ไม่มีตารางเรียน';
    }

    $record = create_notification_record(
        $user['id'],
        null,
        $title,
        $message,
        $notifyAt,
        'schedule_day',
        'email',
        'pending',
        array('type' => 'schedule_day', 'is_read' => false)
    );

    if ($record && strtotime($notifyAt) <= time()) {
        send_due_notifications($user, $settings);
    }

    if (!$record) {
        json_response(array('message' => 'สร้างแจ้งเตือนไม่สำเร็จ'), 500);
    }

    json_response($record, 201);
}

function handle_notifications_mark_read($notificationId)
{
    $user = require_auth_user();
    $ok = update_notification_read($user['id'], $notificationId);
    if (!$ok) {
        json_response(array('message' => 'Not found'), 404);
    }
    json_response(array('success' => true));
}

function handle_notifications_update_time($notificationId)
{
    $user = require_auth_user();
    $body = read_json_body();
    $notifyTime = isset($body['notify_time']) ? $body['notify_time'] : null;
    $notifyDate = isset($body['notify_date']) ? $body['notify_date'] : null;
    $ok = update_notification_time($user['id'], $notificationId, $notifyDate, $notifyTime);
    if (!$ok) {
        json_response(array('message' => 'Not found'), 404);
    }
    $table = notifications_table_name();
    $row = $table ? db_fetch_one('SELECT * FROM ' . $table . ' WHERE id = ' . (int) $notificationId) : null;
    json_response($row ? $row : array('success' => true));
}

function handle_notifications_delete($notificationId)
{
    $user = require_auth_user();
    delete_notification($user['id'], $notificationId);
    json_response(array('success' => true));
}

function handle_notifications_unread()
{
    $user = require_auth_user();
    $items = fetch_notifications($user['id']);
    $count = 0;
    foreach ($items as $item) {
        if (empty($item['is_read'])) {
            $count += 1;
        }
    }
    json_response(array('unread' => $count));
}

function handle_gmail_authorize()
{
    $user = require_auth_user();
    $url = gmail_authorize_url($user['id']);
    json_response(array('auth_url' => $url));
}

function handle_gmail_status()
{
    $user = require_auth_user();
    if (!table_exists('email_provider_accounts')) {
        json_response(array('connected' => false));
    }
    $account = gmail_account_row($user['id']);
    if (!$account) {
        json_response(array('connected' => false));
    }
    $status = isset($account['status']) ? $account['status'] : 'pending';
    json_response(array(
        'connected' => $status === 'active',
        'email' => isset($account['provider_email']) ? $account['provider_email'] : null,
        'status' => $status,
    ));
}

function handle_gmail_callback()
{
    if (isset($_GET['error']) && $_GET['error']) {
        json_response(array('message' => $_GET['error']), 400);
    }
    $code = isset($_GET['code']) ? $_GET['code'] : null;
    $state = isset($_GET['state']) ? $_GET['state'] : null;
    if (!$code || !$state) {
        json_response(array('message' => 'Missing authorization data.'), 422);
    }
    $payload = gmail_parse_state($state);
    if (!$payload || !isset($payload['user_id'])) {
        json_response(array('message' => 'Invalid state token.'), 422);
    }
    if (!table_exists('email_provider_accounts')) {
        json_response(array('message' => 'email_provider_accounts table is missing.'), 422);
    }
    $token = gmail_fetch_token_with_code($code);
    if (!$token || isset($token['error'])) {
        json_response(array('message' => 'Unable to fetch Gmail token.'), 400);
    }
    $accessToken = isset($token['access_token']) ? $token['access_token'] : null;
    $profile = gmail_fetch_userinfo($accessToken);
    $email = $profile && isset($profile['email']) ? $profile['email'] : null;
    gmail_store_account((int) $payload['user_id'], $token, $email);
    json_response(array(
        'message' => 'Gmail connected.',
        'email' => $email,
    ));
}

function handle_goals_summary()
{
    require_auth_user();
    $empty = array(
        'period_type' => 'daily',
        'period_start' => date('Y-m-d'),
        'period_end' => date('Y-m-d'),
        'total_sessions' => 0,
        'total_minutes' => 0,
        'subjects' => array(),
        'goal' => array(
            'target_sessions' => null,
            'target_minutes' => null,
            'status' => 'not_set',
            'achieved' => false
        )
    );
    $week = $empty;
    $week['period_type'] = 'weekly';
    $month = $empty;
    $month['period_type'] = 'monthly';
    json_response(array(
        'today' => $empty,
        'week' => $week,
        'month' => $month
    ));
}

function handle_ok()
{
    json_response(array('success' => true));
}

$method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET';
if ($method === 'POST' && isset($_POST['_method'])) {
    $override = strtoupper(trim((string) $_POST['_method']));
    if (in_array($override, array('DELETE', 'PUT', 'PATCH'), true)) {
        $method = $override;
    }
}
$path = get_request_path();

if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($path === '/api/auth/google' && $method === 'POST') {
    handle_google_login();
}

if ($path === '/api/auth/google-config' && $method === 'GET') {
    handle_google_config();
}

if ($path === '/api/auth/login' && $method === 'POST') {
    handle_password_login();
}

if ($path === '/api/auth/dev-login' && $method === 'POST') {
    handle_dev_login();
}

if ($path === '/api/auth/me' && $method === 'GET') {
    handle_auth_me();
}

if ($path === '/api/auth/logout' && $method === 'POST') {
    handle_ok();
}

if ($path === '/api/subjects' && $method === 'GET') {
    handle_subjects_get();
}

if ($path === '/api/subjects' && $method === 'POST') {
    handle_subjects_create();
}

if ($path === '/api/subjects/delete' && $method === 'POST') {
    handle_subject_delete_by_payload();
}

if (preg_match('#^/api/subjects/(\d+)$#', $path, $matches) && $method === 'GET') {
    handle_subject_get((int) $matches[1]);
}

if (preg_match('#^/api/subjects/(\d+)/delete$#', $path, $matches) && $method === 'POST') {
    handle_subject_delete((int) $matches[1]);
}

if (preg_match('#^/api/subjects/(\d+)$#', $path, $matches) && $method === 'DELETE') {
    handle_subject_delete((int) $matches[1]);
}

if (preg_match('#^/api/subjects/(\d+)$#', $path, $matches) && $method === 'POST') {
    handle_subject_delete((int) $matches[1]);
}

if (preg_match('#^/api/subjects/(\d+)$#', $path, $matches) && $method === 'PUT') {
    handle_subject_update((int) $matches[1]);
}

if (preg_match('#^/api/subjects/(\d+)/quizzes/from-file$#', $path, $matches) && $method === 'POST') {
    handle_subject_quizzes_from_file((int) $matches[1]);
}

if (preg_match('#^/api/subjects/(\d+)/quizzes$#', $path, $matches) && $method === 'GET') {
    handle_subject_quizzes_list((int) $matches[1]);
}

if (preg_match('#^/api/subjects/(\d+)/quizzes$#', $path, $matches) && $method === 'POST') {
    handle_subject_quizzes_create((int) $matches[1]);
}

if (preg_match('#^/api/quizzes/(\d+)$#', $path, $matches) && $method === 'GET') {
    handle_quiz_show((int) $matches[1]);
}

if (preg_match('#^/api/quizzes/(\d+)/attempts$#', $path, $matches) && $method === 'POST') {
    handle_quiz_attempts_submit((int) $matches[1]);
}

if (preg_match('#^/api/subjects/(\d+)/study-logs$#', $path, $matches) && $method === 'GET') {
    handle_study_logs_get((int) $matches[1]);
}

if (preg_match('#^/api/subjects/(\d+)/study-logs$#', $path, $matches) && $method === 'POST') {
    handle_study_logs_create((int) $matches[1]);
}

if (preg_match('#^/api/study-logs/(\d+)/files$#', $path, $matches) && $method === 'POST') {
    handle_file_upload((int) $matches[1]);
}

if (preg_match('#^/api/study-logs/(\d+)/summaries$#', $path, $matches) && $method === 'POST') {
    handle_summary_create((int) $matches[1]);
}

if ($path === '/api/ai/analyze/document' && $method === 'POST') {
    handle_ai_document_analyze();
}

if ($path === '/api/ai/summarize/document' && $method === 'POST') {
    handle_ai_document_summarize();
}

if ($path === '/api/calendar-events' && $method === 'GET') {
    handle_calendar_events_index();
}

if ($path === '/api/calendar-events' && $method === 'POST') {
    handle_calendar_events_store();
}

if (preg_match('#^/api/calendar-events/(\d+)$#', $path, $matches) && in_array($method, array('PUT', 'PATCH'), true)) {
    handle_calendar_events_update((int) $matches[1]);
}

if (preg_match('#^/api/calendar-events/(\d+)$#', $path, $matches) && in_array($method, array('DELETE', 'POST'), true)) {
    handle_calendar_events_delete((int) $matches[1]);
}

if (preg_match('#^/api/calendar-events/(\d+)/delete$#', $path, $matches) && $method === 'POST') {
    handle_calendar_events_delete((int) $matches[1]);
}

if ($path === '/api/calendar-events/delete' && $method === 'POST') {
    handle_calendar_events_delete_by_payload();
}

if ($path === '/api/dashboard/overview' && $method === 'GET') {
    handle_dashboard_overview();
}

if ($path === '/api/dashboard/progress' && $method === 'GET') {
    handle_dashboard_progress();
}

if ($path === '/api/notifications' && $method === 'GET') {
    handle_notifications_list();
}

if ($path === '/api/notifications' && $method === 'POST') {
    handle_notifications_create();
}

if ($path === '/api/notifications/unread' && $method === 'GET') {
    handle_notifications_unread();
}

if ($path === '/api/notifications/settings' && in_array($method, array('GET', 'PUT'), true)) {
    handle_notifications_settings();
}

if ($path === '/api/notifications/schedule' && $method === 'POST') {
    handle_notifications_schedule_day();
}

if ($path === '/api/notifications/schedule-range' && $method === 'POST') {
    handle_notifications_schedule_range();
}

if (preg_match('#^/api/notifications/(\d+)/read$#', $path, $matches) && $method === 'PATCH') {
    handle_notifications_mark_read((int) $matches[1]);
}

if (preg_match('#^/api/notifications/(\d+)/time$#', $path, $matches) && $method === 'PATCH') {
    handle_notifications_update_time((int) $matches[1]);
}

if (preg_match('#^/api/notifications/(\d+)$#', $path, $matches) && $method === 'DELETE') {
    handle_notifications_delete((int) $matches[1]);
}

if ($path === '/api/goals/summary' && $method === 'GET') {
    handle_goals_summary();
}

if ($path === '/api/gmail/authorize' && $method === 'GET') {
    handle_gmail_authorize();
}

if ($path === '/api/gmail/status' && $method === 'GET') {
    handle_gmail_status();
}

if ($path === '/api/gmail/callback' && $method === 'GET') {
    handle_gmail_callback();
}

if ($path === '/api/goals/targets' && $method === 'POST') {
    handle_ok();
}

json_response(array('message' => 'Not found'), 404);
