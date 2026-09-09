<?php
if (function_exists('session_status') && session_status() !== PHP_SESSION_ACTIVE) {
    $sessionPath = __DIR__ . DIRECTORY_SEPARATOR . '.sessions';
    if (!is_dir($sessionPath)) {
        @mkdir($sessionPath, 0777, true);
    }
    if (is_dir($sessionPath) && is_writable($sessionPath)) {
        @session_save_path($sessionPath);
    }
}
session_start();
date_default_timezone_set('Asia/Bangkok');
header('Content-Type: application/json; charset=utf-8');

if (!isset($_SESSION['user_id']) || !isset($_SESSION['role']) || $_SESSION['role'] !== 'admin') {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'Access denied']);
    exit();
}

function admin_db_connect()
{
    if (!function_exists('mysqli_connect')) {
        return null;
    }
    if (function_exists('mysqli_report')) {
        mysqli_report(MYSQLI_REPORT_OFF);
    }

    $defaults = [
        'host' => '127.0.0.1',
        'port' => '3306',
        'database' => 'db_651998018',
        'username' => 'root',
        'password' => '',
        'charset' => 'utf8',





    ];

    $envConfig = $defaults;
    $paths = array(
        __DIR__ . DIRECTORY_SEPARATOR . '.env',
        dirname(__DIR__) . DIRECTORY_SEPARATOR . '.env'
    );
    foreach ($paths as $path) {
        if (!file_exists($path)) {
            continue;
        }
        $parsed = parse_ini_file($path, false, INI_SCANNER_RAW);
        if ($parsed !== false) {
            $envConfig['host'] = isset($parsed['DB_HOST']) ? $parsed['DB_HOST'] : $defaults['host'];
            $envConfig['port'] = isset($parsed['DB_PORT']) ? $parsed['DB_PORT'] : $defaults['port'];
            $envConfig['database'] = isset($parsed['DB_DATABASE']) ? $parsed['DB_DATABASE'] : $defaults['database'];
            $envConfig['username'] = isset($parsed['DB_USERNAME']) ? $parsed['DB_USERNAME'] : $defaults['username'];
            $envConfig['password'] = isset($parsed['DB_PASSWORD']) ? $parsed['DB_PASSWORD'] : $defaults['password'];
            $envConfig['charset'] = isset($parsed['DB_CHARSET']) ? $parsed['DB_CHARSET'] : $defaults['charset'];
        }
        break;
    }

    $conn = @mysqli_connect(
        $envConfig['host'],
        $envConfig['username'],
        $envConfig['password'],
        $envConfig['database'],
        (int) $envConfig['port']
    );

    if (!$conn) {
        return null;
    }

    mysqli_set_charset($conn, $envConfig['charset']);

    return $conn;
}

function admin_bind_params($stmt, $types, $params)
{
    $refs = [];
    $refs[] = $stmt;
    $refs[] = &$types;
    foreach ($params as $index => $value) {
        $refs[] = &$params[$index];
    }
    call_user_func_array('mysqli_stmt_bind_param', $refs);
}

function admin_db_query($conn, $sql)
{
    try {
        return mysqli_query($conn, $sql);
    } catch (Throwable $error) {
        return false;
    }
}

function admin_table_exists($conn, $table)
{
    if (!$conn || $table === '') {
        return false;
    }
    $escaped = mysqli_real_escape_string($conn, $table);
    $result = admin_db_query($conn, "SHOW TABLES LIKE '{$escaped}'");
    if (!$result) {
        return false;
    }
    $exists = mysqli_num_rows($result) > 0;
    mysqli_free_result($result);
    return $exists;
}

function admin_column_exists($conn, $table, $column)
{
    if (!$conn || $table === '' || $column === '') {
        return false;
    }

    try {
        $tableEscaped = mysqli_real_escape_string($conn, $table);
        $columnEscaped = mysqli_real_escape_string($conn, $column);
        $result = mysqli_query($conn, "SHOW COLUMNS FROM `{$tableEscaped}` LIKE '{$columnEscaped}'");
        if (!$result) {
            return false;
        }
        $exists = mysqli_num_rows($result) > 0;
        mysqli_free_result($result);
        return $exists;
    } catch (Throwable $error) {
        return false;
    }
}

function admin_get_table_columns($conn, $table)
{
    if (!$conn || $table === '') {
        return [];
    }
    $columns = [];
    $tableEscaped = mysqli_real_escape_string($conn, $table);
    $result = mysqli_query($conn, "SHOW COLUMNS FROM `{$tableEscaped}`");
    if (!$result) {
        return [];
    }
    while ($row = mysqli_fetch_assoc($result)) {
        if (isset($row['Field'])) {
            $columns[] = (string) $row['Field'];
        }
    }
    mysqli_free_result($result);
    return $columns;
}

