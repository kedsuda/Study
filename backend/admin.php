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
$scriptName = isset($_SERVER['SCRIPT_NAME']) ? $_SERVER['SCRIPT_NAME'] : '';
$baseDir = $scriptName !== '' ? dirname($scriptName) : '';
$baseDir = str_replace('\\', '/', $baseDir);
$baseDir = rtrim($baseDir, '/');
if ($baseDir === '.' || $baseDir === '/') {
    $baseDir = '';
}
$adminLoginUrl = $baseDir . '/admin_login.php';
$rootUrl = $baseDir !== '' ? rtrim(dirname($baseDir), '/') : '';
$faviconUrl = ($rootUrl !== '' ? $rootUrl : '') . '/public/app/img/admin.png';
$brandLogoUrl = ($rootUrl !== '' ? $rootUrl : '') . '/public/app/logo-network-book.svg';
$appImgUrl = ($rootUrl !== '' ? $rootUrl : '') . '/public/img/';

if (!isset($_SESSION['user_id'])) {
    header("Location: {$adminLoginUrl}");
    exit();
}
if (isset($_SESSION['role']) && $_SESSION['role'] !== 'admin') {
    http_response_code(403);
    echo "Access denied";
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

function admin_h($value)
{
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
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
    $escapedTable = mysqli_real_escape_string($conn, $table);
    $escapedColumn = mysqli_real_escape_string($conn, $column);
    $result = admin_db_query($conn, "SHOW COLUMNS FROM `{$escapedTable}` LIKE '{$escapedColumn}'");
    if (!$result) {
        return false;
    }
    $exists = mysqli_num_rows($result) > 0;
    mysqli_free_result($result);
    return $exists;
}

function admin_term_from_date($value)
{
    if ($value === null || $value === '') {
        return '';
    }
    $ts = strtotime((string) $value);
    if ($ts === false) {
        return '';
    }
    $month = (int) date('n', $ts);
    if ($month >= 8 && $month <= 12) {
        return '1';
    }
    if ($month >= 1 && $month <= 5) {
        return '2';
    }
    if ($month >= 6 && $month <= 7) {
        return '3';
    }
    return '';
}

function admin_term_label($term)
{
    $term = (string) $term;
    if ($term === '1') {
        return 'ภาคต้น';
    }
    if ($term === '2') {
        return 'ภาคปลาย';
    }
    if ($term === '3') {
        return 'ฤดูร้อน';
    }
    return '';
}

function admin_academic_year_from_date($value)
{
    if ($value === null || $value === '') {
        return '';
    }
    $ts = strtotime((string) $value);
    if ($ts === false) {
        return '';
    }
    $month = (int) date('n', $ts);
    $year = (int) date('Y', $ts);
    $academicYear = ($month >= 8) ? $year : ($year - 1);
    return (string) ($academicYear + 543);
}

function admin_term_key_from_date($value)
{
    $term = admin_term_from_date($value);
    if ($term === '') {
        return '';
    }
    $academicYear = admin_academic_year_from_date($value);
    if ($academicYear === '') {
        return '';
    }
    return $academicYear . '-' . $term;
}

function admin_format_short_date($value)
{
    if ($value === null || $value === '') {
        return '-';
    }
    $ts = strtotime((string) $value);
    if ($ts === false) {
        return (string) $value;
    }
    return date('d/m/', $ts) . ((int) date('Y', $ts) + 543);
}

function admin_format_datetime_short($value)
{
    if ($value === null || $value === '') {
        return '-';
    }
    $ts = strtotime((string) $value);
    if ($ts === false) {
        return (string) $value;
    }
    return date('d/m/', $ts) . ((int) date('Y', $ts) + 543) . ' ' . date('H:i', $ts);
}

function admin_schedule_type_normalize($value)
{
    $type = strtolower(trim((string) $value));
    if ($type === 'exam' || $type === 'สอบ' || $type === 'test' || $type === 'quiz') {
        return 'exam';
    }
    if ($type === 'class' || $type === 'เรียน' || $type === 'study') {
        return 'class';
    }
    if ($type === 'other' || $type === 'กิจกรรม') {
        return 'other';
    }
    return $type;
}

function admin_schedule_type_label($value)
{
    $type = admin_schedule_type_normalize($value);
    if ($type === 'exam') {
        return 'สอบ';
    }
    if ($type === 'class') {
        return 'เรียน';
    }
    if ($type === 'other') {
        return 'กิจกรรม';
    }
    return (string) $value;
}

function admin_group_schedules($schedules)
{
    if (!is_array($schedules) || count($schedules) === 0) {
        return [];
    }
    $groups = [];
    foreach ($schedules as $schedule) {
        $termKey = '';
        if (isset($schedule['term_key']) && $schedule['term_key'] !== '') {
            $termKey = (string) $schedule['term_key'];
        } elseif (isset($schedule['term']) && $schedule['term'] !== '') {
            $termKey = (string) $schedule['term'];
        }
        $keyParts = [
            isset($schedule['user_id']) ? (string) $schedule['user_id'] : '',
            isset($schedule['subject_id']) ? (string) $schedule['subject_id'] : '',
            isset($schedule['day_of_week']) ? (string) $schedule['day_of_week'] : '',
            isset($schedule['schedule_type']) ? (string) $schedule['schedule_type'] : '',
            $termKey,
        ];
        $key = implode('|', $keyParts);
        if (!isset($groups[$key])) {
            $schedule['duplicate_count'] = 1;
            $groups[$key] = $schedule;
        } else {
            $groups[$key]['duplicate_count']++;

            if (empty($groups[$key]['room']) && !empty($schedule['room'])) {
                $groups[$key]['room'] = $schedule['room'];
            }

            if (empty($groups[$key]['start_time']) && !empty($schedule['start_time'])) {
                $groups[$key]['start_time'] = $schedule['start_time'];
            }

            if (empty($groups[$key]['end_time']) && !empty($schedule['end_time'])) {
                $groups[$key]['end_time'] = $schedule['end_time'];
            }
        }
    }
    return array_values($groups);
}

function admin_count_rows($conn, $table)
{
    if (!$conn || $table === '') {
        return 0;
    }
    $escaped = mysqli_real_escape_string($conn, $table);
    $result = admin_db_query($conn, "SELECT COUNT(*) AS total FROM `{$escaped}`");
    if (!$result) {
        return 0;
    }
    $row = mysqli_fetch_assoc($result);
    mysqli_free_result($result);
    return isset($row['total']) ? (int) $row['total'] : 0;
}

function admin_date_key($value)
{
    if ($value === null || $value === '') {
        return null;
    }
    $timestamp = strtotime((string) $value);
    if ($timestamp === false) {
        return null;
    }
    return date('Y-m-d', $timestamp);
}

function admin_daily_label($dateKey)
{
    $timestamp = strtotime((string) $dateKey);
    if ($timestamp === false) {
        return (string) $dateKey;
    }
    $weekdays = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
    $weekday = $weekdays[(int) date('w', $timestamp)] ?? '';
    return $weekday . ' ' . date('d/m', $timestamp);
}

$conn = admin_db_connect();
$users = [];
$subjects = [];
$schedules = [];
$studyLogs = [];
$quizzes = [];
$learningGoals = [];
$usersById = [];
$subjectsById = [];
$subjectUserIdsById = [];
$subjectTermsById = [];
$semesterOptions = [];
$semesterById = [];
$semesterSubjectCounts = [];
$currentAdminProfile = [
    'id' => isset($_SESSION['user_id']) ? (string) $_SESSION['user_id'] : '',
    'name' => isset($_SESSION['username']) ? (string) $_SESSION['username'] : 'ผู้ดูแล',
    'email' => isset($_SESSION['email']) ? (string) $_SESSION['email'] : '',
    'role' => isset($_SESSION['role']) ? (string) $_SESSION['role'] : 'admin',
    'created_at' => '',
];
$hasSubjectSemesterColumn = false;
$userCountFromDb = 0;
$subjectCountFromDb = 0;
$scheduleCountFromDb = 0;
$studyLogCountFromDb = 0;
$quizCountFromDb = 0;

if ($conn) {
    $userCountFromDb = admin_count_rows($conn, 'users');
    $subjectCountFromDb = admin_count_rows($conn, 'subjects');
    $scheduleCountFromDb = admin_count_rows($conn, 'schedules');
    // This is counted from the filtered rows loaded below so legacy quiz-source
    // logs are not included in the learning-summary total.
    $studyLogCountFromDb = 0;
    $quizCountFromDb = admin_count_rows($conn, 'quizzes');

    $semesterKeys = [];
    if (admin_table_exists($conn, 'semester')) {
        // เรียงภาคเรียนจากใหม่ไปเก่า: ปีการศึกษาล่าสุดก่อน และภาคเรียนเลขมากกว่าก่อน
        $result = admin_db_query($conn, 'SELECT semester_id, semester, academic_year FROM semester ORDER BY CAST(academic_year AS UNSIGNED) DESC, CAST(semester AS UNSIGNED) DESC, semester_id DESC');
        if ($result) {
            while ($row = mysqli_fetch_assoc($result)) {
                $term = isset($row['semester']) ? (string) $row['semester'] : '';
                $year = isset($row['academic_year']) ? (string) $row['academic_year'] : '';
                if ($term === '' || $year === '') {
                    continue;
                }
                $key = $year . '-' . $term;
                if (isset($semesterKeys[$key])) {
                    continue;
                }
                $semesterId = isset($row['semester_id']) ? (string) $row['semester_id'] : '';
                $termYearLabel = $term . '-' . $year;
                $semesterOptions[] = [
                    'id' => $semesterId,
                    'key' => $key,
                    'label' => $termYearLabel,
                    'term' => $term,
                    'year' => $year,
                ];
                if ($semesterId !== '') {
                    $semesterById[$semesterId] = [
                        'key' => $key,
                        'label' => $termYearLabel,
                    ];
                }
                $semesterKeys[$key] = true;
            }
            mysqli_free_result($result);
        }
    }

    $result = admin_db_query($conn, 'SELECT id, name, email, role, created_at FROM users ORDER BY id ASC');
    if ($result) {
        while ($row = mysqli_fetch_assoc($result)) {
            $users[] = $row;
        }
        mysqli_free_result($result);
    }
    foreach ($users as $user) {
        $usersById[$user['id']] = $user['name'];
        if ((string) $user['id'] === $currentAdminProfile['id']) {
            $currentAdminProfile = array_merge($currentAdminProfile, $user);
        }
    }

    $hasSubjectSemesterColumn = admin_column_exists($conn, 'subjects', 'semester_id');
    $subjectSelectSql = 'SELECT id, user_id, name, description, color, target_hours, start_date, start_time, end_time, created_at, updated_at';
    if ($hasSubjectSemesterColumn) {
        $subjectSelectSql .= ', semester_id';
    }
    $subjectSelectSql .= ' FROM subjects ORDER BY id ASC';
    $result = admin_db_query($conn, $subjectSelectSql);
    if ($result) {
        while ($row = mysqli_fetch_assoc($result)) {
            $subjects[] = $row;
        }
        mysqli_free_result($result);
    }
    foreach ($subjects as $subject) {
        $subjectsById[$subject['id']] = $subject['name'];
        $subjectUserIdsById[$subject['id']] = isset($subject['user_id']) ? (string) $subject['user_id'] : '';
        $semesterId = isset($subject['semester_id']) ? (string) $subject['semester_id'] : '';
        if ($semesterId !== '') {
            $semesterSubjectCounts[$semesterId] = ($semesterSubjectCounts[$semesterId] ?? 0) + 1;
        }
        if ($hasSubjectSemesterColumn && $semesterId !== '' && isset($semesterById[$semesterId])) {
            $subjectTermsById[$subject['id']] = $semesterById[$semesterId]['key'];
        } else {
            $subjectTermsById[$subject['id']] = admin_term_key_from_date($subject['start_date']);
        }
    }

    $result = admin_db_query($conn, 'SELECT id, user_id, subject_id, day_of_week, start_time, end_time, room, schedule_type, created_at, updated_at FROM schedules ORDER BY id ASC');
    if ($result) {
        while ($row = mysqli_fetch_assoc($result)) {
            $schedules[] = $row;
        }
        mysqli_free_result($result);
    }
    if (count($schedules) === 0 && admin_table_exists($conn, 'study_calendar_events')) {
        $eventHasRoomColumn = admin_column_exists($conn, 'study_calendar_events', 'room');
        $eventSelectSql = 'SELECT id, user_id, subject_id, start_time, end_time, event_type, metadata, created_at, updated_at';
        if ($eventHasRoomColumn) {
            $eventSelectSql .= ', room';
        }
        $eventSelectSql .= ' FROM study_calendar_events ORDER BY id ASC';

        $result = admin_db_query($conn, $eventSelectSql);
        if ($result) {
            while ($row = mysqli_fetch_assoc($result)) {
                $metadata = json_decode($row['metadata'] ?? '', true);
                if (!is_array($metadata)) {
                    $metadata = [];
                }

                $startTime = $row['start_time'];
                $endTime = $row['end_time'];

                $startTs = $startTime ? strtotime($startTime) : false;
                $endTs = $endTime ? strtotime($endTime) : false;

                $schedules[] = [
                    'id' => $row['id'],
                    'user_id' => $row['user_id'],
                    'subject_id' => $row['subject_id'],
                    'day_of_week' => $startTs ? date('l', $startTs) : 'N/A',
                    'start_time' => $startTs ? date('H:i:s', $startTs) : null,
                    'end_time' => $endTs ? date('H:i:s', $endTs) : null,
                    'room' => !empty($row['room'] ?? '') ? $row['room'] : ($metadata['room'] ?? ''),
                    'schedule_type' => $row['event_type'],
                    'term_key' => admin_term_key_from_date($row['start_time']),
                    'created_at' => $row['created_at'],
                    'updated_at' => $row['updated_at'],
                ];
            }
            mysqli_free_result($result);
        }
    }

    $schedules = admin_group_schedules($schedules);

    $studyLogSql = 'SELECT id, user_id, subject_id, title, log_date, duration_minutes FROM study_logs';
    if (admin_column_exists($conn, 'study_logs', 'note')) {
        $studyLogSql .= " WHERE COALESCE(note, '') <> 'อัปโหลดไฟล์เพื่อสร้างแบบฝึกหัด'";
    }
    $studyLogSql .= ' ORDER BY id ASC';
    $result = admin_db_query($conn, $studyLogSql);
    if ($result) {
        while ($row = mysqli_fetch_assoc($result)) {
            $studyLogs[] = $row;
        }
        mysqli_free_result($result);
    }
    $result = admin_db_query($conn, 'SELECT id, subject_id, title, ai_model, created_at FROM quizzes ORDER BY id ASC');
    if ($result) {
        while ($row = mysqli_fetch_assoc($result)) {
            $quizzes[] = $row;
        }
        mysqli_free_result($result);
    }

    // My Goals stores checkbox activities separately from legacy numeric goals.
    if (admin_table_exists($conn, 'goal_tasks')) {
        $result = admin_db_query($conn, 'SELECT id, user_id, title, task_date, completed FROM goal_tasks ORDER BY task_date ASC, id ASC');
        if ($result) {
            while ($row = mysqli_fetch_assoc($result)) {
                $learningGoals[] = [
                    'id' => 'task-' . $row['id'],
                    'user_id' => $row['user_id'],
                    'title' => $row['title'],
                    'target_value' => 1,
                    'current_value' => (int) !empty($row['completed']),
                    'status' => !empty($row['completed']) ? 'completed' : 'pending',
                    'period_start' => $row['task_date'],
                    'term_key' => admin_term_key_from_date($row['task_date']),
                ];
            }
            mysqli_free_result($result);
        }
    }

    if (admin_table_exists($conn, 'learning_goal_targets')) {
        $result = admin_db_query($conn, 'SELECT id, user_id, subject_id, period_type, title, target_value, current_value, status, period_start, period_end FROM learning_goal_targets ORDER BY period_start ASC, period_end ASC, id ASC');
        if ($result) {
            while ($row = mysqli_fetch_assoc($result)) {
                $learningGoals[] = $row;
            }
            mysqli_free_result($result);
        }
    }
}

if (count($semesterOptions) === 0) {
    $fallbackKeys = [];
    foreach ($subjects as $subject) {
        $key = admin_term_key_from_date($subject['start_date']);
        if ($key !== '') {
            $fallbackKeys[$key] = true;
        }
    }
    foreach ($studyLogs as $log) {
        $key = admin_term_key_from_date($log['log_date']);
        if ($key !== '') {
            $fallbackKeys[$key] = true;
        }
    }
    foreach ($learningGoals as $goal) {
        $key = admin_term_key_from_date($goal['period_start'] ?? '');
        if ($key !== '') {
            $fallbackKeys[$key] = true;
        }
    }
    if (count($fallbackKeys) > 0) {
        $parsed = [];
        foreach (array_keys($fallbackKeys) as $key) {
            $parts = explode('-', $key, 2);
            if (count($parts) !== 2) {
                continue;
            }
            $year = $parts[0];
            $term = $parts[1];
            $parsed[] = [
                'key' => $key,
                'label' => $term . '-' . $year,
                'term' => $term,
                'year' => $year,
            ];
        }
        usort($parsed, function ($a, $b) {
            $yearA = (int) $a['year'];
            $yearB = (int) $b['year'];
            if ($yearA === $yearB) {
                $termA = (int) $a['term'];
                $termB = (int) $b['term'];
                if ($termA === $termB) {
                    return 0;
                }
                return ($termA < $termB) ? 1 : -1;
            }
            return ($yearA < $yearB) ? 1 : -1;
        });
        $semesterOptions = $parsed;
    }
}

$countUsers = $userCountFromDb > 0 ? $userCountFromDb : count($users);
$countSubjects = $subjectCountFromDb > 0 ? $subjectCountFromDb : count($subjects);
$countSchedules = $scheduleCountFromDb > 0 ? $scheduleCountFromDb : count($schedules);
$countStudyLogs = $studyLogCountFromDb > 0 ? $studyLogCountFromDb : count($studyLogs);
$countQuizzes = $quizCountFromDb > 0 ? $quizCountFromDb : count($quizzes);
$statMaxValue = max(1, $countUsers, $countSubjects, $countSchedules, $countStudyLogs);
$usersStatPercent = max(12, (int) round(($countUsers / $statMaxValue) * 100));
$subjectsStatPercent = max(12, (int) round(($countSubjects / $statMaxValue) * 100));
$schedulesStatPercent = max(12, (int) round(($countSchedules / $statMaxValue) * 100));
$studyLogsStatPercent = max(12, (int) round(($countStudyLogs / $statMaxValue) * 100));

$adminUsersCount = 0;
$memberUsersCount = 0;
foreach ($users as $userRow) {
    $role = isset($userRow['role']) ? strtolower((string) $userRow['role']) : 'user';
    if ($role === 'admin') {
        $adminUsersCount++;
    } else {
        $memberUsersCount++;
    }
}

$classSchedulesCount = 0;
$examSchedulesCount = 0;
foreach ($schedules as $scheduleRow) {
    $scheduleType = admin_schedule_type_normalize(isset($scheduleRow['schedule_type']) ? $scheduleRow['schedule_type'] : '');
    if ($scheduleType === 'exam') {
        $examSchedulesCount++;
    } else {
        $classSchedulesCount++;
    }
}

$totalStudyMinutes = 0;
foreach ($studyLogs as $logRow) {
    $totalStudyMinutes += isset($logRow['duration_minutes']) ? max(0, (int) $logRow['duration_minutes']) : 0;
}
$avgStudyMinutes = $countStudyLogs > 0 ? (int) round($totalStudyMinutes / $countStudyLogs) : 0;

$completedGoalsCount = 0;
$goalProgressTotal = 0;
$goalProgressCount = count($learningGoals);
foreach ($learningGoals as &$goalRow) {
    $targetValue = max(0, (int) ($goalRow['target_value'] ?? 0));
    $currentValue = max(0, (int) ($goalRow['current_value'] ?? 0));
    $progressPercent = $targetValue > 0 ? min(100, (int) round(($currentValue / $targetValue) * 100)) : 0;
    if (($goalRow['status'] ?? '') === 'completed') {
        $progressPercent = 100;
    }
    if ($progressPercent >= 100) {
        $goalRow['status'] = 'completed';
    }
    $goalRow['progress_percent'] = $progressPercent;
    $goalProgressTotal += $progressPercent;
    if (($goalRow['status'] ?? '') === 'completed' || $progressPercent >= 100) {
        $completedGoalsCount++;
    }
}
unset($goalRow);
$averageGoalProgress = $goalProgressCount > 0 ? (int) round($goalProgressTotal / $goalProgressCount) : 0;

// Surface operational follow-ups on the dashboard without requiring additional queries.
$subjectOwnerIds = [];
foreach ($subjects as $subjectRow) {
    $ownerId = isset($subjectRow['user_id']) ? (string) $subjectRow['user_id'] : '';
    if ($ownerId !== '') {
        $subjectOwnerIds[$ownerId] = true;
    }
}
$usersWithoutSubjectsCount = 0;
foreach ($users as $userRow) {
    $userId = isset($userRow['id']) ? (string) $userRow['id'] : '';
    $role = isset($userRow['role']) ? strtolower((string) $userRow['role']) : 'user';
    if ($userId !== '' && $role !== 'admin' && !isset($subjectOwnerIds[$userId])) {
        $usersWithoutSubjectsCount++;
    }
}
$goalsNeedingAttentionCount = 0;
foreach ($learningGoals as $goalRow) {
    $goalStatus = (string) ($goalRow['status'] ?? 'pending');
    if ($goalStatus !== 'completed' && (int) ($goalRow['progress_percent'] ?? 0) < 100) {
        $goalsNeedingAttentionCount++;
    }
}
$dashboardFollowUps = [
    [
        'icon' => '🎯',
        'tone' => 'violet',
        'title' => 'เป้าหมายที่ยังไม่เสร็จ',
        'detail' => $goalsNeedingAttentionCount > 0 ? $goalsNeedingAttentionCount . ' เป้าหมายต้องติดตาม' : 'ไม่มีเป้าหมายที่ค้างอยู่',
        'view' => 'goals',
    ],
    [
        'icon' => '📚',
        'tone' => 'blue',
        'title' => 'ผู้ใช้ที่ยังไม่มีวิชา',
        'detail' => $usersWithoutSubjectsCount > 0 ? $usersWithoutSubjectsCount . ' คนยังไม่มีรายวิชา' : 'ผู้ใช้ทุกคนมีรายวิชาแล้ว',
        'view' => 'users',
    ],
    [
        'icon' => '🗓️',
        'tone' => 'orange',
        'title' => 'ตารางสอบและกิจกรรม',
        'detail' => $examSchedulesCount > 0 ? $examSchedulesCount . ' รายการในระบบ' : 'ยังไม่มีรายการสอบหรือกิจกรรม',
        'view' => 'schedules',
    ],
];

$dashboardSchedules = $schedules;
usort($dashboardSchedules, function ($a, $b) {
    $dayA = (string) ($a['day_of_week'] ?? '');
    $dayB = (string) ($b['day_of_week'] ?? '');
    $timeA = (string) ($a['start_time'] ?? '');
    $timeB = (string) ($b['start_time'] ?? '');
    return [$dayA, $timeA] <=> [$dayB, $timeB];
});
$dashboardSchedules = array_slice($dashboardSchedules, 0, 5);

$userFieldOptions = array_map(function ($userRow) {
    $id = isset($userRow['id']) ? (string) $userRow['id'] : '';
    $name = trim((string) ($userRow['name'] ?? ''));
    $email = trim((string) ($userRow['email'] ?? ''));
    $labelParts = [];
    if ($id !== '') {
        $labelParts[] = '#' . $id;
    }
    if ($name !== '') {
        $labelParts[] = $name;
    }
    if ($email !== '') {
        $labelParts[] = '(' . $email . ')';
    }
    return [
        'value' => $id,
        'label' => count($labelParts) > 0 ? implode(' ', $labelParts) : $id,
    ];
}, $users);

$subjectFieldOptions = array_map(function ($subjectRow) use ($usersById) {
    $id = isset($subjectRow['id']) ? (string) $subjectRow['id'] : '';
    $name = trim((string) ($subjectRow['name'] ?? ''));
    $userId = isset($subjectRow['user_id']) ? (string) $subjectRow['user_id'] : '';
    $owner = $userId !== '' && isset($usersById[$userId]) ? $usersById[$userId] : $userId;
    $label = '#' . $id . ' ' . ($name !== '' ? $name : 'ไม่ระบุชื่อวิชา');
    if ($owner !== '') {
        $label .= ' - ' . $owner;
    }
    return [
        'value' => $id,
        'label' => $label,
        'user_id' => $userId,
    ];
}, $subjects);

$adminProfileInitial = mb_substr(trim((string) $currentAdminProfile['name']), 0, 1, 'UTF-8');
if ($adminProfileInitial === '') {
    $adminProfileInitial = 'ผ';
}
$adminJoinedLabel = isset($currentAdminProfile['created_at']) && trim((string) $currentAdminProfile['created_at']) !== ''
    ? date('d/m/Y H:i', strtotime((string) $currentAdminProfile['created_at']))
    : 'ไม่พบข้อมูล';

$latestActivityTimestamp = 0;
$latestActivityLabel = 'ยังไม่มีข้อมูลล่าสุด';
foreach ([$users, $subjects, $schedules, $studyLogs, $quizzes] as $recordGroup) {
    foreach ($recordGroup as $record) {
        foreach (['updated_at', 'created_at', 'log_date', 'start_date'] as $dateField) {
            if (!isset($record[$dateField]) || trim((string) $record[$dateField]) === '') {
                continue;
            }
            $timestamp = strtotime((string) $record[$dateField]);
            if ($timestamp !== false && $timestamp > $latestActivityTimestamp) {
                $latestActivityTimestamp = $timestamp;
            }
        }
    }
}
if ($latestActivityTimestamp > 0) {
    $latestActivityLabel = date('d/m/Y H:i', $latestActivityTimestamp);
}

$dailySeries = [];
for ($i = 6; $i >= 0; $i--) {
    $dateKey = date('Y-m-d', strtotime("-{$i} day"));
    $dailySeries[$dateKey] = [
        'date' => $dateKey,
        'logs' => 0,
        'minutes' => 0,
        'active_users' => 0,
        'notifications' => 0,
        'quizzes' => 0,
        'new_users' => 0,
    ];
}
$dailyStudyUsers = [];

foreach ($studyLogs as $log) {
    $dateKey = admin_date_key(isset($log['log_date']) ? $log['log_date'] : null);
    if ($dateKey === null || !isset($dailySeries[$dateKey])) {
        continue;
    }
    $dailySeries[$dateKey]['logs']++;
    $duration = isset($log['duration_minutes']) ? (int) $log['duration_minutes'] : 0;
    if ($duration > 0) {
        $dailySeries[$dateKey]['minutes'] += $duration;
    }
    $userId = isset($log['user_id']) ? (string) $log['user_id'] : '';
    if ($userId !== '') {
        if (!isset($dailyStudyUsers[$dateKey])) {
            $dailyStudyUsers[$dateKey] = [];
        }
        $dailyStudyUsers[$dateKey][$userId] = true;
    }
}

foreach ($dailyStudyUsers as $dateKey => $userSet) {
    if (!isset($dailySeries[$dateKey])) {
        continue;
    }
    $dailySeries[$dateKey]['active_users'] = count($userSet);
}

foreach ($quizzes as $quiz) {
    $dateKey = admin_date_key(isset($quiz['created_at']) ? $quiz['created_at'] : null);
    if ($dateKey !== null && isset($dailySeries[$dateKey])) {
        $dailySeries[$dateKey]['quizzes']++;
    }
}

foreach ($users as $user) {
    $dateKey = admin_date_key(isset($user['created_at']) ? $user['created_at'] : null);
    if ($dateKey !== null && isset($dailySeries[$dateKey])) {
        $dailySeries[$dateKey]['new_users']++;
    }
}

$currentHour = (int) date('G');
$greetingText = 'สวัสดี';
if ($currentHour < 12) {
    $greetingText = 'สวัสดีตอนเช้า';
} elseif ($currentHour < 17) {
    $greetingText = 'สวัสดีตอนบ่าย';
} else {
    $greetingText = 'สวัสดีตอนเย็น';
}

$dailySeriesRows = array_values($dailySeries);
$dailyRowsForDisplay = array_reverse($dailySeriesRows);
$allLogDates = [];
foreach ($studyLogs as $logRow) {
    $logDateKey = admin_date_key(isset($logRow['log_date']) ? $logRow['log_date'] : null);
    if ($logDateKey !== null) {
        if (!isset($allLogDates[$logDateKey])) {
            $allLogDates[$logDateKey] = 0;
        }
        $allLogDates[$logDateKey]++;
    }
}
$allUserCreatedDates = [];
foreach ($users as $userRow) {
    $userDateKey = admin_date_key(isset($userRow['created_at']) ? $userRow['created_at'] : null);
    if ($userDateKey !== null) {
        $allUserCreatedDates[] = $userDateKey;
    }
}
sort($allUserCreatedDates);

$buildTrendWindow = function ($days) use ($allLogDates, $allUserCreatedDates) {
    $labels = [];
    $logs = [];
    $users = [];
    $dates = [];
    for ($i = $days - 1; $i >= 0; $i--) {
        $dateKey = date('Y-m-d', strtotime("-{$i} day"));
        $dates[] = $dateKey;
        $labels[] = date('d/m', strtotime($dateKey));
        $logs[] = isset($allLogDates[$dateKey]) ? (int) $allLogDates[$dateKey] : 0;
    }
    $runningUserTotal = 0;
    $userCursor = 0;
    $userDateCount = count($allUserCreatedDates);
    foreach ($dates as $dateKey) {
        while ($userCursor < $userDateCount && $allUserCreatedDates[$userCursor] <= $dateKey) {
            $runningUserTotal++;
            $userCursor++;
        }
        $users[] = $runningUserTotal;
    }
    return ['labels' => $labels, 'users' => $users, 'logs' => $logs];
};

$trendWeek = $buildTrendWindow(7);
$trendMonth = $buildTrendWindow(30);

$trendYearLabels = [];
$trendYearLogs = [];
$trendYearUsers = [];
$yearMonthKeys = [];
for ($i = 11; $i >= 0; $i--) {
    $monthKey = date('Y-m', strtotime(date('Y-m-01') . " -{$i} month"));
    $yearMonthKeys[] = $monthKey;
    $trendYearLabels[] = date('m/Y', strtotime($monthKey . '-01'));
    $trendYearLogs[] = 0;
}
foreach ($allLogDates as $logDateKey => $logCount) {
    $monthKey = date('Y-m', strtotime($logDateKey));
    $monthIndex = array_search($monthKey, $yearMonthKeys, true);
    if ($monthIndex !== false) {
        $trendYearLogs[$monthIndex] += (int) $logCount;
    }
}
$runningUserTotal = 0;
$userCursor = 0;
$userDateCount = count($allUserCreatedDates);
foreach ($yearMonthKeys as $monthKey) {
    $monthEnd = date('Y-m-t', strtotime($monthKey . '-01'));
    while ($userCursor < $userDateCount && $allUserCreatedDates[$userCursor] <= $monthEnd) {
        $runningUserTotal++;
        $userCursor++;
    }
    $trendYearUsers[] = $runningUserTotal;
}
$trendChartData = [
    'week' => $trendWeek,
    'month' => $trendMonth,
    'year' => [
        'labels' => $trendYearLabels,
        'users' => $trendYearUsers,
        'logs' => $trendYearLogs,
    ],
];

$latestUsersPreview = array_slice(array_reverse($users), 0, 5);
$latestSubjectsPreview = array_slice(array_reverse($subjects), 0, 5);
$recentActivities = [];

foreach ($latestUsersPreview as $userPreview) {
    $recentActivities[] = [
        'icon_class' => 'violet',
        'icon' => '👤',
        'title' => 'เพิ่มผู้ใช้งานใหม่',
        'meta' => isset($userPreview['name']) ? (string) $userPreview['name'] : 'ผู้ใช้งานใหม่',
        'time' => isset($userPreview['created_at']) ? (string) $userPreview['created_at'] : '',
    ];
}

foreach (array_slice(array_reverse($subjects), 0, 4) as $subjectPreview) {
    $recentActivities[] = [
        'icon_class' => 'blue',
        'icon' => '📘',
        'title' => 'สร้างวิชาเรียน',
        'meta' => isset($subjectPreview['name']) ? (string) $subjectPreview['name'] : 'วิชาเรียน',
        'time' => isset($subjectPreview['created_at']) ? (string) $subjectPreview['created_at'] : '',
    ];
}

// foreach (array_slice(array_reverse($studyLogs), 0, 4) as $logPreview) {
//     $activitySubjectId = isset($logPreview['subject_id']) ? (string) $logPreview['subject_id'] : '';
//     $activitySubjectName = $activitySubjectId !== '' && isset($subjectsById[$activitySubjectId]) ? $subjectsById[$activitySubjectId] : 'บันทึกการเรียน';
//     $recentActivities[] = [
//         'icon_class' => 'orange',
//         'icon' => '📝',
//         'title' => 'บันทึกการเรียน',
//         'meta' => $activitySubjectName,
//         'time' => isset($logPreview['log_date']) ? (string) $logPreview['log_date'] : '',
//     ];
// }

usort($recentActivities, function ($a, $b) {
    $timeA = isset($a['time']) ? strtotime((string) $a['time']) : false;
    $timeB = isset($b['time']) ? strtotime((string) $b['time']) : false;
    $timeA = $timeA === false ? 0 : $timeA;
    $timeB = $timeB === false ? 0 : $timeB;
    return $timeB <=> $timeA;
});

$recentActivities = array_slice($recentActivities, 0, 5);
?>
<!DOCTYPE html>
<html lang="th">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ระบบการเรียน - ผู้ดูแลระบบ</title>
    <link rel="icon" type="image/png" href="<?php echo admin_h($faviconUrl); ?>">
    <link rel="shortcut icon" href="<?php echo admin_h($faviconUrl); ?>">
    <link rel="stylesheet" href="<?php echo admin_h(($baseDir !== '' ? $baseDir : '') . '/slty.css'); ?>">
    <style>
        /* ลดความกว้างช่องเลือกเวลาในหน้าตั้งค่าซ่อมบำรุง */
        .maintenance-schedule .admin-time-picker {
            display: flex !important;
            align-items: center;
            justify-content: flex-start;
            gap: 10px;
            width: auto !important;
        }

        .maintenance-schedule .admin-time-picker select {
            flex: 0 0 160px !important;
            width: 160px !important;
            min-width: 160px !important;
            max-width: 160px !important;
        }

        .maintenance-schedule .admin-time-picker > span {
            flex: 0 0 auto;
        }

        @media (max-width: 520px) {
            .maintenance-schedule .admin-time-picker {
                width: 100% !important;
            }

            .maintenance-schedule .admin-time-picker select {
                flex: 1 1 0 !important;
                width: auto !important;
                min-width: 0 !important;
                max-width: none !important;
            }
        }
    </style>
</head>

<body>
    <div class="layout" id="adminLayout">
        <aside class="sidebar">
            <div class="brand">
                <span class="brand-text">
                    <strong>ผู้ดูแลระบบ</strong>
                </span>
            </div>
            <div class="user-card">
                <div class="name">
                    <span class="greet">สวัสดี,</span>
                    <span class="username"><?php echo admin_h(isset($_SESSION['username']) ? $_SESSION['username'] : 'ผู้ดูแลระบบ'); ?></span>
                </div>
                <div class="role">สิทธิ์ผู้ดูแลระบบ</div>
            </div>
            <nav class="nav">
                <a class="active" href="#" data-nav="dashboard">
                    <span class="icon blue">📊</span>
                    <span class="label">ภาพรวมระบบ</span>
                </a>
                <a href="#" data-nav="users">
                    <span class="icon blue">👥</span>
                    <span class="label">ผู้ใช้งาน</span>
                </a>
                <a href="#" data-nav="semesters">
                    <span class="icon cyan">📅</span>
                    <span class="label">ภาคเรียน</span>
                </a>
                <a href="#" data-nav="subjects">
                    <span class="icon cyan">📚</span>
                    <span class="label">วิชาเรียน</span>
                </a>
                <a href="#" data-nav="schedules">
                    <span class="icon cyan">🗓️</span>
                    <span class="label">ตารางเรียนและสอบ</span>
                </a>
                <a href="#" data-nav="study-logs">
                    <span class="icon purple">🧾</span>
                    <span class="label">สรุปการเรียน</span>
                </a>
                <a href="#" data-nav="quizzes">
                    <span class="icon purple">📝</span>
                    <span class="label">แบบฝึกหัด</span>
                </a>
                <a href="#" data-nav="goals">
                    <span class="icon purple">🎯</span>
                    <span class="label">ติดตามเป้าหมาย</span>
                </a>
                <a href="#" data-nav="settings">
                    <span class="icon gray">⚙️</span>
                    <span class="label">ตั้งค่าระบบ</span>
                </a>

                <a href="<?php echo admin_h(($baseDir !== '' ? $baseDir : '') . '/admin_logout.php'); ?>">
                    <span class="icon gray">🚪</span>
                    <span class="label">ออกจากระบบ</span>
                </a>
            </nav>
            <div class="sidebar-footer">ผู้ดูแลระบบ</div>
        </aside>

        <main class="main">
            <div class="topbar">
                <div class="left">
                    <button class="toggle-btn" type="button" id="sidebarToggle" aria-label="เมนู">เมนู</button>
                    <div class="topbar-heading">
                        <div class="topbar-title">ผู้ดูแลระบบ</div>
                    </div>
                </div>
                <div class="right">
                    <span class="icon-pill datetime-pill" id="currentDateTime"></span>
                    <span class="admin-chip">
                        <span class="admin-avatar"><?php echo admin_h($adminProfileInitial); ?></span>
                        <span class="admin-meta">
                            <strong>ผู้ดูแลระบบ</strong>
                        </span>
                    </span>
                </div>
            </div>

            <section class="page-card admin-dashboard-mockup">
                <div class="card-header" id="mainPanelHeader">
                    <div class="panel-context">
                        <div class="panel-kicker" id="panelKicker">ผู้ดูแลระบบ</div>
                        <div class="card-title" id="cardTitle">ตารางแสดงรายการ (ผู้ดูแลระบบ)</div>
                        <div class="panel-subtitle" id="cardSubtitle">ภาพรวมข้อมูลจริงของผู้ใช้ วิชา ตารางเรียน และบันทึกการเรียน</div>
                    </div>
                </div>

                <div class="panel-toolbar" id="mainPanelToolbar">
                    <select id="userFilter" aria-label="กรองตามผู้ใช้งาน" style="min-width:190px;">
                        <option value="">ทุกผู้ใช้งาน</option>
                        <?php foreach ($users as $userOption): ?>
                            <option value="<?php echo admin_h($userOption['id']); ?>">
                                <?php echo admin_h($userOption['name']); ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                    <select id="semesterFilter" aria-label="กรองตามภาคเรียน" style="min-width:220px;">
                        <?php foreach ($semesterOptions as $semesterOption): ?>
                            <option value="<?php echo admin_h($semesterOption['key'] ?? ''); ?>">
                                <?php echo admin_h('ภาคเรียนที่ ' . ($semesterOption['term'] ?? '-') . ' ปีการศึกษา ' . ($semesterOption['year'] ?? '-')); ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </div>

                <div class="tab-panel active dashboard-overview-panel" data-panel="dashboard">
                    <h3 class="mockup-section-title">สถิติภาพรวม</h3>
                <div class="stats-grid stats-graph-grid">
<div class="stat-card">
    <div class="stat-icon violet">
        <img src="<?php echo admin_h($appImgUrl . 'users-icon.png'); ?>" alt="ผู้ใช้ทั้งหมด">
    </div>
    <div class="stat-copy">
        <div class="stat-label" id="dashboardUsersLabel">ผู้ใช้ทั้งหมด</div>
        <div class="stat-value" id="dashboardUsersValue"><?php echo (int) $countUsers; ?></div>
        <div class="stat-sub" id="dashboardUsersSub">คนในระบบ</div>
    </div>
    <div class="stat-mini-chart" aria-hidden="true">
        <span class="stat-mini-track">
            <i class="stat-mini-fill violet" id="dashboardUsersMiniBar" data-value="<?php echo (int) $countUsers; ?>" style="height: <?php echo (int) $usersStatPercent; ?>%;"></i>
        </span>
    </div>
</div>

<div class="stat-card">
    <div class="stat-icon blue">
        <img src="<?php echo admin_h($appImgUrl . 'subject-icon.png'); ?>" alt="วิชาเรียน">
    </div>
    <div class="stat-copy">
        <div class="stat-label">วิชาเรียน</div>
        <div class="stat-value" id="dashboardSubjectsValue"><?php echo (int) $countSubjects; ?></div>
        <div class="stat-sub" id="dashboardSubjectsSub">วิชาที่บันทึกไว้</div>
    </div>
    <div class="stat-mini-chart" aria-hidden="true">
        <span class="stat-mini-track">
            <i class="stat-mini-fill blue" id="dashboardSubjectsMiniBar" data-value="<?php echo (int) $countSubjects; ?>" style="height: <?php echo (int) $subjectsStatPercent; ?>%;"></i>
        </span>
    </div>
</div>

<div class="stat-card">
    <div class="stat-icon green">
        <img src="<?php echo admin_h($appImgUrl . 'schedule-icon.png'); ?>" alt="ตารางเรียน">
    </div>
    <div class="stat-copy">
        <div class="stat-label">ตารางเรียน</div>
        <div class="stat-value" id="dashboardSchedulesValue"><?php echo (int) $countSchedules; ?></div>
        <div class="stat-sub" id="dashboardSchedulesSub">รายการทั้งหมด</div>
    </div>
    <div class="stat-mini-chart" aria-hidden="true">
        <span class="stat-mini-track">
            <i class="stat-mini-fill green" id="dashboardSchedulesMiniBar" data-value="<?php echo (int) $countSchedules; ?>" style="height: <?php echo (int) $schedulesStatPercent; ?>%;"></i>
        </span>
    </div>
</div>

                </div>
                        <div class="chart-card summary-chart-card mockup-summary-chart" aria-hidden="true">
                            <div class="chart-title" id="dashboardChartTitle">ภาพรวมข้อมูล</div>
                            <div class="bar-chart-with-axes">
                                <div class="bar-y-axis" aria-hidden="true">
                                    <span id="dashboardChartTickMax">0</span>
                                    <span>0</span>
                                    <span>0</span>
                                    <span id="dashboardChartTickMid">0</span>
                                    <span>0</span>
                                    <span>0</span>
                                    <span>0</span>
                                </div>
                                <div class="bar-chart" id="adminBarChart" aria-label="กราฟสรุปข้อมูลผู้ดูแลระบบ แกนตั้งแสดงจำนวนรายการ แกนนอนแสดงประเภทข้อมูล">
                                    <div class="bar-item">
                                        <div class="bar-value" id="dashboardUsersBarValue"><?php echo (int) $countUsers; ?></div>
                                        <div class="bar-track">
                                            <div class="bar-fill blue" id="dashboardUsersBar" data-value="<?php echo (int) $countUsers; ?>"></div>
                                        </div>
                                        <div class="bar-label">ผู้ใช้งาน</div>
                                    </div>
                                    <div class="bar-item">
                                        <div class="bar-value" id="dashboardSubjectsBarValue"><?php echo (int) $countSubjects; ?></div>
                                        <div class="bar-track">
                                            <div class="bar-fill green" id="dashboardSubjectsBar" data-value="<?php echo (int) $countSubjects; ?>"></div>
                                        </div>
                                        <div class="bar-label">วิชาเรียน</div>
                                    </div>
                                    <div class="bar-item">
                                        <div class="bar-value" id="dashboardSchedulesBarValue"><?php echo (int) $countSchedules; ?></div>
                                        <div class="bar-track">
                                            <div class="bar-fill amber" id="dashboardSchedulesBar" data-value="<?php echo (int) $countSchedules; ?>"></div>
                                        </div>
                                        <div class="bar-label">ตารางเรียน</div>
                                    </div>
                                </div>
                            </div>
                            <div class="bar-axis bar-x-axis" aria-label="แกนนอน: ประเภทข้อมูล">แกนนอน: ประเภทข้อมูล</div>
                            <div class="bar-y-axis-title" aria-hidden="true">แกนตั้ง: จำนวน (รายการ)</div>
                        </div>
                        <div class="dashboard-insights-grid">
                            <div class="chart-card trend-card">
                                <div class="trend-head">
                                    <div class="trend-title-wrap">
                                        <span class="trend-icon" aria-hidden="true">
                                            <svg viewBox="0 0 24 24" fill="none">
                                                <path d="M3 12h4l2-5 4 10 2-5h6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
                                            </svg>
                                        </span>
                                        <div class="chart-title">แนวโน้มการใช้งาน (7 วันย้อนหลัง)</div>
                                    </div>
                                    <div class="trend-legend" aria-hidden="true">
                                        <span class="trend-legend-item"><i class="dot users"></i>ผู้ใช้งาน</span>
                                        <span class="trend-legend-item"><i class="dot logs"></i>บันทึก</span>
                                    </div>
                                    <select id="trendRangeSelect" class="trend-range-select" aria-label="ช่วงเวลาแนวโน้ม">
                                        <option value="week">สัปดาห์</option>
                                        <option value="month">เดือน</option>
                                        <option value="year">ปี</option>
                                    </select>
                                </div>
                                <div class="trend-chart" id="adminTrendChart" data-trend="<?php echo admin_h(json_encode($trendChartData, JSON_UNESCAPED_UNICODE)); ?>"></div>
                            </div>


                            <script src="https://cdn.jsdelivr.net/npm/apexcharts"></script>

                            <script>
                                document.addEventListener('DOMContentLoaded', function() {
                                    const chartEl = document.querySelector('#adminTrendChart');
                                    const rangeSelect = document.querySelector('#trendRangeSelect');

                                    if (!chartEl) return;

                                    const trendData = JSON.parse(chartEl.dataset.trend || '{}');
                                    let chart = null;

                                    function renderTrendChart(range = 'week') {
                                        const trend = trendData[range] || trendData.week || {
                                            labels: [],
                                            users: [],
                                            logs: []
                                        };

                                        if (chart) {
                                            chart.destroy();
                                        }

                                        chart = new ApexCharts(chartEl, {
                                            chart: {
                                                type: 'area',
                                                height: 300,
                                                toolbar: {
                                                    show: false
                                                },
                                                zoom: {
                                                    enabled: false
                                                }
                                            },
                                            series: [{
                                                    name: 'ผู้ใช้งาน',
                                                    data: trend.users
                                                },
                                                {
                                                    name: 'บันทึก',
                                                    data: trend.logs
                                                }
                                            ],
                                            xaxis: {
                                                categories: trend.labels,
                                                labels: {
                                                    style: {
                                                        fontFamily: 'IBM Plex Sans Thai, sans-serif'
                                                    }
                                                }
                                            },
                                            yaxis: {
                                                min: 0,
                                                tickAmount: 5,
                                                labels: {
                                                    style: {
                                                        fontFamily: 'IBM Plex Sans Thai, sans-serif'
                                                    }
                                                }
                                            },
                                            stroke: {
                                                curve: 'smooth',
                                                width: [3, 3]
                                            },
                                            colors: ['#6aa7e8', '#2fc6a3'],
                                            fill: {
                                                type: 'gradient',
                                                gradient: {
                                                    opacityFrom: 0.38,
                                                    opacityTo: 0.05
                                                }
                                            },
                                            markers: {
                                                size: 4,
                                                strokeWidth: 2,
                                                hover: {
                                                    size: 6
                                                }
                                            },
                                            legend: {
                                                show: false
                                            },
                                            grid: {
                                                borderColor: '#e5e7eb',
                                                strokeDashArray: 4
                                            },
                                            dataLabels: {
                                                enabled: false
                                            },
                                            tooltip: {
                                                shared: true,
                                                intersect: false
                                            }
                                        });

                                        chart.render();
                                    }

                                    renderTrendChart(rangeSelect ? rangeSelect.value : 'week');

                                    if (rangeSelect) {
                                        rangeSelect.addEventListener('change', function() {
                                            renderTrendChart(this.value);
                                        });
                                    }
                                });
                            </script>

                            <div class="dashboard-side-stack">
                                <div class="chart-card follow-up-card">
                                    <div class="activity-head">
                                        <div>
                                            <div class="chart-title">รายการที่ต้องติดตาม</div>
                                            <p class="panel-hint">ตรวจสอบรายการที่ยังต้องดำเนินการในระบบ</p>
                                        </div>
                                    </div>
                                    <div class="follow-up-list">
                                        <?php foreach ($dashboardFollowUps as $followUp): ?>
                                            <button type="button" class="follow-up-item mini-link-btn" data-view="<?php echo admin_h($followUp['view']); ?>">
                                                <span class="activity-icon <?php echo admin_h($followUp['tone']); ?>" aria-hidden="true"><?php echo admin_h($followUp['icon']); ?></span>
                                                <span class="activity-copy">
                                                    <strong><?php echo admin_h($followUp['title']); ?></strong>
                                                    <small><?php echo admin_h($followUp['detail']); ?></small>
                                                </span>
                                                <span class="follow-up-arrow" aria-hidden="true">›</span>
                                            </button>
                                        <?php endforeach; ?>
                                    </div>
                                </div>
                                <div class="chart-card activity-card">
                                    <div class="activity-head">
                                        <div class="chart-title">กิจกรรมล่าสุด</div>
                                        <button type="button" class="mini-link-btn" data-view="study-logs">ดูทั้งหมด</button>
                                    </div>
                                    <div class="activity-list">
                                        <?php if (count($recentActivities) === 0): ?>
                                            <div class="activity-empty">ยังไม่มีกิจกรรมล่าสุด</div>
                                        <?php else: ?>
                                            <?php foreach ($recentActivities as $activity): ?>
                                                <div class="activity-item">
                                                    <span class="activity-icon <?php echo admin_h($activity['icon_class']); ?>"><?php echo admin_h($activity['icon']); ?></span>
                                                    <span class="activity-copy">
                                                        <strong><?php echo admin_h($activity['title']); ?></strong>
                                                        <small><?php echo admin_h($activity['meta']); ?></small>
                                                    </span>
                                                    <span class="activity-time"><?php echo admin_h(admin_format_short_date($activity['time'])); ?></span>
                                                </div>
                                            <?php endforeach; ?>
                                        <?php endif; ?>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="dashboard-bottom-grid">
                            <div class="daily-table-card dashboard-schedule-card">
                                <div class="daily-head">
                                    <span class="daily-head-icon schedule">🗓️</span>
                                    <div>
                                        <h3 class="daily-table-title">ตารางเรียนและสอบในระบบ</h3>
                                        <div class="daily-head-sub">รายการที่บันทึกไว้ เรียงตามวันและเวลา</div>
                                    </div>
                                    <button type="button" class="mini-link-btn" data-view="schedules">ดูทั้งหมด <span aria-hidden="true">›</span></button>
                                </div>
                                <div class="schedule-preview-list">
                                    <?php if (count($dashboardSchedules) === 0): ?>
                                        <div class="activity-empty">ยังไม่มีตารางเรียนหรือสอบ</div>
                                    <?php else: ?>
                                        <?php foreach ($dashboardSchedules as $schedulePreview): ?>
                                            <?php
                                            $scheduleSubjectId = isset($schedulePreview['subject_id']) ? (string) $schedulePreview['subject_id'] : '';
                                            $scheduleType = admin_schedule_type_normalize($schedulePreview['schedule_type'] ?? '');
                                            ?>
                                            <div class="schedule-preview-item">
                                                <span class="schedule-preview-date"><?php echo admin_h((string) ($schedulePreview['day_of_week'] ?? '-')); ?></span>
                                                <span class="schedule-preview-copy">
                                                    <strong><?php echo admin_h($subjectsById[$scheduleSubjectId] ?? 'ไม่ระบุวิชา'); ?></strong>
                                                    <small><?php echo admin_h((string) ($schedulePreview['start_time'] ?? '--:--') . ' - ' . (string) ($schedulePreview['end_time'] ?? '--:--')); ?><?php echo !empty($schedulePreview['room']) ? ' · ' . admin_h((string) $schedulePreview['room']) : ''; ?></small>
                                                </span>
                                                <span class="badge <?php echo $scheduleType === 'exam' ? 'amber' : 'green'; ?>"><?php echo admin_h(admin_schedule_type_label($schedulePreview['schedule_type'] ?? '')); ?></span>
                                            </div>
                                        <?php endforeach; ?>
                                    <?php endif; ?>
                                </div>
                            </div>
                            <div class="daily-table-card users-latest-card">
                                <div class="daily-head">
                                    <span class="daily-head-icon">👤</span>
                                    <div>
                                        <h3 class="daily-table-title">ผู้ใช้งานล่าสุด</h3>
                                        <div class="daily-head-sub">สรุปรายชื่อผู้ใช้งานที่เพิ่มเข้ามาล่าสุด</div>
                                    </div>
                                    <button type="button" class="mini-link-btn" data-view="users">ดูทั้งหมด <span aria-hidden="true">›</span></button>
                                </div>
                                <div class="daily-table-wrap">
                                    <table class="daily-table compact-table">
                                        <thead>
                                            <tr>
                                                <th>👤 ชื่อผู้ใช้งาน</th>
                                                <th>✉️ อีเมล</th>
                                                <th>🛡️ บทบาท</th>
                                                <th>📅 วันที่เพิ่ม</th>
                                                <th></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <?php if (count($latestUsersPreview) === 0): ?>
                                                <tr>
                                                    <td colspan="5">ยังไม่มีข้อมูล</td>
                                                </tr>
                                            <?php else: ?>
                                                <?php foreach ($latestUsersPreview as $userPreview): ?>
                                                    <?php $previewRole = isset($userPreview['role']) ? strtolower((string) $userPreview['role']) : 'user'; ?>
                                                    <tr>
                                                        <td>
                                                            <div class="user-cell compact">
                                                                <span class="user-avatar"><?php echo admin_h(function_exists('mb_substr') ? mb_substr((string) $userPreview['name'], 0, 1, 'UTF-8') : substr((string) $userPreview['name'], 0, 1)); ?></span>
                                                                <span class="user-name"><?php echo admin_h($userPreview['name']); ?></span>
                                                            </div>
                                                        </td>
                                                        <td><?php echo admin_h($userPreview['email']); ?></td>
                                                        <td><span class="badge role-badge <?php echo $previewRole === 'admin' ? 'red' : 'green'; ?>"><?php echo admin_h($previewRole === 'admin' ? 'ผู้ดูแลระบบ' : 'ผู้ใช้งานทั่วไป'); ?></span></td>
                                                        <td><?php echo admin_h(admin_format_short_date(isset($userPreview['created_at']) ? $userPreview['created_at'] : '')); ?></td>
                                                        <td class="row-more-cell"><button type="button" class="row-more-btn" aria-label="เพิ่มเติม">⋮</button></td>
                                                    </tr>
                                                <?php endforeach; ?>
                                            <?php endif; ?>
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div class="daily-table-card subject-latest-card">
                                <div class="daily-head">
                                    <span class="daily-head-icon subject">📚</span>
                                    <div>
                                        <h3 class="daily-table-title">วิชาเรียนที่เพิ่มล่าสุด</h3>
                                        <div class="daily-head-sub">สรุปรายวิชาล่าสุดที่ถูกสร้างในระบบ</div>
                                    </div>
                                    <button type="button" class="mini-link-btn" data-view="subjects">ดูทั้งหมด <span aria-hidden="true">›</span></button>
                                </div>
                                <div class="daily-table-wrap">
                                    <table class="daily-table compact-table">
                                        <thead>
                                            <tr>
                                                <th>📘 วิชา</th>
                                                <th>👤 ผู้ใช้งาน</th>
                                                <th>🕘 เวลา</th>
                                                <th>📅 วันที่เริ่ม</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <?php if (count($latestSubjectsPreview) === 0): ?>
                                                <tr>
                                                    <td colspan="4">ยังไม่มีข้อมูล</td>
                                                </tr>
                                            <?php else: ?>
                                                <?php foreach ($latestSubjectsPreview as $subjectPreview): ?>
                                                    <?php $subjectOwnerId = isset($subjectPreview['user_id']) ? (string) $subjectPreview['user_id'] : ''; ?>
                                                    <tr>
                                                        <td>
                                                            <div class="subject-name-cell">
                                                                <span class="subject-icon-badge">📘</span>
                                                                <span><?php echo admin_h(isset($subjectPreview['name']) ? $subjectPreview['name'] : '-'); ?></span>
                                                            </div>
                                                        </td>
                                                        <td><?php echo admin_h($subjectOwnerId !== '' && isset($usersById[$subjectOwnerId]) ? $usersById[$subjectOwnerId] : $subjectOwnerId); ?></td>
                                                        <td><?php echo admin_h((isset($subjectPreview['start_time']) ? $subjectPreview['start_time'] : '-') . ' - ' . (isset($subjectPreview['end_time']) ? $subjectPreview['end_time'] : '-')); ?></td>
                                                        <td><?php echo admin_h(admin_format_short_date(isset($subjectPreview['start_date']) ? $subjectPreview['start_date'] : '')); ?></td>
                                                    </tr>
                                                <?php endforeach; ?>
                                            <?php endif; ?>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>

                <div class="tab-panel" data-panel="users" data-ignore-semester-filter="1">
                    <div class="table-wrap">
                        <div class="section-heading">
                            <div>
                    
                                <h3>ข้อมูลบัญชีผู้ใช้</h3>

                            </div>
                            <div class="section-metrics">
                                <div class="mini-metric">
                                    <span class="mini-label">ผู้ใช้ทั้งหมด</span>
                                    <strong><?php echo (int) $countUsers; ?></strong>
                                </div>
                                <div class="mini-metric">
                                    <span class="mini-label">ผู้ดูแล</span>
                                    <strong><?php echo (int) $adminUsersCount; ?></strong>
                                </div>

                            </div>
                        </div>
                        <table class="table user-table" data-table="users">
                            <thead>
                                <tr>
                                    <th data-field="name" data-editable="1" data-create="1">ชื่อผู้ใช้งาน</th>
                                    <th data-field="email" data-editable="1" data-create="1">อีเมล</th>
                                    <th data-field="role" data-editable="1" data-create="1">บทบาท</th>
                                    <th>สถานะ</th>
                                    <th data-field="created_at" data-editable="0" data-create="0">วันที่เพิ่ม</th>

                                </tr>
                            </thead>
                            <tbody>
                                <?php if (count($users) === 0): ?>
                                    <tr>
                                        <td colspan="5">ยังไม่มีข้อมูล</td>
                                    </tr>
                                <?php else: ?>
                                    <?php foreach ($users as $user): ?>
                                        <?php $role = isset($user['role']) ? strtolower((string) $user['role']) : 'user'; ?>
                                        <tr data-table="users" data-id="<?php echo admin_h($user['id']); ?>">
                                            <td data-field="name">
                                                <div class="user-cell">
                                                    <span class="user-avatar"><?php echo admin_h(function_exists('mb_substr') ? mb_substr((string) $user['name'], 0, 1, 'UTF-8') : substr((string) $user['name'], 0, 1)); ?></span>
                                                    <span class="user-name"><?php echo admin_h($user['name']); ?></span>
                                                </div>
                                            </td>
                                            <td data-field="email"><?php echo admin_h($user['email']); ?></td>
                                            <td data-field="role">
                                                <span class="badge role-badge <?php echo $role === 'admin' ? 'red' : 'green'; ?>"><?php echo admin_h($role === 'admin' ? 'ผู้ดูแลระบบ' : 'ผู้ใช้งานทั่วไป'); ?></span>
                                            </td>
                                            <td><span class="status-pill on">ใช้งาน</span></td>
                                            <td data-field="created_at"><?php echo admin_h(admin_format_short_date(isset($user['created_at']) ? $user['created_at'] : '')); ?></td>
                                            <td>


                                            </td>
                                        </tr>
                                    <?php endforeach; ?>
                                <?php endif; ?>
                            </tbody>
                        </table>
                    </div>
                    <div class="pager">
                        <div class="page-btn">‹</div>
                        <div class="page-current">1</div>
                        <div class="page-btn">›</div>
                    </div>
                </div>

                <div class="tab-panel" data-panel="semesters" data-ignore-user-filter="1" data-ignore-semester-filter="1">
                    <div class="table-wrap">
                        <div class="section-heading">
                            <div>
                                <h3>ข้อมูลภาคเรียนทั้งหมด</h3>
                            </div>
                            <div class="section-metrics">
                                <div class="mini-metric">
                                    <span class="mini-label">ภาคเรียนทั้งหมด</span>
                                    <strong><?php echo (int) count($semesterOptions); ?></strong>
                                </div>
                                <div class="mini-metric">
                                    <span class="mini-label">วิชาทั้งหมด</span>
                                    <strong><?php echo (int) $countSubjects; ?></strong>
                                </div>
                            </div>
                        </div>
                        <table class="table" data-table="semester">
                            <thead>
                                <tr>
                                    <th data-field="semester_id">รหัส</th>
                                    <th data-field="semester">ภาคเรียน</th>
                                    <th data-field="academic_year">ปีการศึกษา</th>
                                    <th data-field="subject_count">จำนวนวิชา</th>
                                    <th>ดู</th>
                                </tr>
                            </thead>
                            <tbody>
                                <?php if (count($semesterOptions) === 0): ?>
                                    <tr>
                                        <td colspan="5">ยังไม่มีข้อมูลภาคเรียน</td>
                                    </tr>
                                <?php else: ?>
                                    <?php foreach ($semesterOptions as $semesterOption): ?>
                                        <?php
                                        $semesterId = isset($semesterOption['id']) ? (string) $semesterOption['id'] : '';
                                        $semesterTerm = isset($semesterOption['term']) ? (string) $semesterOption['term'] : '';
                                        $semesterYear = isset($semesterOption['year']) ? (string) $semesterOption['year'] : '';
                                        $semesterRowId = $semesterId !== '' ? $semesterId : (string) ($semesterOption['key'] ?? '');
                                        ?>
                                        <tr data-table="semester" data-id="<?php echo admin_h($semesterRowId); ?>">
                                            <td data-field="semester_id"><?php echo admin_h($semesterId !== '' ? $semesterId : '-'); ?></td>
                                            <td data-field="semester"><?php echo admin_h($semesterTerm !== '' ? 'ภาคเรียนที่ ' . $semesterTerm : '-'); ?></td>
                                            <td data-field="academic_year"><?php echo admin_h($semesterYear !== '' ? $semesterYear : '-'); ?></td>
                                            <td data-field="subject_count"><?php echo (int) ($semesterSubjectCounts[$semesterId] ?? 0); ?></td>
                                            <td>
                                                <span class="tools">
                                                    <button type="button" class="tool gray">ดู</button>
                                                </span>
                                            </td>
                                        </tr>
                                    <?php endforeach; ?>
                                <?php endif; ?>
                            </tbody>
                        </table>
                    </div>
                    <div class="pager">
                        <div class="page-btn">‹</div>
                        <div class="page-current">1</div>
                        <div class="page-btn">›</div>
                    </div>
                </div>

                <div class="tab-panel" data-panel="subjects">
                    <div class="table-wrap">
                        <div class="section-heading">
                            <div>

                                <h3>ภาพรวมวิชาเรียนทั้งหมด</h3>

                            </div>
                            <div class="section-metrics">
                                <div class="mini-metric">
                                    <span class="mini-label">วิชาทั้งหมด</span>
                                    <strong><?php echo (int) $countSubjects; ?></strong>
                                </div>
                                <div class="mini-metric">
                                    <span class="mini-label">ภาคเรียน</span>
                                    <strong><?php echo (int) count($semesterOptions); ?></strong>
                                </div>
                            </div>
                        </div>
                        <?php $subjectColspan = $hasSubjectSemesterColumn ? 8 : 7; ?>
                        <table class="table" data-table="subjects">
                            <thead>
                                <tr>
                                    <th data-field="id" data-editable="0" data-create="0">รหัส</th>
                                    <th data-field="user_id" data-editable="1" data-create="1">ผู้ใช้งาน</th>
                                    <?php if ($hasSubjectSemesterColumn): ?>
                                        <th data-field="semester_id" data-editable="1" data-create="1">ภาคเรียน</th>
                                    <?php endif; ?>
                                    <th data-field="name" data-editable="1" data-create="1">วิชา</th>

                                    <th data-field="color" data-editable="1" data-create="1">สี</th>


                                    <th data-field="start_time" data-editable="1" data-create="1">เวลาเริ่ม</th>
                                    <th data-field="end_time" data-editable="1" data-create="1">เวลาสิ้นสุด</th>
                                    <th>ดู</th>
                                </tr>
                            </thead>
                            <tbody>
                                <?php if (count($subjects) === 0): ?>
                                    <tr>
                                        <td colspan="<?php echo admin_h($subjectColspan); ?>">ยังไม่มีข้อมูล</td>
                                    </tr>
                                <?php else: ?>
                                    <?php foreach ($subjects as $subject): ?>
                                        <?php
                                        $subjectUserId = $subject['user_id'];
                                        $subjectUserLabel = isset($usersById[$subjectUserId]) ? $usersById[$subjectUserId] : $subjectUserId;
                                        $subjectSemesterId = isset($subject['semester_id']) ? (string) $subject['semester_id'] : '';
                                        $subjectSemesterLabel = $subjectSemesterId !== '' && isset($semesterById[$subjectSemesterId]) ? $semesterById[$subjectSemesterId]['label'] : '';
                                        ?>
                                        <?php $subjectTermKey = admin_term_key_from_date($subject['start_date']); ?>
                                        <?php if ($hasSubjectSemesterColumn && $subjectSemesterId !== '' && isset($semesterById[$subjectSemesterId])) {
                                            $subjectTermKey = $semesterById[$subjectSemesterId]['key'];
                                        } ?>
                                        <tr data-table="subjects" data-id="<?php echo admin_h($subject['id']); ?>" data-term="<?php echo admin_h($subjectTermKey); ?>">
                                            <td data-field="id"><?php echo admin_h($subject['id']); ?></td>
                                            <td data-field="user_id" data-value="<?php echo admin_h($subjectUserId); ?>">
                                                <?php echo admin_h($subjectUserLabel); ?>
                                            </td>
                                            <?php if ($hasSubjectSemesterColumn): ?>
                                                <td data-field="semester_id" data-value="<?php echo admin_h($subjectSemesterId); ?>">
                                                    <?php echo admin_h($subjectSemesterLabel !== '' ? $subjectSemesterLabel : $subjectSemesterId); ?>
                                                </td>
                                            <?php endif; ?>
                                            <td data-field="name"><?php echo admin_h($subject['name']); ?></td>

                                            <td data-field="color">
                                                <?php $color = isset($subject['color']) ? (string) $subject['color'] : ''; ?>
                                                <span class="badge" style="background:<?php echo admin_h($color !== '' ? $color : '#64748b'); ?>;"><?php echo admin_h($color); ?></span>
                                            </td>


                                            <td data-field="start_time"><?php echo admin_h($subject['start_time']); ?></td>
                                            <td data-field="end_time"><?php echo admin_h($subject['end_time']); ?></td>
                                            <td>
                                                <span class="tools">
                                                    <button type="button" class="tool gray">ดู</button>
                                                </span>
                                            </td>
                                        </tr>
                                    <?php endforeach; ?>
                                <?php endif; ?>
                            </tbody>
                        </table>
                    </div>
                    <div class="pager">
                        <div class="page-btn">‹</div>
                        <div class="page-current">1</div>
                        <div class="page-btn">›</div>
                    </div>
                </div>

                <div class="tab-panel" data-panel="schedules">
                    <div class="table-wrap">
                        <div class="section-heading">
                            <div>
                             
                                <h3>ตารางเรียนและตารางสอบทั้งหมด</h3>

                            </div>
                            <div class="section-metrics">
                                <div class="mini-metric">
                                    <span class="mini-label">ตารางทั้งหมด</span>
                                    <strong><?php echo (int) $countSchedules; ?></strong>
                                </div>
                                <div class="mini-metric">
                                    <span class="mini-label">คาบเรียน</span>
                                    <strong><?php echo (int) $classSchedulesCount; ?></strong>
                                </div>
                                <div class="mini-metric">
                                    <span class="mini-label">สอบ/พิเศษ</span>
                                    <strong><?php echo (int) $examSchedulesCount; ?></strong>
                                </div>
                            </div>
                        </div>
                        <table class="table" data-table="schedules">
                            <thead>
                                <tr>
                                    <th data-field="id" data-editable="0" data-create="0">รหัส</th>
                                    <th data-field="user_id" data-editable="1" data-create="1">ผู้ใช้งาน</th>
                                    <th data-field="subject_id" data-editable="1" data-create="1">วิชา</th>
                                    <th data-field="day_of_week" data-editable="1" data-create="1">วัน</th>
                                    <th data-field="start_time" data-editable="1" data-create="1">เวลาเริ่ม</th>
                                    <th data-field="end_time" data-editable="1" data-create="1">เวลาสิ้นสุด</th>
                                    <th data-field="room" data-editable="1" data-create="1">ห้อง</th>
                                    <th data-field="schedule_type" data-editable="1" data-create="1">ประเภท</th>

                                    <th>ดู</th>
                                </tr>
                            </thead>
                            <tbody>
                                <?php if (count($schedules) === 0): ?>
                                    <tr>
                                        <td colspan="8">ยังไม่มีข้อมูล</td>
                                    </tr>
                                <?php else: ?>
                                    <?php $scheduleNo = 1; ?>

                                    <?php foreach ($schedules as $schedule): ?>
                                        <?php
                                        $scheduleUserId = $schedule['user_id'];
                                        $scheduleSubjectId = $schedule['subject_id'];
                                        $scheduleUserLabel = isset($usersById[$scheduleUserId]) ? $usersById[$scheduleUserId] : $scheduleUserId;
                                        $scheduleSubjectLabel = isset($subjectsById[$scheduleSubjectId]) ? $subjectsById[$scheduleSubjectId] : $scheduleSubjectId;
                                        $scheduleTermKey = '';
                                        if (isset($schedule['term_key']) && $schedule['term_key'] !== '') {
                                            $scheduleTermKey = $schedule['term_key'];
                                        } elseif (isset($schedule['term']) && $schedule['term'] !== '') {
                                            $scheduleTermKey = $schedule['term'];
                                        } elseif (isset($subjectTermsById[$scheduleSubjectId])) {
                                            $scheduleTermKey = $subjectTermsById[$scheduleSubjectId];
                                        }
                                        ?>


                                        <tr data-table="schedules" data-id="<?php echo admin_h($schedule['id']); ?>" data-term="<?php echo admin_h($scheduleTermKey); ?>">
                                            <td data-field="id"><?php echo $scheduleNo++; ?></td>
                                            <td data-field="user_id" data-value="<?php echo admin_h($scheduleUserId); ?>">
                                                <?php echo admin_h($scheduleUserLabel); ?>
                                            </td>
                                            <td data-field="subject_id" data-value="<?php echo admin_h($scheduleSubjectId); ?>">
                                                <?php echo admin_h($scheduleSubjectLabel); ?>
                                            </td>
                                            <td data-field="day_of_week"><?php echo admin_h($schedule['day_of_week']); ?></td>
                                            <td data-field="start_time"><?php echo admin_h($schedule['start_time']); ?></td>
                                            <td data-field="end_time"><?php echo admin_h($schedule['end_time']); ?></td>
                                            <td data-field="room"><?php echo admin_h($schedule['room']); ?></td>
                                            <td data-field="schedule_type">
                                                <?php $type = isset($schedule['schedule_type']) ? (string) $schedule['schedule_type'] : ''; ?>
                                                <?php $normalizedType = admin_schedule_type_normalize($type); ?>
                                                <span class="badge <?php echo $normalizedType === 'exam' ? 'amber' : 'green'; ?>"><?php echo admin_h(admin_schedule_type_label($type)); ?></span>
                                            </td>

                                            <td>
                                                <span class="tools">
                                                    <button type="button" class="tool gray">ดู</button>
                                                </span>
                                            </td>
                                        </tr>
                                    <?php endforeach; ?>
                                <?php endif; ?>
                            </tbody>
                        </table>
                    </div>
                    <div class="pager">
                        <div class="page-btn">‹</div>
                        <div class="page-current">1</div>
                        <div class="page-btn">›</div>
                    </div>
                </div>

                <div class="tab-panel" data-panel="study-logs">
                    <div class="table-wrap">
                        <div class="section-heading">
                            <div>
                              
                                <h3>สรุปบันทึกการเรียนของผู้ใช้</h3>

                            </div>
                            <div class="section-metrics">
                                <div class="mini-metric">
                                    <span class="mini-label">บันทึกทั้งหมด</span>
                                    <strong><?php echo (int) $countStudyLogs; ?></strong>
                                </div>
                            </div>
                        </div>
                        <table class="table" data-table="study_logs">
                            <thead>
                                <tr>
                                    <th data-field="id" data-editable="0" data-create="0">รหัส</th>
                                    <th data-field="user_id" data-editable="1" data-create="1">ผู้ใช้งาน</th>
                                    <th data-field="subject_id" data-editable="1" data-create="1">วิชา</th>
                                    <th data-field="title" data-editable="1" data-create="1">หัวข้อ</th>
                                    <th data-field="log_date" data-editable="1" data-create="1">วันที่</th>
                                    <th>ดู</th>
                                </tr>
                            </thead>
                            <tbody>
                                <?php if (count($studyLogs) === 0): ?>
                                    <tr>
                                        <td colspan="5">ยังไม่มีข้อมูล</td>
                                    </tr>
                                <?php else: ?>
                                    <?php foreach ($studyLogs as $log): ?>
                                        <?php
                                        $logUserId = $log['user_id'];
                                        $logSubjectId = $log['subject_id'];
                                        $logUserLabel = isset($usersById[$logUserId]) ? $usersById[$logUserId] : $logUserId;
                                        $logSubjectLabel = isset($subjectsById[$logSubjectId]) ? $subjectsById[$logSubjectId] : $logSubjectId;
                                        $logTermKey = $subjectTermsById[$logSubjectId] ?? admin_term_key_from_date($log['log_date']);
                                        ?>
                                        <tr data-table="study_logs" data-id="<?php echo admin_h($log['id']); ?>" data-term="<?php echo admin_h($logTermKey); ?>">
                                            <td data-field="id"><?php echo admin_h($log['id']); ?></td>
                                            <td data-field="user_id" data-value="<?php echo admin_h($logUserId); ?>">
                                                <?php echo admin_h($logUserLabel); ?>
                                            </td>
                                            <td data-field="subject_id" data-value="<?php echo admin_h($logSubjectId); ?>">
                                                <?php echo admin_h($logSubjectLabel); ?>
                                            </td>
                                            <td data-field="title"><?php echo admin_h($log['title']); ?></td>
                                            <td data-field="log_date"><?php echo admin_h(admin_format_short_date($log['log_date'] ?? '')); ?></td>
                                            <td>
                                                <span class="tools">
                                                    <button type="button" class="tool gray">ดู</button>
                                                </span>
                                            </td>
                                        </tr>
                                    <?php endforeach; ?>
                                <?php endif; ?>
                            </tbody>
                        </table>
                    </div>
                    <div class="pager">
                        <div class="page-btn">‹</div>
                        <div class="page-current">1</div>
                        <div class="page-btn">›</div>
                    </div>
                </div>

                <div class="tab-panel" data-panel="quizzes">
                    <div class="table-wrap">
                        <div class="section-heading">
                            <div><h3>แบบฝึกหัดและแบบทดสอบ</h3></div>
                            <div class="section-metrics"><div class="mini-metric"><span class="mini-label">ทั้งหมด</span><strong><?php echo (int) $countQuizzes; ?></strong></div></div>
                        </div>
                        <table class="table" data-table="quizzes">
                            <thead><tr><th data-field="id">รหัส</th><th data-field="user_id">ผู้ใช้งาน</th><th data-field="subject_id">วิชา</th><th data-field="title">ชื่อแบบฝึกหัด</th><th data-field="ai_model">รูปแบบ</th><th data-field="created_at">วันที่สร้าง</th><th>ดู</th></tr></thead>
                            <tbody>
                                <?php if (count($quizzes) === 0): ?>
                                    <tr><td colspan="7">ยังไม่มีข้อมูลแบบฝึกหัด</td></tr>
                                <?php else: foreach ($quizzes as $quiz): ?>
                                    <?php
                                    $quizSubjectId = (string) ($quiz['subject_id'] ?? '');
                                    $quizUserId = $subjectUserIdsById[$quizSubjectId] ?? '';
                                    $quizUserLabel = $quizUserId !== '' ? ($usersById[$quizUserId] ?? $quizUserId) : '-';
                                    $quizTermKey = $subjectTermsById[$quizSubjectId] ?? '';
                                    ?>
                                    <tr data-table="quizzes" data-id="<?php echo admin_h($quiz['id']); ?>" data-term="<?php echo admin_h($quizTermKey); ?>">
                                        <td data-field="id"><?php echo admin_h($quiz['id']); ?></td>
                                        <td data-field="user_id" data-value="<?php echo admin_h($quizUserId); ?>"><?php echo admin_h($quizUserLabel); ?></td>
                                        <td data-field="subject_id" data-value="<?php echo admin_h($quizSubjectId); ?>"><?php echo admin_h($subjectsById[$quizSubjectId] ?? $quizSubjectId); ?></td>
                                        <td data-field="title"><?php echo admin_h($quiz['title']); ?></td>
                                        <td data-field="ai_model"><?php echo admin_h($quiz['ai_model'] ?: '-'); ?></td>
                                        <td data-field="created_at"><?php echo admin_h(admin_format_short_date($quiz['created_at'] ?? '')); ?></td>
                                        <td><span class="tools"><button type="button" class="tool gray">ดู</button></span></td>
                                    </tr>
                                <?php endforeach; endif; ?>
                            </tbody>
                        </table>
                    </div>
                    <div class="pager">
                        <div class="page-btn">‹</div>
                        <div class="page-current">1</div>
                        <div class="page-btn">›</div>
                    </div>
                </div>

                <div class="tab-panel" data-panel="goals">
                    <div class="table-wrap">
                        <div class="section-heading">
                            
                            <div class="section-metrics">
                                <div class="mini-metric"><span class="mini-label">เป้าหมายทั้งหมด</span><strong><?php echo (int) $goalProgressCount; ?></strong></div>
                                <div class="mini-metric"><span class="mini-label">สำเร็จแล้ว</span><strong><?php echo (int) $completedGoalsCount; ?></strong></div>
                                <div class="mini-metric"><span class="mini-label">ความคืบหน้าเฉลี่ย</span><strong><?php echo (int) $averageGoalProgress; ?>%</strong></div>
                            </div>
                        </div>
                        <table class="table" data-table="learning_goal_targets">
                            <thead><tr><th>ผู้ใช้งาน</th><th>เป้าหมาย</th><th>วันที่บันทึก</th><th>ผลการทำ</th><th>ความคืบหน้า</th><th>สถานะ</th></tr></thead>
                            <tbody>
                                <?php if (count($learningGoals) === 0): ?>
                                    <tr><td colspan="6">ยังไม่มีข้อมูลเป้าหมายการเรียน</td></tr>
                                <?php else: foreach ($learningGoals as $goal): ?>
                                    <?php
                                    $goalUserId = (string) ($goal['user_id'] ?? '');
                                    $goalSubjectId = (string) ($goal['subject_id'] ?? '');
                                    $goalTermKey = $goal['term_key'] ?? ($subjectTermsById[$goalSubjectId] ?? admin_term_key_from_date($goal['period_start'] ?? ''));
                                    $goalStatus = (string) ($goal['status'] ?? 'pending');
                                    ?>
                                    <tr data-id="<?php echo admin_h($goal['id']); ?>" data-term="<?php echo admin_h($goalTermKey); ?>" data-progress="<?php echo (int) $goal['progress_percent']; ?>" data-completed="<?php echo $goalStatus === 'completed' ? '1' : '0'; ?>">
                                        <td data-field="user_id" data-value="<?php echo admin_h($goalUserId); ?>"><?php echo admin_h($usersById[$goalUserId] ?? $goalUserId); ?></td>
                                        <td><?php echo admin_h(($goal['title'] ?? '') !== '' ? $goal['title'] : 'เป้าหมายการเรียน'); ?></td>
                                        <td><?php echo admin_h(admin_format_short_date($goal['period_start'] ?? '')); ?></td>
                                        <td><?php echo (int) ($goal['current_value'] ?? 0); ?> / <?php echo (int) ($goal['target_value'] ?? 0); ?></td>
                                        <td><strong><?php echo (int) $goal['progress_percent']; ?>%</strong></td>
                                        <td><span class="status-pill <?php echo $goalStatus === 'completed' ? 'on' : ''; ?>"><?php echo admin_h($goalStatus === 'completed' ? 'สำเร็จ' : ($goalStatus === 'failed' ? 'ไม่สำเร็จ' : 'กำลังดำเนินการ')); ?></span></td>
                                    </tr>
                                <?php endforeach; endif; ?>
                            </tbody>
                        </table>
                    </div>
                </div>

                <div class="tab-panel" data-panel="settings">
                    <div class="table-wrap">
                        <div class="settings-shell">
                            <div class="settings-card">
                                <div class="settings-topbar">
                                    <div>
                                        <h3 class="settings-title">ตั้งค่าระบบผู้ดูแล</h3>

                                    </div>
                                    <button class="settings-sync-btn" type="button" id="syncSettingsBtn">ซิงค์ข้อมูล</button>
                                </div>

                                <div class="settings-body">
                                    <div class="field">
                                        <label for="settingSystemName">ชื่อระบบหลัก</label>
                                        <input type="text" id="settingSystemName" placeholder="เช่น ระบบติดตามการเรียนรู้สำหรับผู้ดูแล">
                                    </div>
                                    <div class="field">
                                        <label for="settingContactEmail">อีเมลติดต่อระบบ</label>
                                        <input type="email" id="settingContactEmail" placeholder="เช่น admin@school.ac.th">
                                    </div>
                                    <div class="field wide">
                                        <label for="settingWelcomeMessage">ข้อความต้อนรับผู้ดูแลระบบ</label>
                                        <textarea id="settingWelcomeMessage" rows="4" placeholder="เช่น ยินดีต้อนรับเข้าสู่ระบบจัดการ"></textarea>
                                    </div>
                                    <div class="field wide settings-maintenance">
                                        <div class="settings-maintenance-meta">
                                            <span class="settings-maintenance-icon">⚡</span>
                                            <div>
                                                <h4>โหมดซ่อมบำรุง</h4>

                                            </div>
                                        </div>
                                        <button class="settings-switch" type="button" id="settingMaintenanceSwitch" aria-pressed="false" title="สลับโหมดซ่อมบำรุง">
                                            <span class="settings-switch-dot"></span>
                                        </button>
                                        <select id="settingMaintenanceMode" class="settings-hidden-select" aria-hidden="true">
                                            <option value="0">ปิด</option>
                                            <option value="1">เปิด</option>
                                        </select>
                                    </div>
                                    <div class="field wide maintenance-schedule">
                                        <h4 class="maintenance-schedule-title"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></svg>กำหนดช่วงเวลาซ่อมบำรุงระบบ</h4>
                                        <div class="maintenance-schedule-grid">
                                            <div class="maintenance-schedule-column" role="group" aria-labelledby="maintenanceStartTitle">
                                                <h5 id="maintenanceStartTitle">เริ่มต้นการซ่อมบำรุง</h5>
                                                <label for="settingMaintenanceStartDate">วันที่</label>
                                                <div class="admin-date-picker">
                                                    <input type="text" id="settingMaintenanceStartDate" inputmode="numeric" autocomplete="off" placeholder="dd/mm/yy" maxlength="8" aria-describedby="settingMaintenanceStartDateHint">
                                                    <button type="button" class="admin-date-picker-button" id="settingMaintenanceStartDatePicker" aria-label="เลือกวันที่จากปฏิทิน" title="เลือกวันที่จากปฏิทิน">
                                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M8 2.5v4M16 2.5v4M3 9.5h18"/></svg>
                                                    </button>
                                                    <input type="date" id="settingMaintenanceStartNativeDate" class="admin-date-picker-native" tabindex="-1" aria-hidden="true">
                                                </div>
                                                
                                                <label for="settingMaintenanceStartHour">เวลา</label>
                                                <div class="admin-time-picker">
                                                    <select id="settingMaintenanceStartHour" aria-label="ชั่วโมงเริ่มต้นการซ่อมบำรุง">
                                                        <option value="">--</option>
                                                        <?php for ($hour = 0; $hour < 24; $hour++): ?>
                                                            <option value="<?php echo str_pad((string) $hour, 2, '0', STR_PAD_LEFT); ?>"><?php echo str_pad((string) $hour, 2, '0', STR_PAD_LEFT); ?></option>
                                                        <?php endfor; ?>
                                                    </select>
                                                    <span aria-hidden="true">:</span>
                                                    <select id="settingMaintenanceStartMinute" aria-label="นาทีเริ่มต้นการซ่อมบำรุง">
                                                        <option value="">--</option>
                                                        <?php for ($minute = 0; $minute < 60; $minute++): ?>
                                                            <option value="<?php echo str_pad((string) $minute, 2, '0', STR_PAD_LEFT); ?>"><?php echo str_pad((string) $minute, 2, '0', STR_PAD_LEFT); ?></option>
                                                        <?php endfor; ?>
                                                    </select>
                                                    <input type="hidden" id="settingMaintenanceStartTime">
                                                </div>
                                                <input type="hidden" id="settingMaintenanceStartAt">
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div class="settings-actions">
                                    <button class="btn primary" type="button" id="saveSettingsBtn">บันทึกการตั้งค่า</button>
                                    <button class="settings-reset-btn" type="button" id="resetSettingsBtn">โหลดค่าล่าสุด</button>
                                    <span id="settingsStatus" class="settings-status">พร้อมใช้งาน</span>
                                </div>

                            </div>
                        </div>
                    </div>
                </div>

                <div class="tab-panel" data-panel="profile">
                    <div class="table-wrap">
                        <div class="profile-shell">
                            <div class="profile-card profile-summary-card">
                                <div class="profile-hero">
                                    <div class="profile-avatar"><?php echo admin_h($adminProfileInitial); ?></div>
                                    <div class="profile-identity">
                                        <div class="section-kicker">โปรไฟล์ผู้ดูแล</div>
                                        <h3><?php echo admin_h(isset($currentAdminProfile['name']) ? $currentAdminProfile['name'] : 'ผู้ดูแล'); ?></h3>
                                        <p>ข้อมูลบัญชีผู้ดูแลระบบที่กำลังเข้าสู่ระบบอยู่ในขณะนี้</p>
                                    </div>
                                </div>
                                <div class="profile-stat-grid">
                                    <div class="mini-metric">
                                        <span class="mini-label">สิทธิ์</span>
                                        <strong><?php echo admin_h(((string) ($currentAdminProfile['role'] ?? 'admin')) === 'admin' ? 'ผู้ดูแลระบบ' : 'ผู้ใช้งานทั่วไป'); ?></strong>
                                    </div>
                                    <div class="mini-metric">
                                        <span class="mini-label">เข้าร่วมเมื่อ</span>
                                        <strong><?php echo admin_h($adminJoinedLabel); ?></strong>
                                    </div>
                                    <div class="mini-metric">
                                        <span class="mini-label">กิจกรรมล่าสุด</span>
                                        <strong><?php echo admin_h($latestActivityLabel); ?></strong>
                                    </div>
                                </div>
                            </div>

                            <div class="profile-grid">
                                <div class="profile-card">
                                    <div class="profile-card-head">
                                        <h4>ข้อมูลบัญชี</h4>
                                        <span>ข้อมูลจริงจากระบบ</span>
                                    </div>
                                    <div class="profile-field-list">
                                        <div class="profile-field">
                                            <label>รหัสผู้ใช้</label>
                                            <div><?php echo admin_h(isset($currentAdminProfile['id']) ? $currentAdminProfile['id'] : '-'); ?></div>
                                        </div>
                                        <div class="profile-field">
                                            <label>ชื่อผู้ใช้</label>
                                            <div><?php echo admin_h(isset($currentAdminProfile['name']) ? $currentAdminProfile['name'] : 'ผู้ดูแล'); ?></div>
                                        </div>
                                        <div class="profile-field">
                                            <label>อีเมล</label>
                                            <div><?php echo admin_h(isset($currentAdminProfile['email']) && trim((string) $currentAdminProfile['email']) !== '' ? $currentAdminProfile['email'] : 'ยังไม่มีข้อมูล'); ?></div>
                                        </div>
                                        <div class="profile-field">
                                            <label>ประเภทบัญชี</label>
                                            <div><?php echo admin_h(((string) ($currentAdminProfile['role'] ?? 'admin')) === 'admin' ? 'ผู้ดูแลระบบหลัก' : 'ผู้ใช้งานทั่วไป'); ?></div>
                                        </div>
                                    </div>
                                </div>

                                <div class="profile-card">
                                    <div class="profile-card-head">
                                        <h4>สรุปการดูแลระบบ</h4>
                                        <span>ภาพรวมที่เกี่ยวข้องกับการจัดการ</span>
                                    </div>
                                    <div class="profile-stat-grid compact">
                                        <div class="mini-metric">
                                            <span class="mini-label">ผู้ใช้ในระบบ</span>
                                            <strong><?php echo (int) $countUsers; ?></strong>
                                        </div>
                                        <div class="mini-metric">
                                            <span class="mini-label">วิชาทั้งหมด</span>
                                            <strong><?php echo (int) $countSubjects; ?></strong>
                                        </div>
                                        <div class="mini-metric">
                                            <span class="mini-label">ตารางเรียน</span>
                                            <strong><?php echo (int) $countSchedules; ?></strong>
                                        </div>
                                        <div class="mini-metric">
                                            <span class="mini-label">บันทึกการเรียน</span>
                                            <strong><?php echo (int) $countStudyLogs; ?></strong>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </main>
    </div>

    <div class="modal-backdrop" id="editModal">
        <div class="modal">
            <div class="modal-header">
                <div class="modal-heading">
                    <div class="modal-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                        </svg>
                    </div>
                    <div>
                        <div class="modal-title">แก้ไขข้อมูล</div>
                        <div class="modal-subtitle">ปรับรายละเอียดรายการที่เลือก</div>
                    </div>
                </div>
                <button class="modal-close" type="button" id="closeModal" aria-label="ปิด">
                    <span aria-hidden="true">×</span>
                </button>
            </div>
            <form class="modal-body" id="editForm"></form>
            <div class="modal-footer">
                <button class="btn secondary" type="button" id="cancelEdit">ยกเลิก</button>
                <button class="btn primary" type="button" id="saveEdit">บันทึก</button>
            </div>
        </div>
    </div>

    <div class="modal-backdrop" id="viewModal">
        <div class="modal">
            <div class="modal-header">
                <div class="modal-heading">
                    <div class="modal-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                            <path d="M14 2v6h6" />
                            <path d="M9 13h6" />
                            <path d="M9 17h6" />
                            <path d="M9 9h1" />
                        </svg>
                    </div>
                    <div>
                        <div class="modal-title">รายละเอียดข้อมูล</div>
                        <div class="modal-subtitle">รหัสอ้างอิง: <span id="viewReference">-</span></div>
                    </div>
                </div>
                <button class="modal-close" type="button" id="closeViewModal" aria-label="ปิด">
                    <span aria-hidden="true">×</span>
                </button>
            </div>
            <div class="modal-body" id="viewBody"></div>
            <div class="modal-footer">
                <button class="btn secondary" type="button" id="closeView">ปิดหน้าต่าง</button>
            </div>
        </div>
    </div>

    <div class="modal-backdrop" id="addModal">
        <div class="modal">
            <div class="modal-header">
                <div class="modal-heading">
                    <div class="modal-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 5v14" />
                            <path d="M5 12h14" />
                        </svg>
                    </div>
                    <div>
                        <div class="modal-title">เพิ่มรายการใหม่</div>
                        <div class="modal-subtitle">กรอกข้อมูลสำหรับรายการใหม่</div>
                    </div>
                </div>
                <button class="modal-close" type="button" id="closeAddModal" aria-label="ปิด">
                    <span aria-hidden="true">×</span>
                </button>
            </div>
            <form class="modal-body" id="addForm"></form>
            <div class="modal-footer">
                <button class="btn secondary" type="button" id="cancelAdd">ยกเลิก</button>
                <button class="btn primary" type="button" id="saveAdd">บันทึก</button>
            </div>
        </div>
    </div>

    <div class="modal-backdrop" id="deleteConfirmModal">
        <div class="modal delete-confirm-modal">
            <div class="modal-header">
                <div class="modal-heading">
                    <div class="modal-icon danger" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 6h18" />
                            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            <path d="M10 11v6" />
                            <path d="M14 11v6" />
                        </svg>
                    </div>
                    <div>
                        <div class="modal-title">ลบรายการ</div>
                        <div class="modal-subtitle">ยืนยันก่อนลบข้อมูลที่เลือก</div>
                    </div>
                </div>
                <button class="modal-close" type="button" id="closeDeleteConfirmModal" aria-label="ปิด">
                    <span aria-hidden="true">×</span>
                </button>
            </div>
            <div class="modal-body delete-confirm-body">
                <div class="delete-confirm-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 6h18" />
                        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    </svg>
                </div>
                <div class="delete-confirm-text">
                    <h3>คุณต้องการลบรายการนี้หรือไม่?</h3>
                    <p>การลบจะไม่สามารถกู้คืนได้หลังจากยืนยัน</p>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn secondary" type="button" id="cancelDeleteConfirm">ยกเลิก</button>
                <button class="btn primary danger" type="button" id="confirmDeleteBtn">ลบเลย</button>
            </div>
        </div>
    </div>

    <?php
    $semesterFieldOptions = [];
    if ($hasSubjectSemesterColumn) {
        foreach ($semesterOptions as $semesterOption) {
            $optionValue = isset($semesterOption['id']) ? (string) $semesterOption['id'] : '';
            if ($optionValue === '') {
                continue;
            }
            $semesterFieldOptions[] = [
                'value' => $optionValue,
                'label' => isset($semesterOption['label']) ? (string) $semesterOption['label'] : $optionValue,
            ];
        }
    }
    ?>
    <script>
        const currentDateTime = document.getElementById('currentDateTime');
        const dateFormatter = new Intl.DateTimeFormat('th-TH', {
            weekday: 'long',
            day: '2-digit',
            month: 'long',
            year: 'numeric',
            timeZone: 'Asia/Bangkok'
        });
        const timeFormatter = new Intl.DateTimeFormat('th-TH', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
            timeZone: 'Asia/Bangkok'
        });
        const renderDateTime = () => {
            const now = new Date();
            const formatted = `${dateFormatter.format(now)} เวลา ${timeFormatter.format(now)} น.`;
            if (currentDateTime) {
                currentDateTime.textContent = formatted;
            }
        };
        renderDateTime();
        window.setInterval(renderDateTime, 1000);

        const panels = document.querySelectorAll('.tab-panel');
        const navLinks = document.querySelectorAll('.nav a[data-nav]');
        const cardTitle = document.getElementById('cardTitle');
        const cardSubtitle = document.getElementById('cardSubtitle');
        const panelKicker = document.getElementById('panelKicker');
        const mainPanelHeader = document.getElementById('mainPanelHeader');
        const mainPanelToolbar = document.getElementById('mainPanelToolbar');
        const userFilter = document.getElementById('userFilter');
        const semesterFilter = document.getElementById('semesterFilter');
        const trendRangeSelect = document.getElementById('trendRangeSelect');
        const selectOptions = {
            user_id: <?php echo json_encode($userFieldOptions, JSON_UNESCAPED_UNICODE); ?>,
            subject_id: <?php echo json_encode($subjectFieldOptions, JSON_UNESCAPED_UNICODE); ?>,
            semester_id: <?php echo json_encode($semesterFieldOptions, JSON_UNESCAPED_UNICODE); ?>,
            role: [{
                    value: 'admin',
                    label: 'ผู้ดูแลระบบ'
                },
                {
                    value: 'user',
                    label: 'ผู้ใช้งานทั่วไป'
                }
            ],
            schedule_type: [{
                    value: 'class',
                    label: 'คาบเรียน'
                },
                {
                    value: 'exam',
                    label: 'สอบหรือกิจกรรมพิเศษ'
                }
            ]
        };

        const navConfig = {
            dashboard: {
                title: 'ตารางแสดงรายการ (ผู้ดูแลระบบ)',
                subtitle: 'ภาพรวมข้อมูลจริงของผู้ใช้ วิชา ตารางเรียน และบันทึกการเรียน',
                kicker: 'ผู้ดูแลระบบ',


                panel: 'dashboard',
                showToolbar: true
            },
            users: {
                title: 'ผู้ใช้งาน',


                panel: 'users',
                showToolbar: true
            },
            semesters: {
                title: 'ภาคเรียน',
                subtitle: 'ข้อมูลภาคเรียนและจำนวนวิชาที่อยู่ในแต่ละภาคเรียน',
                panel: 'semesters',
                showToolbar: false
            },
            subjects: {
                title: 'วิชาเรียน',


                panel: 'subjects',
                showToolbar: true
            },
            schedules: {
                title: 'ตารางเรียน',


                panel: 'schedules',
                showToolbar: true
            },
            'study-logs': {
                title: 'สรุปการเรียน',


                panel: 'study-logs',
                showToolbar: true
            },
            quizzes: {
                title: 'แบบฝึกหัด',
                panel: 'quizzes',
                showToolbar: true
            },
            goals: {
                title: 'ติดตามเป้าหมาย',
                subtitle: 'ดูเป้าหมายและสถานะการทำกิจกรรมของผู้ใช้',
                panel: 'goals',
                showToolbar: true
            },
            profile: {
                title: 'โปรไฟล์และข้อมูลระบบ',
                subtitle: 'ข้อมูลบัญชีผู้ดูแลและภาพรวมภายในระบบ',
                panel: 'profile',
                showToolbar: false
            },
            settings: {
                title: 'ตั้งค่าระบบ',


                panel: 'settings',
                showToolbar: false
            }
        };

        const dashboardUsersLabel = document.getElementById('dashboardUsersLabel');
        const dashboardUsersValue = document.getElementById('dashboardUsersValue');
        const dashboardUsersSub = document.getElementById('dashboardUsersSub');
        const dashboardSubjectsValue = document.getElementById('dashboardSubjectsValue');
        const dashboardSubjectsSub = document.getElementById('dashboardSubjectsSub');
        const dashboardSchedulesValue = document.getElementById('dashboardSchedulesValue');
        const dashboardSchedulesSub = document.getElementById('dashboardSchedulesSub');
        const dashboardChartTitle = document.getElementById('dashboardChartTitle');
        const dashboardUsersBarValue = document.getElementById('dashboardUsersBarValue');
        const dashboardSubjectsBarValue = document.getElementById('dashboardSubjectsBarValue');
        const dashboardSchedulesBarValue = document.getElementById('dashboardSchedulesBarValue');
        const dashboardUsersBar = document.getElementById('dashboardUsersBar');
        const dashboardSubjectsBar = document.getElementById('dashboardSubjectsBar');
        const dashboardSchedulesBar = document.getElementById('dashboardSchedulesBar');
        const dashboardUsersMiniBar = document.getElementById('dashboardUsersMiniBar');
        const dashboardSubjectsMiniBar = document.getElementById('dashboardSubjectsMiniBar');
        const dashboardSchedulesMiniBar = document.getElementById('dashboardSchedulesMiniBar');
        const dashboardMiniBars = [
            dashboardUsersMiniBar,
            dashboardSubjectsMiniBar,
            dashboardSchedulesMiniBar
        ].filter(Boolean);

        const getSelectedUserName = () => {
            if (!userFilter) return '';
            const selectedOption = userFilter.options[userFilter.selectedIndex];
            if (!selectedOption) return '';
            return (selectedOption.textContent || '').trim();
        };

        const getSelectedSemesterName = () => {
            if (!semesterFilter) return '';
            const selectedOption = semesterFilter.options[semesterFilter.selectedIndex];
            if (!selectedOption) return '';
            return (selectedOption.textContent || '').trim();
        };

        const rowMatchesFilters = (row, selectedUser, selectedSemester) => {
            if (!row || !row.dataset || !row.dataset.id) {
                return false;
            }
            let matchesUser = true;
            if (selectedUser !== '') {
                const userCell = row.querySelector('td[data-field="user_id"]');
                const idCell = row.querySelector('td[data-field="id"]');
                // const cellValue = userCell ? (userCell.dataset.value || userCell.textContent.trim()) : (idCell ? idCell.textContent.trim() : '');



                const cellValue = userCell ?
                    (userCell.dataset.value || userCell.textContent.trim()) :
                    (idCell ? idCell.textContent.trim() : (row.dataset.id || ''));




                matchesUser = cellValue === selectedUser;
            }
            const matchesSemester = selectedSemester === '' || (row.dataset.term || '') === selectedSemester;
            return matchesUser && matchesSemester;
        };

        const countMatchingRows = (panelKey) => {
            const panel = document.querySelector(`.tab-panel[data-panel="${panelKey}"]`);
            if (!panel) return 0;
            const rows = panel.querySelectorAll('tbody tr[data-id]');
            const selectedUser = userFilter ? userFilter.value : '';
            const selectedSemester = semesterFilter ? semesterFilter.value : '';
            let count = 0;
            rows.forEach((row) => {
                if (rowMatchesFilters(row, selectedUser, selectedSemester)) {
                    count += 1;
                }
            });
            return count;
        };

        const refreshDashboardOverview = () => {
            const selectedUser = userFilter ? userFilter.value : '';
            const selectedUserName = selectedUser !== '' ? getSelectedUserName() : '';
            const selectedSemester = semesterFilter ? semesterFilter.value : '';
            const selectedSemesterName = selectedSemester !== '' ? getSelectedSemesterName() : '';

            const usersCount = selectedUser !== '' ? 1 : <?php echo (int) $countUsers; ?>;
            const subjectsCount = countMatchingRows('subjects');
            const schedulesCount = countMatchingRows('schedules');

            if (dashboardUsersLabel) {
                dashboardUsersLabel.textContent = selectedUser !== '' ? 'ผู้ใช้งานที่เลือก' : 'ผู้ใช้ทั้งหมด';
            }
            if (dashboardUsersValue) dashboardUsersValue.textContent = String(usersCount);
            if (dashboardSubjectsValue) dashboardSubjectsValue.textContent = String(subjectsCount);
            if (dashboardSchedulesValue) dashboardSchedulesValue.textContent = String(schedulesCount);

            if (dashboardUsersSub) {
                dashboardUsersSub.textContent = selectedUserName !== '' ? selectedUserName : 'คนในระบบ';
            }
            if (dashboardSubjectsSub) {
                dashboardSubjectsSub.textContent = selectedUser !== '' || selectedSemester !== '' ? 'วิชาตามตัวกรอง' : 'วิชาที่บันทึกไว้';
            }
            if (dashboardSchedulesSub) {
                dashboardSchedulesSub.textContent = selectedUser !== '' || selectedSemester !== '' ? 'ตารางตามตัวกรอง' : 'รายการตารางทั้งหมด';
            }

            if (dashboardChartTitle) {
                const filterNames = [selectedUserName, selectedSemesterName].filter(Boolean);
                dashboardChartTitle.textContent = filterNames.length > 0 ? `ภาพรวมข้อมูล: ${filterNames.join(' · ')}` : 'ภาพรวมข้อมูล';
            }
            if (dashboardUsersBarValue) dashboardUsersBarValue.textContent = String(usersCount);
            if (dashboardSubjectsBarValue) dashboardSubjectsBarValue.textContent = String(subjectsCount);
            if (dashboardSchedulesBarValue) dashboardSchedulesBarValue.textContent = String(schedulesCount);
            if (dashboardUsersBar) dashboardUsersBar.dataset.value = String(usersCount);
            if (dashboardSubjectsBar) dashboardSubjectsBar.dataset.value = String(subjectsCount);
            if (dashboardSchedulesBar) dashboardSchedulesBar.dataset.value = String(schedulesCount);
            if (dashboardUsersMiniBar) dashboardUsersMiniBar.dataset.value = String(usersCount);
            if (dashboardSubjectsMiniBar) dashboardSubjectsMiniBar.dataset.value = String(subjectsCount);
            if (dashboardSchedulesMiniBar) dashboardSchedulesMiniBar.dataset.value = String(schedulesCount);

            if (cardTitle && document.querySelector('.tab-panel[data-panel="dashboard"]')?.classList.contains('active')) {
                const filterNames = [selectedUserName, selectedSemesterName].filter(Boolean);
                cardTitle.textContent = filterNames.length > 0 ? `ตารางแสดงรายการ (${filterNames.join(' · ')})` : 'ตารางแสดงรายการ (ผู้ดูแลระบบ)';
            }

            renderStatMiniCharts();
            renderBarChart();
        };

        const setActiveView = (key) => {
            const config = navConfig[key] || navConfig.users;
            if (cardTitle) cardTitle.textContent = config.title;
            if (cardSubtitle) cardSubtitle.textContent = config.subtitle || '';
            if (panelKicker) panelKicker.textContent = config.kicker || 'ผู้ดูแลระบบ';
            if (mainPanelHeader) {
                mainPanelHeader.style.display = '';
            }
            if (mainPanelToolbar) {
                mainPanelToolbar.style.display = config.showToolbar === false ? 'none' : '';
            }

            panels.forEach((panel) => {
                const panelKey = panel.getAttribute('data-panel');
                panel.classList.toggle('active', panelKey === config.panel);
            });

            navLinks.forEach((link) => {
                const navKey = link.getAttribute('data-nav');
                link.classList.toggle('active', navKey === key);
            });
            filterActiveTable();
            refreshDashboardOverview();
            if (key === 'settings') {
                loadSettings();
            }
        };

        const filterActiveTable = () => {
            const activePanel = document.querySelector('.tab-panel.active');
            if (!activePanel) {
                refreshDashboardOverview();
                return;
            }
            const table = activePanel.querySelector('table');
            if (!table) {
                refreshDashboardOverview();
                return;
            }
            const selectedUser = activePanel.dataset.ignoreUserFilter === '1' ? '' : (userFilter ? userFilter.value : '');
            const selectedSemester = activePanel.dataset.ignoreSemesterFilter === '1' ? '' : (semesterFilter ? semesterFilter.value : '');
            const rows = table.querySelectorAll('tbody tr');
            rows.forEach((row) => {
                const isDataRow = !!row.dataset.id;
                if (!isDataRow) {
                    row.style.display = selectedUser === '' && selectedSemester === '' ? '' : 'none';
                    return;
                }
                row.style.display = rowMatchesFilters(row, selectedUser, selectedSemester) ? '' : 'none';
            });
            if (activePanel.dataset.panel === 'goals') {
                const visibleGoals = Array.from(rows).filter(row => row.dataset.id && row.style.display !== 'none');
                const completed = visibleGoals.filter(row => row.dataset.completed === '1').length;
                const average = visibleGoals.length ? Math.round(visibleGoals.reduce((sum, row) => sum + Number(row.dataset.progress || 0), 0) / visibleGoals.length) : 0;
                const metrics = activePanel.querySelectorAll('.mini-metric strong');
                metrics[0].textContent = visibleGoals.length;
                metrics[1].textContent = completed;
                metrics[2].textContent = `${average}%`;
                let emptyRow = table.querySelector('[data-goals-empty]');
                if (!emptyRow) {
                    emptyRow = document.createElement('tr');
                    emptyRow.dataset.goalsEmpty = '1';
                    const cell = document.createElement('td');
                    cell.colSpan = 6;
                    cell.textContent = 'ยังไม่มีข้อมูลเป้าหมายการเรียนตามตัวกรองที่เลือก';
                    emptyRow.appendChild(cell);
                    table.querySelector('tbody').appendChild(emptyRow);
                }
                rows.forEach(row => { if (!row.dataset.id) row.style.display = 'none'; });
                emptyRow.style.display = visibleGoals.length ? 'none' : '';
            }
            refreshDashboardOverview();
        };

        document.querySelectorAll('.mini-link-btn[data-view]').forEach((button) => {
            button.addEventListener('click', () => {
                const targetView = button.getAttribute('data-view');
                if (targetView) {
                    setActiveView(targetView);
                }
            });
        });

        const setUserFilterValue = (value) => {
            if (userFilter) {
                userFilter.value = value;
            }
            filterActiveTable();
        };

        const setSemesterFilterValue = (value) => {
            if (semesterFilter) {
                semesterFilter.value = value;
            }
            filterActiveTable();
        };

        const renderBarChart = () => {
            const chart = document.getElementById('adminBarChart');
            if (!chart) return;
            const bars = chart.querySelectorAll('.bar-fill');
            let maxValue = 0;
            bars.forEach((bar) => {
                const value = Number(bar.dataset.value || 0);
                if (value > maxValue) maxValue = value;
            });
            if (maxValue <= 0) maxValue = 1;
            // Keep six evenly spaced horizontal intervals, as in the dashboard
            // summary chart, while leaving enough headroom above the tallest bar.
            const axisMax = Math.max(6, Math.ceil(maxValue / 6) * 6);
            const axisMid = Math.round(axisMax / 2);
            const axisMaxLabel = document.getElementById('dashboardChartTickMax');
            const axisMidLabel = document.getElementById('dashboardChartTickMid');
            if (axisMaxLabel) axisMaxLabel.textContent = String(axisMax);
            if (axisMidLabel) axisMidLabel.textContent = String(axisMid);
            const axisTicks = chart.closest('.mockup-summary-chart')?.querySelectorAll('.bar-y-axis span') || [];
            axisTicks.forEach((tick, index) => {
                const value = Math.round(axisMax - (axisMax * index) / Math.max(axisTicks.length - 1, 1));
                tick.textContent = String(value);
            });
            bars.forEach((bar, index) => {
                const value = Number(bar.dataset.value || 0);
                const percent = value <= 0 ? 0 : Math.round((value / axisMax) * 100);
                bar.style.height = `${percent}%`;
                bar.style.animationDelay = `${index * 80}ms`;
            });
        };

        const renderStatMiniCharts = () => {
            if (!dashboardMiniBars.length) return;
            let maxValue = 0;
            dashboardMiniBars.forEach((bar) => {
                const value = Number(bar.dataset.value || 0);
                if (value > maxValue) maxValue = value;
            });
            if (maxValue <= 0) maxValue = 1;
            dashboardMiniBars.forEach((bar) => {
                const value = Number(bar.dataset.value || 0);
                const percent = value <= 0 ? 8 : Math.max(12, Math.round((value / maxValue) * 100));
                bar.style.height = `${percent}%`;
            });
        };

        const renderTrendChart = (rangeKey = 'week') => {
            const chart = document.getElementById('adminTrendChart');
            if (!chart) return;
            const svg = chart.querySelector('svg');
            if (!svg) return;
            const raw = chart.dataset.trend || '{}';
            let trends = {
                week: {
                    labels: [],
                    users: [],
                    logs: []
                }
            };
            try {
                trends = JSON.parse(raw);
            } catch (error) {
                trends = {
                    week: {
                        labels: [],
                        users: [],
                        logs: []
                    }
                };
            }
            const trend = trends[rangeKey] || trends.week || {
                labels: [],
                users: [],
                logs: []
            };
            const labels = Array.isArray(trend.labels) ? trend.labels : [];
            const users = Array.isArray(trend.users) ? trend.users : [];
            const logs = Array.isArray(trend.logs) ? trend.logs : [];
            const count = Math.max(labels.length, users.length, logs.length);
            if (count === 0) {
                svg.innerHTML = '';
                return;
            }

            const width = 920;
            const height = 320;
            const pad = {
                top: 20,
                right: 26,
                bottom: 52,
                left: 50
            };
            const chartWidth = width - pad.left - pad.right;
            const chartHeight = height - pad.top - pad.bottom;
            const maxRaw = Math.max(...users, ...logs, 1);
            const maxValue = Math.ceil(maxRaw / 5) * 5;
            const minValue = 0;
            const steps = 5;
            const pointsUsers = [];
            const pointsLogs = [];

            const xFor = (index) => {
                if (count <= 1) return pad.left + chartWidth / 2;
                return pad.left + (chartWidth * index) / (count - 1);
            };
            const yFor = (value) => {
                const ratio = (value - minValue) / (maxValue - minValue || 1);
                return pad.top + chartHeight - ratio * chartHeight;
            };
            const pathFrom = (points) => points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ');
            const areaFrom = (points) => {
                if (points.length === 0) return '';
                const baseY = pad.top + chartHeight;
                return `${pathFrom(points)} L${points[points.length - 1][0]},${baseY} L${points[0][0]},${baseY} Z`;
            };
            for (let i = 0; i < count; i++) {
                const x = xFor(i);
                pointsUsers.push([x, yFor(Number(users[i] || 0))]);
                pointsLogs.push([x, yFor(Number(logs[i] || 0))]);
            }

            let guides = '';
            for (let i = 0; i <= steps; i++) {
                const v = minValue + ((maxValue - minValue) / steps) * i;
                const y = yFor(v);
                guides += `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" class="trend-grid"/>`;
                guides += `<text x="${pad.left - 10}" y="${y + 4}" text-anchor="end" class="trend-y-label">${Math.round(v)}</text>`;
            }

            let xLabels = '';
            for (let i = 0; i < count; i++) {
                const x = xFor(i);
                const label = labels[i] || '';
                xLabels += `<text x="${x}" y="${height - 20}" text-anchor="middle" class="trend-x-label">${label}</text>`;
            }

            let hoverZones = '';
            for (let i = 0; i < count; i++) {
                const left = i === 0 ? pad.left : (xFor(i - 1) + xFor(i)) / 2;
                const right = i === count - 1 ? (width - pad.right) : (xFor(i) + xFor(i + 1)) / 2;
                hoverZones += `<rect x="${left}" y="${pad.top}" width="${Math.max(1, right - left)}" height="${chartHeight}" class="trend-hover-zone" data-index="${i}"></rect>`;
            }

            const userDots = pointsUsers.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="4.5" class="trend-dot users"/>`).join('');
            const logDots = pointsLogs.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="4.5" class="trend-dot logs"/>`).join('');
            svg.innerHTML = `
                <defs>
                    <linearGradient id="trendUsersFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.18"/>
                        <stop offset="100%" stop-color="#8b5cf6" stop-opacity="0.03"/>
                    </linearGradient>
                    <linearGradient id="trendLogsFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="#10b981" stop-opacity="0.18"/>
                        <stop offset="100%" stop-color="#10b981" stop-opacity="0.03"/>
                    </linearGradient>
                </defs>
                <g>${guides}</g>
                <path d="${areaFrom(pointsUsers)}" class="trend-area users"/>
                <path d="${areaFrom(pointsLogs)}" class="trend-area logs"/>
                <path d="${pathFrom(pointsUsers)}" class="trend-line users"/>
                <path d="${pathFrom(pointsLogs)}" class="trend-line logs"/>
                ${userDots}
                ${logDots}
                <g>${xLabels}</g>
                <g>${hoverZones}</g>
            `;

            let tooltip = chart.querySelector('.trend-tooltip');
            if (!tooltip) {
                tooltip = document.createElement('div');
                tooltip.className = 'trend-tooltip';
                chart.appendChild(tooltip);
            }
            const showTooltip = (event, index) => {
                const idx = Number(index);
                const userValue = Number(users[idx] || 0);
                const logValue = Number(logs[idx] || 0);
                const label = labels[idx] || '';
                tooltip.innerHTML = `${label}<br>ผู้ใช้งาน: ${userValue}<br>บันทึก: ${logValue}`;
                tooltip.classList.add('show');
                const rect = chart.getBoundingClientRect();
                tooltip.style.left = `${event.clientX - rect.left + 14}px`;
                tooltip.style.top = `${event.clientY - rect.top - 12}px`;
            };
            const hideTooltip = () => {
                tooltip.classList.remove('show');
            };
            svg.querySelectorAll('.trend-hover-zone').forEach((zone) => {
                zone.addEventListener('mouseenter', (event) => showTooltip(event, zone.dataset.index));
                zone.addEventListener('mousemove', (event) => showTooltip(event, zone.dataset.index));
                zone.addEventListener('mouseleave', hideTooltip);
            });
            chart.addEventListener('mouseleave', hideTooltip);
        };

        navLinks.forEach((link) => {
            link.addEventListener('click', (event) => {
                event.preventDefault();
                const key = link.getAttribute('data-nav');
                if (key) {
                    setActiveView(key);
                }
            });
        });

        if (userFilter) {
            userFilter.addEventListener('change', () => {
                setUserFilterValue(userFilter.value);
            });
        }

        if (semesterFilter) {
            semesterFilter.addEventListener('change', () => {
                setSemesterFilterValue(semesterFilter.value);
            });
        }

        setActiveView('dashboard');
        renderBarChart();
        renderTrendChart(trendRangeSelect ? trendRangeSelect.value : 'week');
        setUserFilterValue(userFilter ? userFilter.value : '');
        setSemesterFilterValue(semesterFilter ? semesterFilter.value : '');

        if (trendRangeSelect) {
            trendRangeSelect.addEventListener('change', () => {
                renderTrendChart(trendRangeSelect.value || 'week');
            });
        }

        const apiUrl = 'admin_api.php';
        const callApi = async (params) => {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams(params)
            });
            let data = null;
            try {
                data = await response.json();
            } catch (error) {
                data = null;
            }
            if (!response.ok || !data || !data.ok) {
                const message = data && data.error ? data.error : 'เกิดข้อผิดพลาดในการเชื่อมต่อ';
                throw new Error(message);
            }
            return data;
        };

        const setSettingsStatus = (message, isError = false, state = '') => {
            if (!settingsStatus) return;
            settingsStatus.textContent = message;
            settingsStatus.classList.remove('loading', 'success', 'error');
            if (isError) {
                settingsStatus.classList.add('error');
            } else if (state === 'loading') {
                settingsStatus.classList.add('loading');
            } else if (state === 'success') {
                settingsStatus.classList.add('success');
            }
        };

        const applySettingsToForm = (settings) => {
            if (settingSystemName) settingSystemName.value = String(settings.system_name ?? '');
            if (settingWelcomeMessage) settingWelcomeMessage.value = String(settings.admin_welcome_message ?? '');
            if (settingContactEmail) settingContactEmail.value = String(settings.contact_email ?? '');
            if (settingMaintenanceMode) settingMaintenanceMode.value = String(settings.maintenance_mode ?? '0');
            setMaintenanceStartAtValue(String(settings.maintenance_start_at ?? ''));
            syncMaintenanceSwitchUi();
        };

        const syncMaintenanceSwitchUi = () => {
            if (!settingMaintenanceSwitch || !settingMaintenanceMode) return;
            const active = String(settingMaintenanceMode.value) === '1';
            settingMaintenanceSwitch.classList.toggle('active', active);
            settingMaintenanceSwitch.setAttribute('aria-pressed', active ? 'true' : 'false');
        };

        const loadSettings = async (force = false) => {
            if (settingsLoaded && !force) return;
            if (!saveSettingsBtn) return;
            try {
                saveSettingsBtn.disabled = true;
                setSettingsStatus('กำลังโหลดการตั้งค่า...', false, 'loading');
                const data = await callApi({
                    action: 'settings_get'
                });
                applySettingsToForm(data.settings || {});
                settingsLoaded = true;
                setSettingsStatus('โหลดการตั้งค่าแล้ว', false, 'success');
            } catch (error) {
                setSettingsStatus(error.message || 'โหลดการตั้งค่าไม่สำเร็จ', true);
            } finally {
                saveSettingsBtn.disabled = false;
            }
        };

        const editModal = document.getElementById('editModal');
        const editForm = document.getElementById('editForm');
        const closeModal = document.getElementById('closeModal');
        const cancelEdit = document.getElementById('cancelEdit');
        const saveEdit = document.getElementById('saveEdit');
        const viewModal = document.getElementById('viewModal');
        const viewBody = document.getElementById('viewBody');
        const viewReference = document.getElementById('viewReference');
        const closeViewModal = document.getElementById('closeViewModal');
        const closeView = document.getElementById('closeView');
        const addModal = document.getElementById('addModal');
        const addForm = document.getElementById('addForm');
        const closeAddModal = document.getElementById('closeAddModal');
        const cancelAdd = document.getElementById('cancelAdd');
        const saveAdd = document.getElementById('saveAdd');
        const deleteConfirmModal = document.getElementById('deleteConfirmModal');
        const closeDeleteConfirmModal = document.getElementById('closeDeleteConfirmModal');
        const cancelDeleteConfirm = document.getElementById('cancelDeleteConfirm');
        const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
        const saveSettingsBtn = document.getElementById('saveSettingsBtn');
        const syncSettingsBtn = document.getElementById('syncSettingsBtn');
        const resetSettingsBtn = document.getElementById('resetSettingsBtn');
        const settingsStatus = document.getElementById('settingsStatus');
        const settingSystemName = document.getElementById('settingSystemName');
        const settingWelcomeMessage = document.getElementById('settingWelcomeMessage');
        const settingContactEmail = document.getElementById('settingContactEmail');
        const settingMaintenanceMode = document.getElementById('settingMaintenanceMode');
        const settingMaintenanceSwitch = document.getElementById('settingMaintenanceSwitch');
        const settingMaintenanceStartAt = document.getElementById('settingMaintenanceStartAt');
        const settingMaintenanceStartDate = document.getElementById('settingMaintenanceStartDate');
        const settingMaintenanceStartNativeDate = document.getElementById('settingMaintenanceStartNativeDate');
        const settingMaintenanceStartDatePicker = document.getElementById('settingMaintenanceStartDatePicker');
        const settingMaintenanceStartTime = document.getElementById('settingMaintenanceStartTime');
        const settingMaintenanceStartHour = document.getElementById('settingMaintenanceStartHour');
        const settingMaintenanceStartMinute = document.getElementById('settingMaintenanceStartMinute');
        let settingsLoaded = false;
        let activeRow = null;

        const maintenanceControls = [
            [settingMaintenanceStartDate, settingMaintenanceStartHour, settingMaintenanceStartMinute, settingMaintenanceStartAt]
        ];
        const parseMaintenanceDate = (value) => {
            const match = String(value || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
            if (!match) return '';
            const day = Number(match[1]);
            const month = Number(match[2]);
            const year = 2000 + Number(match[3]);
            const parsed = new Date(year, month - 1, day);
            if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
                return '';
            }
            return `${year}-${match[2]}-${match[1]}`;
        };

        const formatMaintenanceDate = (value) => {
            const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
            return match ? `${match[3]}/${match[2]}/${match[1].slice(-2)}` : '';
        };

        const syncMaintenanceStartAtValue = () => {
            maintenanceControls.forEach(([date, hour, minute, value]) => {
                settingMaintenanceStartTime.value = hour.value && minute.value ? hour.value + ':' + minute.value : '';
                const isoDate = parseMaintenanceDate(date.value);
                if (settingMaintenanceStartNativeDate) settingMaintenanceStartNativeDate.value = isoDate;
                value.value = isoDate && settingMaintenanceStartTime.value ? isoDate + 'T' + settingMaintenanceStartTime.value : '';
            });
        };
        const validateMaintenanceDate = () => {
            syncMaintenanceStartAtValue();
            maintenanceControls.forEach(([date, hour, minute]) => {
                const hasTime = hour.value || minute.value;
                const hasDate = date.value.trim() !== '';
                const isoDate = parseMaintenanceDate(date.value);
                date.setCustomValidity(hasDate && !isoDate ? 'กรุณากรอกวันที่ในรูปแบบ dd/mm/yy' : (hasTime && !hasDate ? 'กรุณาเลือกวันที่' : ''));
                hour.setCustomValidity(hasDate && !hour.value ? 'กรุณาเลือกเวลา' : '');
                minute.setCustomValidity(hasDate && !minute.value ? 'กรุณาเลือกเวลา' : '');
            });
            return maintenanceControls.every(([date, hour, minute]) => (
                date.reportValidity() && hour.reportValidity() && minute.reportValidity()
            ));
        };
        const setMaintenanceValue = (value, controls) => {
            const match = String(value || '').trim().match(/^(\d{4}-\d{2}-\d{2})[T\s]+(\d{1,2}):(\d{2})/);
            const [date, hour, minute] = controls;
            date.value = match ? formatMaintenanceDate(match[1]) : '';
            if (settingMaintenanceStartNativeDate) settingMaintenanceStartNativeDate.value = match ? match[1] : '';
            hour.value = match ? match[2].padStart(2, '0') : '';
            minute.value = match ? match[3] : '';
            date.setCustomValidity('');
            hour.setCustomValidity('');
            minute.setCustomValidity('');
            syncMaintenanceStartAtValue();
        };
        const setMaintenanceStartAtValue = (value) => setMaintenanceValue(value, maintenanceControls[0]);
        maintenanceControls.forEach(([date, hour, minute]) => {
            [date, hour, minute].forEach((control) => control.addEventListener('input', () => {
                maintenanceControls.forEach(([date, hour, minute]) => {
                    date.setCustomValidity('');
                    hour.setCustomValidity('');
                    minute.setCustomValidity('');
                });
                syncMaintenanceStartAtValue();
            }));
        });

        if (settingMaintenanceStartNativeDate) {
            settingMaintenanceStartNativeDate.addEventListener('change', () => {
                settingMaintenanceStartDate.value = formatMaintenanceDate(settingMaintenanceStartNativeDate.value);
                settingMaintenanceStartDate.setCustomValidity('');
                syncMaintenanceStartAtValue();
            });
        }

        if (settingMaintenanceStartDatePicker && settingMaintenanceStartNativeDate) {
            settingMaintenanceStartDatePicker.addEventListener('click', () => {
                if (typeof settingMaintenanceStartNativeDate.showPicker === 'function') {
                    settingMaintenanceStartNativeDate.showPicker();
                } else {
                    settingMaintenanceStartNativeDate.click();
                }
            });
        }

        const closeEditModal = () => {
            editModal.classList.remove('active');
            editForm.innerHTML = '';
            activeRow = null;
        };

        [closeModal, cancelEdit].forEach((btn) => {
            btn.addEventListener('click', closeEditModal);
        });

        editModal.addEventListener('click', (event) => {
            if (event.target === editModal) {
                closeEditModal();
            }
        });

        const closeViewDetails = () => {
            viewModal.classList.remove('active');
            viewBody.innerHTML = '';
            viewReference.textContent = '-';
        };

        [closeViewModal, closeView].forEach((btn) => {
            btn.addEventListener('click', closeViewDetails);
        });

        viewModal.addEventListener('click', (event) => {
            if (event.target === viewModal) {
                closeViewDetails();
            }
        });

        const closeAddNew = () => {
            addModal.classList.remove('active');
            addForm.innerHTML = '';
        };

        [closeAddModal, cancelAdd].forEach((btn) => {
            btn.addEventListener('click', closeAddNew);
        });

        addModal.addEventListener('click', (event) => {
            if (event.target === addModal) {
                closeAddNew();
            }
        });

        let pendingDeleteRow = null;

        const closeDeleteConfirm = () => {
            deleteConfirmModal.classList.remove('active');
            pendingDeleteRow = null;
            confirmDeleteBtn.disabled = false;
            confirmDeleteBtn.textContent = 'ลบเลย';
        };

        [closeDeleteConfirmModal, cancelDeleteConfirm].forEach((btn) => {
            btn.addEventListener('click', closeDeleteConfirm);
        });

        deleteConfirmModal.addEventListener('click', (event) => {
            if (event.target === deleteConfirmModal) {
                closeDeleteConfirm();
            }
        });

        const getTableMeta = (table) => {
            return Array.from(table.querySelectorAll('thead th')).map((th) => ({
                label: th.textContent.trim(),
                field: th.dataset.field || '',
                editable: th.dataset.editable === '1',
                creatable: th.dataset.create === '1'
            }));
        };

        const getCellValue = (row, field) => {
            if (!field) return '';
            const cell = row.querySelector(`td[data-field="${field}"]`);
            if (!cell) return '';
            if (cell.dataset && typeof cell.dataset.value !== 'undefined') {
                return cell.dataset.value;
            }
            return cell.textContent.trim();
        };

        const getCellDisplay = (row, field) => {
            if (!field) return '';
            const cell = row.querySelector(`td[data-field="${field}"]`);
            return cell ? cell.textContent.trim() : '';
        };

        const subjectColorPalette = [
            '#3B82F6',
            '#22C55E',
            '#F97316',
            '#EC4899',
            '#8B5CF6',
            '#14B8A6',
            '#EF4444'
        ];

        const buildEditForm = (row) => {
            const table = row.closest('table');
            const meta = getTableMeta(table);
            const tableName = table && table.dataset ? table.dataset.table : '';
            editForm.innerHTML = '';

            meta.forEach((col) => {
                if (!col.field || !col.editable) {
                    return;
                }
                const value = getCellValue(row, col.field);
                const field = document.createElement('div');
                field.className = 'field';
                if (tableName === 'subjects' && col.field === 'color') {
                    field.classList.add('color-picker-field', 'wide');
                }

                const fieldLabel = document.createElement('label');
                fieldLabel.textContent = col.label;

                field.appendChild(fieldLabel);
                field.appendChild(createFieldControl(col.field, value, tableName));
                editForm.appendChild(field);
            });
            wireUserSubjectSelects(editForm);
        };

        const buildAddForm = (table) => {
            const meta = getTableMeta(table);
            const tableName = table && table.dataset ? table.dataset.table : '';
            addForm.innerHTML = '';

            meta.forEach((col) => {
                if (!col.field || !col.creatable) {
                    return;
                }
                const field = document.createElement('div');
                field.className = 'field';
                if (tableName === 'subjects' && col.field === 'color') {
                    field.classList.add('color-picker-field', 'wide');
                }

                const fieldLabel = document.createElement('label');
                fieldLabel.textContent = col.label;

                field.appendChild(fieldLabel);
                field.appendChild(createFieldControl(col.field, '', tableName));
                addForm.appendChild(field);
            });
            wireUserSubjectSelects(addForm);
        };

        const createFieldControl = (fieldName, value, tableName) => {
            if (tableName === 'subjects' && fieldName === 'color') {
                return createColorPickerControl(fieldName, value);
            }

            const options = selectOptions[fieldName];
            const shouldUseSelect = Array.isArray(options) && (options.length > 0 || (tableName === 'subjects' && fieldName === 'semester_id'));
            if (shouldUseSelect) {
                const select = document.createElement('select');
                select.dataset.field = fieldName;

                const defaultOption = document.createElement('option');
                defaultOption.value = '';
                defaultOption.textContent = '-- เลือก --';
                select.appendChild(defaultOption);

                options.forEach((option) => {
                    const optionEl = document.createElement('option');
                    optionEl.value = String(option.value ?? '');
                    optionEl.textContent = String(option.label ?? optionEl.value);
                    if (typeof option.user_id !== 'undefined') {
                        optionEl.dataset.userId = String(option.user_id ?? '');
                    }
                    select.appendChild(optionEl);
                });

                select.value = String(value ?? '');

                if (tableName === 'subjects' && fieldName === 'semester_id') {
                    select.required = true;
                }

                return select;
            }

            const input = document.createElement('input');
            input.type = 'text';
            input.value = String(value ?? '');
            input.dataset.field = fieldName;
            return input;
        };

        const createColorPickerControl = (fieldName, value) => {
            const selectedValue = String(value || '').trim().toUpperCase();
            const initialColor = /^#[0-9A-F]{3,8}$/i.test(selectedValue) ? selectedValue : subjectColorPalette[0];
            const wrapper = document.createElement('div');
            wrapper.className = 'subject-color-picker';

            const hiddenInput = document.createElement('input');
            hiddenInput.type = 'hidden';
            hiddenInput.value = initialColor;
            hiddenInput.dataset.field = fieldName;

            const title = document.createElement('div');
            title.className = 'subject-color-picker-title';
            title.textContent = 'สีทั้งหมด';

            const hint = document.createElement('div');
            hint.className = 'subject-color-picker-hint';
            hint.textContent = 'เลือกสีวงกลมเพื่อเปลี่ยนสีทันที';

            const grid = document.createElement('div');
            grid.className = 'subject-color-options';

            const setSelectedColor = (color) => {
                hiddenInput.value = color;
                Array.from(grid.querySelectorAll('.subject-color-option')).forEach((button) => {
                    const isSelected = button.dataset.color === color;
                    button.classList.toggle('selected', isSelected);
                    button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
                });
            };

            subjectColorPalette.forEach((color) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'subject-color-option';
                button.dataset.color = color;
                button.style.setProperty('--subject-option-color', color);
                button.setAttribute('aria-label', `เลือกสี ${color}`);
                button.setAttribute('aria-pressed', 'false');
                button.innerHTML = '<span class="subject-color-check">✓</span>';
                button.addEventListener('click', () => setSelectedColor(color));
                grid.appendChild(button);
            });

            wrapper.appendChild(hiddenInput);
            wrapper.appendChild(title);
            wrapper.appendChild(hint);
            wrapper.appendChild(grid);
            if (subjectColorPalette.includes(initialColor)) {
                setSelectedColor(initialColor);
            }

            return wrapper;
        };

        const syncSubjectOptionsByUser = (form) => {
            if (!form) return;
            const userSelect = form.querySelector('select[data-field="user_id"]');
            const subjectSelect = form.querySelector('select[data-field="subject_id"]');
            if (!userSelect || !subjectSelect) return;
            const selectedUser = String(userSelect.value || '');
            Array.from(subjectSelect.options).forEach((option) => {
                if (option.value === '') {
                    option.hidden = false;
                    return;
                }
                const optionUser = String(option.dataset.userId || '');
                option.hidden = selectedUser !== '' && optionUser !== '' && optionUser !== selectedUser;
            });
            const selectedOption = subjectSelect.options[subjectSelect.selectedIndex];
            if (selectedOption && selectedOption.hidden) {
                subjectSelect.value = '';
            }
        };

        const wireUserSubjectSelects = (form) => {
            if (!form) return;
            syncSubjectOptionsByUser(form);
            const userSelect = form.querySelector('select[data-field="user_id"]');
            if (userSelect) {
                userSelect.addEventListener('change', () => syncSubjectOptionsByUser(form));
            }
        };

        const buildViewDetails = (row) => {
            const table = row.closest('table');
            const meta = getTableMeta(table);
            viewBody.innerHTML = '';
            const referenceValue = getCellDisplay(row, 'id') || row.dataset.id || '-';
            viewReference.textContent = referenceValue;

            meta.forEach((col) => {
                if (!col.field) {
                    return;
                }
                const value = getCellDisplay(row, col.field);
                const field = document.createElement('div');
                const isWideField = ['user_id', 'name', 'subject_id', 'title', 'description', 'email'].includes(col.field);
                const isLongField = ['description', 'content', 'note', 'notes'].includes(col.field) || String(value).length > 70;
                field.className = `field readonly${isWideField || isLongField ? ' wide' : ''}`;

                const fieldLabel = document.createElement('label');
                fieldLabel.textContent = col.label;

                let valueEl;
                if (col.field === 'color' && /^#[0-9a-f]{3,8}$/i.test(String(value).trim())) {
                    valueEl = document.createElement('div');
                    valueEl.className = 'readonly-value color-value';

                    const swatch = document.createElement('span');
                    swatch.className = 'color-swatch';
                    swatch.style.backgroundColor = value;

                    const colorText = document.createElement('span');
                    colorText.textContent = value || '-';

                    valueEl.appendChild(swatch);
                    valueEl.appendChild(colorText);
                } else if (isLongField) {
                    valueEl = document.createElement('textarea');
                    valueEl.value = value;
                    valueEl.readOnly = true;
                    valueEl.tabIndex = -1;
                    valueEl.rows = 3;
                } else {
                    valueEl = document.createElement('input');
                    valueEl.type = 'text';
                    valueEl.value = value;
                    valueEl.readOnly = true;
                    valueEl.tabIndex = -1;
                }

                field.appendChild(fieldLabel);
                field.appendChild(valueEl);
                viewBody.appendChild(field);
            });
        };

        document.querySelectorAll('.tool.blue').forEach((tool) => {
            tool.style.cursor = 'pointer';
            tool.title = 'แก้ไข';
            tool.addEventListener('click', () => {
                const row = tool.closest('tr');
                if (!row) return;
                activeRow = row;
                buildEditForm(row);
                editModal.classList.add('active');
            });
        });

        document.querySelectorAll('.tool.gray').forEach((tool) => {
            tool.style.cursor = 'pointer';
            tool.title = 'ดูรายละเอียด';
            tool.addEventListener('click', () => {
                const row = tool.closest('tr');
                if (!row) return;
                buildViewDetails(row);
                viewModal.classList.add('active');
            });
        });

        document.querySelectorAll('.tool.red').forEach((tool) => {
            tool.style.cursor = 'pointer';
            tool.title = 'ลบข้อมูล';
            tool.addEventListener('click', () => {
                const row = tool.closest('tr');
                if (!row) return;
                pendingDeleteRow = row;
                deleteConfirmModal.classList.add('active');
            });
        });

        confirmDeleteBtn.addEventListener('click', async () => {
            if (!pendingDeleteRow) return;
            const table = pendingDeleteRow.dataset.table;
            const id = pendingDeleteRow.dataset.id;
            if (!table || !id) {
                closeDeleteConfirm();
                return;
            }
            confirmDeleteBtn.disabled = true;
            confirmDeleteBtn.textContent = 'กำลังลบ...';
            try {
                await callApi({
                    action: 'delete',
                    table: table,
                    id: id
                });
                pendingDeleteRow.remove();
                closeDeleteConfirm();
            } catch (error) {
                confirmDeleteBtn.disabled = false;
                confirmDeleteBtn.textContent = 'ลบเลย';
                alert(error.message);
            }
        });

        document.querySelectorAll('tr[data-table="users"]').forEach((row) => {
            row.addEventListener('click', (event) => {
                if (event.target.closest('.tools')) {
                    return;
                }
                const userId = row.dataset.id;
                if (!userId) return;
                setUserFilterValue(userId);
                setActiveView('dashboard');
            });
        });

        document.querySelectorAll('[data-user-view]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                const target = button.dataset.userView;
                const row = button.closest('tr[data-table="users"]');
                const userId = row ? row.dataset.id : '';
                if (!userId || !target) return;
                setUserFilterValue(userId);
                setActiveView(target);
            });
        });

        const shouldSkipEmptyField = (field, value) => {
            if (value !== '') return false;
            return field === 'created_at' || field === 'updated_at';
        };

        saveAdd.addEventListener('click', async () => {
            const activePanel = document.querySelector('.tab-panel.active');
            const table = activePanel ? activePanel.querySelector('table') : null;
            if (!table) return;
            const tableName = table.dataset.table;
            if (!tableName) return;
            const inputs = addForm.querySelectorAll('[data-field]');
            const fields = {};
            inputs.forEach((input) => {
                const field = input.dataset.field;
                if (field) {
                    const rawValue = typeof input.value === 'string' ? input.value : '';
                    const value = rawValue.trim();
                    if (shouldSkipEmptyField(field, value)) {
                        return;
                    }
                    fields[field] = value;
                }
            });
            if (tableName === 'subjects' && Array.isArray(selectOptions.semester_id) && selectOptions.semester_id.length > 0 && !fields.semester_id) {
                alert('กรุณาเลือกภาคเรียน');
                return;
            }
            try {
                await callApi({
                    action: 'create',
                    table: tableName,
                    fields: JSON.stringify(fields)
                });
                closeAddNew();
                window.location.reload();
            } catch (error) {
                alert(error.message);
            }
        });

        saveEdit.addEventListener('click', async () => {
            if (!activeRow) return;
            const table = activeRow.dataset.table;
            const id = activeRow.dataset.id;
            if (!table || !id) return;
            const inputs = editForm.querySelectorAll('[data-field]');
            const fields = {};
            inputs.forEach((input) => {
                const field = input.dataset.field;
                if (field) {
                    const rawValue = typeof input.value === 'string' ? input.value : '';
                    const value = rawValue.trim();
                    if (shouldSkipEmptyField(field, value)) {
                        return;
                    }
                    fields[field] = value;
                }
            });
            if (table === 'subjects' && Array.isArray(selectOptions.semester_id) && selectOptions.semester_id.length > 0 && !fields.semester_id) {
                alert('กรุณาเลือกภาคเรียน');
                return;
            }
            try {
                await callApi({
                    action: 'update',
                    table: table,
                    id: id,
                    fields: JSON.stringify(fields)
                });
                closeEditModal();
                window.location.reload();
            } catch (error) {
                alert(error.message);
            }
        });

        if (saveSettingsBtn) {
            saveSettingsBtn.addEventListener('click', async () => {
                if (!validateMaintenanceDate()) {
                    return;
                }
                const fields = {
                    system_name: settingSystemName ? settingSystemName.value.trim() : '',
                    admin_welcome_message: settingWelcomeMessage ? settingWelcomeMessage.value.trim() : '',
                    contact_email: settingContactEmail ? settingContactEmail.value.trim() : '',
                    maintenance_mode: settingMaintenanceMode ? settingMaintenanceMode.value : '0',
                    maintenance_start_at: settingMaintenanceStartAt ? settingMaintenanceStartAt.value : ''
                };
                try {
                    saveSettingsBtn.disabled = true;
                    setSettingsStatus('กำลังบันทึก...', false, 'loading');
                    await callApi({
                        action: 'settings_save',
                        fields: JSON.stringify(fields)
                    });
                    settingsLoaded = true;
                    setSettingsStatus('บันทึกการตั้งค่าเรียบร้อย', false, 'success');
                } catch (error) {
                    setSettingsStatus(error.message || 'บันทึกการตั้งค่าไม่สำเร็จ', true);
                } finally {
                    saveSettingsBtn.disabled = false;
                }
            });
        }

        if (settingMaintenanceSwitch && settingMaintenanceMode) {
            settingMaintenanceSwitch.addEventListener('click', async () => {
                if (!validateMaintenanceDate()) {
                    return;
                }
                const current = String(settingMaintenanceMode.value) === '1';
                settingMaintenanceMode.value = current ? '0' : '1';
                syncMaintenanceSwitchUi();
                try {
                    settingMaintenanceSwitch.disabled = true;
                    setSettingsStatus('กำลังเปลี่ยนโหมดซ่อมบำรุง...', false, 'loading');
                    await callApi({
                        action: 'settings_save',
                        fields: JSON.stringify({
                            maintenance_mode: settingMaintenanceMode.value,
                            maintenance_start_at: settingMaintenanceStartAt ? settingMaintenanceStartAt.value : ''
                        })
                    });
                    settingsLoaded = true;
                    setSettingsStatus(settingMaintenanceMode.value === '1' ? 'เปิดโหมดซ่อมบำรุงแล้ว' : 'ปิดโหมดซ่อมบำรุงแล้ว', false, 'success');
                } catch (error) {
                    settingMaintenanceMode.value = current ? '1' : '0';
                    syncMaintenanceSwitchUi();
                    setSettingsStatus(error.message || 'เปลี่ยนโหมดซ่อมบำรุงไม่สำเร็จ', true);
                } finally {
                    settingMaintenanceSwitch.disabled = false;
                }
            });
            settingMaintenanceMode.addEventListener('change', syncMaintenanceSwitchUi);
            syncMaintenanceSwitchUi();
        }

        if (syncSettingsBtn) {
            syncSettingsBtn.addEventListener('click', async () => {
                settingsLoaded = false;
                await loadSettings(true);
            });
        }

        if (resetSettingsBtn) {
            resetSettingsBtn.addEventListener('click', async () => {
                settingsLoaded = false;
                await loadSettings(true);
            });
        }
    </script>
</body>

</html>