function admin_scalar($conn, $sql)
{
    $result = admin_db_query($conn, $sql);
    if (!$result) {
        return null;
    }
    $row = mysqli_fetch_row($result);
    mysqli_free_result($result);
    return $row !== null && isset($row[0]) ? $row[0] : null;
}

function admin_latest_activity_timestamp($conn)
{
    $sources = [
        ['users', ['created_at', 'updated_at']],
        ['subjects', ['created_at', 'updated_at']],
        ['schedules', ['created_at', 'updated_at']],
        ['study_logs', ['created_at', 'updated_at', 'log_date']],
        ['quizzes', ['created_at', 'updated_at']],
        ['quiz_attempts', ['created_at', 'updated_at']],
        ['learning_goal_targets', ['created_at', 'updated_at']],
        ['summaries', ['created_at', 'updated_at']],
        ['files', ['created_at', 'updated_at']],
        ['study_calendar_events', ['created_at', 'updated_at']],
    ];
    $timestamps = [];

    foreach ($sources as [$table, $columns]) {
        if (!admin_table_exists($conn, $table)) {
            continue;
        }
        $available = array_values(array_filter($columns, function ($column) use ($conn, $table) {
            return admin_column_exists($conn, $table, $column);
        }));
        if (count($available) === 0) {
            continue;
        }
        foreach ($available as $column) {
            $value = admin_scalar($conn, "SELECT MAX(NULLIF(`{$column}`, '')) FROM `{$table}`");
            if ($value !== null && trim((string) $value) !== '') {
                $timestamps[] = (string) $value;
            }
        }
    }

    $latest = 0;
    foreach ($timestamps as $value) {
        $timestamp = strtotime($value);
        if ($timestamp !== false && $timestamp > $latest) {
            $latest = $timestamp;
        }
    }
    return $latest;
}

function admin_summary($conn)
{
    if (!$conn) {
        return [
            'active_study_users' => 0,
            'quizzes' => 0,
            'latest_activity' => null,
        ];
    }

    $activeStudyUsers = 0;
    if (admin_table_exists($conn, 'study_logs') && admin_column_exists($conn, 'study_logs', 'user_id')) {
        $studyLogWhere = '`user_id` IS NOT NULL';
        if (admin_column_exists($conn, 'study_logs', 'note')) {
            $studyLogWhere .= " AND COALESCE(`note`, '') <> 'อัปโหลดไฟล์เพื่อสร้างแบบฝึกหัด'";
        }
        $activeStudyUsers = (int) (admin_scalar($conn, "SELECT COUNT(DISTINCT `user_id`) FROM `study_logs` WHERE {$studyLogWhere}") ?? 0);
    } elseif (
        admin_table_exists($conn, 'study_logs')
        && admin_column_exists($conn, 'study_logs', 'subject_id')
        && admin_table_exists($conn, 'subjects')
        && admin_column_exists($conn, 'subjects', 'user_id')
    ) {
        $activeStudyUsers = (int) (admin_scalar($conn, 'SELECT COUNT(DISTINCT subjects.user_id) FROM study_logs INNER JOIN subjects ON subjects.id = study_logs.subject_id') ?? 0);
    }

    $quizCount = admin_table_exists($conn, 'quizzes')
        ? (int) (admin_scalar($conn, 'SELECT COUNT(*) FROM `quizzes`') ?? 0)
        : 0;
    $latestTimestamp = admin_latest_activity_timestamp($conn);

    return [
        'active_study_users' => $activeStudyUsers,
        'quizzes' => $quizCount,
        'latest_activity' => $latestTimestamp > 0 ? date('d/m/Y H:i', $latestTimestamp) : null,
    ];
}

function admin_ensure_settings_table($conn)
{
    if (!$conn) {
        return false;
    }
    $sql = "CREATE TABLE IF NOT EXISTS `admin_settings` (
        `setting_key` VARCHAR(120) NOT NULL,
        `setting_value` TEXT NULL,
        `updated_at` DATETIME NULL,
        PRIMARY KEY (`setting_key`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci";
    return mysqli_query($conn, $sql) !== false;
}

function admin_settings_defaults()
{
    return [
        'system_name' => 'Smart Learning Tracker',
        'admin_welcome_message' => 'ยินดีต้อนรับผู้ดูแลระบบนะคะ',
        'contact_email' => '',
        'maintenance_mode' => '0',
        'maintenance_start_at' => '',
        'maintenance_end_at' => '',
    ];
}

function admin_current_admin_email($conn)
{
    if (isset($_SESSION['email']) && trim((string) $_SESSION['email']) !== '') {
        return trim((string) $_SESSION['email']);
    }
    if (!$conn || !isset($_SESSION['user_id'])) {
        return '';
    }
    $userId = (string) $_SESSION['user_id'];
    if ($userId === '') {
        return '';
    }
    $stmt = mysqli_prepare($conn, 'SELECT email FROM users WHERE id = ? LIMIT 1');
    if (!$stmt) {
        return '';
    }
    mysqli_stmt_bind_param($stmt, 's', $userId);
    mysqli_stmt_execute($stmt);
    $result = mysqli_stmt_get_result($stmt);
    $row = $result ? mysqli_fetch_assoc($result) : null;
    mysqli_stmt_close($stmt);
    if (!$row || !isset($row['email'])) {
        return '';
    }
    return trim((string) $row['email']);
}

$schema = [
    'users' => [
        'pk' => 'id',
        'columns' => ['name', 'email', 'password', 'profile_pic', 'education_level', 'provider', 'provider_id', 'role']
    ],
    'subjects' => [
        'pk' => 'id',
        'columns' => ['user_id', 'semester_id', 'name', 'description', 'color', 'target_hours', 'start_date', 'start_time', 'end_time']
    ],
    'schedules' => [
        'pk' => 'id',
        'columns' => ['user_id', 'subject_id', 'day_of_week', 'start_time', 'end_time', 'room', 'schedule_type']
    ],
    'learning_notifications' => [
        'pk' => 'id',
        'columns' => ['user_id', 'subject_id', 'study_log_id', 'calendar_event_id', 'title', 'body', 'notify_at', 'delivered_at', 'channel', 'status', 'metadata']
    ],
    'study_logs' => [
        'pk' => 'id',
        'columns' => ['user_id', 'subject_id', 'title', 'note', 'log_date', 'duration_minutes', 'mood']
    ],
    'quizzes' => [
        'pk' => 'id',
        'columns' => ['subject_id', 'title', 'description', 'ai_model', 'metadata']
    ],
];

$action = isset($_POST['action']) ? (string) $_POST['action'] : '';
$table = isset($_POST['table']) ? (string) $_POST['table'] : '';

if ($action === 'summary_get') {
    $conn = admin_db_connect();
    if (!$conn) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'เชื่อมต่อฐานข้อมูลไม่สำเร็จ']);
        exit();
    }
    echo json_encode(['ok' => true, 'summary' => admin_summary($conn)], JSON_UNESCAPED_UNICODE);
    exit();
}

if ($action === 'settings_get' || $action === 'settings_save') {
    $conn = admin_db_connect();
    if (!$conn) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'เชื่อมต่อฐานข้อมูลไม่สำเร็จ']);
        exit();
    }

    if (!admin_ensure_settings_table($conn)) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'ไม่สามารถเตรียมตารางตั้งค่าได้']);
        exit();
    }

    $allowedKeys = array_keys(admin_settings_defaults());

    if ($action === 'settings_save') {
        $fieldsRaw = isset($_POST['fields']) ? (string) $_POST['fields'] : '';
        $fields = json_decode($fieldsRaw, true);
        if (!is_array($fields)) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'ข้อมูลไม่ถูกต้อง']);
            exit();
        }

        $toSave = [];
        foreach ($allowedKeys as $key) {
            if (array_key_exists($key, $fields)) {
                $toSave[$key] = (string) $fields[$key];
            }
        }
        if (count($toSave) === 0) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'ไม่มีข้อมูลให้บันทึก']);
            exit();
        }

        $stmt = mysqli_prepare(
            $conn,
            "INSERT INTO `admin_settings` (`setting_key`, `setting_value`, `updated_at`) VALUES (?, ?, NOW())
            ON DUPLICATE KEY UPDATE `setting_value` = VALUES(`setting_value`), `updated_at` = NOW()"
        );
        if (!$stmt) {
            http_response_code(500);
            echo json_encode(['ok' => false, 'error' => 'ไม่สามารถบันทึกการตั้งค่าได้']);
            exit();
        }

        foreach ($toSave as $key => $value) {
            $params = [$key, $value];
            $types = 'ss';
            admin_bind_params($stmt, $types, $params);
            mysqli_stmt_execute($stmt);
        }
        mysqli_stmt_close($stmt);
    }

    $settings = admin_settings_defaults();
    $result = mysqli_query($conn, "SELECT `setting_key`, `setting_value` FROM `admin_settings`");
    if ($result) {
        while ($row = mysqli_fetch_assoc($result)) {
            $key = isset($row['setting_key']) ? (string) $row['setting_key'] : '';
            if ($key !== '' && array_key_exists($key, $settings)) {
                $settings[$key] = isset($row['setting_value']) ? (string) $row['setting_value'] : '';
            }
        }
        mysqli_free_result($result);
    }

    $loggedInEmail = admin_current_admin_email($conn);
    if (
        $loggedInEmail !== ''
        && (
            !isset($settings['contact_email'])
            || trim((string) $settings['contact_email']) === ''
            || strtolower(trim((string) $settings['contact_email'])) === 'admin@example.com'
        )
    ) {
        $settings['contact_email'] = $loggedInEmail;
    }

    echo json_encode(['ok' => true, 'settings' => $settings]);
    exit();
}

if ($action === '' || $table === '' || !isset($schema[$table])) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'ข้อมูลไม่ถูกต้อง']);
    exit();
}

if (in_array($action, ['create', 'update', 'delete'], true)) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'โหมดผู้ดูแลระบบเป็นแบบดู']);
    exit();
}

$conn = admin_db_connect();
if (!$conn) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'เชื่อมต่อฐานข้อมูลไม่สำเร็จ']);
    exit();
}

if ($table === 'subjects' && admin_column_exists($conn, 'subjects', 'semester_id')) {
    if (!in_array('semester_id', $schema['subjects']['columns'], true)) {
        $schema['subjects']['columns'][] = 'semester_id';
    }
}

$tableInfo = $schema[$table];
$pk = $tableInfo['pk'];
$allowed = $tableInfo['columns'];

$actualColumns = admin_get_table_columns($conn, $table);
if (count($actualColumns) > 0) {
    $allowed = array_values(array_intersect($allowed, $actualColumns));
}

if ($action === 'delete') {
    $id = isset($_POST['id']) ? (string) $_POST['id'] : '';
    if ($id === '') {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'ไม่พบรหัสรายการ']);
        exit();
    }

    $stmt = mysqli_prepare($conn, "DELETE FROM `{$table}` WHERE `{$pk}` = ? LIMIT 1");
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'ไม่สามารถลบข้อมูลได้']);
        exit();
    }
    $params = [$id];
    $types = 's';
    admin_bind_params($stmt, $types, $params);
    mysqli_stmt_execute($stmt);
    mysqli_stmt_close($stmt);
    echo json_encode(['ok' => true]);
    exit();
}

$fieldsRaw = isset($_POST['fields']) ? (string) $_POST['fields'] : '';
$fields = json_decode($fieldsRaw, true);
if (!is_array($fields)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'ข้อมูลไม่ถูกต้อง']);
    exit();
}

$filtered = [];
foreach ($allowed as $column) {
    if (array_key_exists($column, $fields)) {
        $filtered[$column] = $fields[$column];
    }
}

if (count($filtered) === 0) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'ไม่มีข้อมูลให้บันทึก']);
    exit();
}

if (
    $table === 'subjects'
    && in_array('semester_id', $allowed, true)
    && $action === 'create'
    && (!isset($filtered['semester_id']) || trim((string) $filtered['semester_id']) === '')
) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'กรุณาเลือกภาคเรียน']);
    exit();
}

if ($action === 'create') {
    $columns = array_keys($filtered);
    $placeholders = array_fill(0, count($columns), '?');
    $sql = "INSERT INTO `{$table}` (`" . implode('`,`', $columns) . "`) VALUES (" . implode(',', $placeholders) . ")";
    $stmt = mysqli_prepare($conn, $sql);
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'ไม่สามารถเพิ่มข้อมูลได้']);
        exit();
    }
    $params = array_values($filtered);
    $types = str_repeat('s', count($params));
    admin_bind_params($stmt, $types, $params);
    mysqli_stmt_execute($stmt);
    $newId = mysqli_insert_id($conn);
    mysqli_stmt_close($stmt);
    echo json_encode(['ok' => true, 'id' => $newId]);
    exit();
}

if ($action === 'update') {
    $id = isset($_POST['id']) ? (string) $_POST['id'] : '';
    if ($id === '') {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'ไม่พบรหัสรายการ']);
        exit();
    }

    $setParts = [];
    foreach (array_keys($filtered) as $column) {
        $setParts[] = "`{$column}` = ?";
    }
    $sql = "UPDATE `{$table}` SET " . implode(', ', $setParts) . " WHERE `{$pk}` = ? LIMIT 1";
    $stmt = mysqli_prepare($conn, $sql);
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'ไม่สามารถแก้ไขข้อมูลได้']);
        exit();
    }
    $params = array_values($filtered);
    $params[] = $id;
    $types = str_repeat('s', count($params));
    admin_bind_params($stmt, $types, $params);
    mysqli_stmt_execute($stmt);
    mysqli_stmt_close($stmt);
    echo json_encode(['ok' => true]);
    exit();
}

http_response_code(400);
echo json_encode(['ok' => false, 'error' => 'คำสั่งไม่ถูกต้อง']);
exit();
