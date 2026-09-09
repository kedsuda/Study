<?php

$rootDir = dirname(__DIR__);
$publicDir = __DIR__;

$uri = isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '/';
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

function maintenance_mode_settings($rootDir)
{
    if (!function_exists('mysqli_connect')) {
        return ['enabled' => false, 'end_at' => ''];
    }

    $config = [
        'host' => '127.0.0.1',
        'port' => 3306,
        'database' => 'db_651998018',
        'username' => 'root',
        'password' => '',
        'charset' => 'utf8',
    ];
    $envPath = $rootDir . DIRECTORY_SEPARATOR . '.env';
    if (file_exists($envPath)) {
        $env = parse_ini_file($envPath, false, INI_SCANNER_RAW);
        if (is_array($env)) {
            $config['host'] = $env['DB_HOST'] ?? $config['host'];
            $config['port'] = (int) ($env['DB_PORT'] ?? $config['port']);
            $config['database'] = $env['DB_DATABASE'] ?? $config['database'];
            $config['username'] = $env['DB_USERNAME'] ?? $config['username'];
            $config['password'] = $env['DB_PASSWORD'] ?? $config['password'];
            $config['charset'] = $env['DB_CHARSET'] ?? $config['charset'];
        }
    }

    $connection = @mysqli_connect(
        $config['host'],
        $config['username'],
        $config['password'],
        $config['database'],
        $config['port']
    );
    if (!$connection) {
        return ['enabled' => false, 'end_at' => ''];
    }

    @mysqli_set_charset($connection, $config['charset']);
    $table = @mysqli_query($connection, "SHOW TABLES LIKE 'admin_settings'");
    $hasSettingsTable = $table && mysqli_num_rows($table) > 0;
    if ($table) {
        mysqli_free_result($table);
    }
    if (!$hasSettingsTable) {
        mysqli_close($connection);
        return ['enabled' => false, 'end_at' => ''];
    }

    $statement = @mysqli_prepare($connection, "SELECT setting_key, setting_value FROM admin_settings WHERE setting_key IN ('maintenance_mode', 'maintenance_end_at')");
    if (!$statement) {
        mysqli_close($connection);
        return ['enabled' => false, 'end_at' => ''];
    }
    mysqli_stmt_execute($statement);
    mysqli_stmt_bind_result($statement, $key, $value);
    $settings = ['maintenance_mode' => '0', 'maintenance_end_at' => ''];
    while (mysqli_stmt_fetch($statement)) {
        $settingKey = is_string($key) || is_int($key) ? (string) $key : '';
        if ($settingKey === '') {
            continue;
        }
        $settings[$settingKey] = $value === null ? '' : (string) $value;
    }
    mysqli_stmt_close($statement);
    mysqli_close($connection);

    return [
        'enabled' => $settings['maintenance_mode'] === '1',
        'end_at' => $settings['maintenance_end_at'],
    ];
}

function maintenance_mode_end_label($endAt)
{
    $endAt = trim((string) $endAt);
    if ($endAt === '') {
        return '';
    }

    try {
        $date = new DateTime($endAt, new DateTimeZone('Asia/Bangkok'));
        return $date->format('H:i') . ' น. วันที่ ' . $date->format('d/m/Y');
    } catch (Exception $exception) {
        return '';
    }
}

function maintenance_mode_allows_path($path)
{
    return (bool) preg_match('#^/(admin|admin-login|admin-logout|admin\\.php|admin_login\\.php|admin_logout\\.php|admin_api\\.php)(?:/|$)#', $path);
}

$maintenanceSettings = maintenance_mode_settings($rootDir);
if ($maintenanceSettings['enabled'] && !maintenance_mode_allows_path($path)) {
    http_response_code(503);
    $maintenanceEndLabel = maintenance_mode_end_label($maintenanceSettings['end_at']);
    $maintenanceMessage = 'ระบบกำลังอยู่ระหว่างการซ่อมบำรุง กรุณาลองใหม่อีกครั้งภายหลัง';
    if ($maintenanceEndLabel !== '') {
        $maintenanceMessage .= ' (คาดว่าจะเปิดใช้งานอีกครั้ง ' . $maintenanceEndLabel . ')';
    }
    if (strpos($path, '/api') === 0) {
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode([
            'message' => $maintenanceMessage,
            'maintenance' => true,
            'maintenance_end_at' => $maintenanceSettings['end_at'],
        ], JSON_UNESCAPED_UNICODE);
    } else {
        header('Content-Type: text/html; charset=utf-8');
        $endAtHtml = $maintenanceEndLabel === '' ? '' : '<p class="end-time">คาดว่าจะเปิดใช้งานอีกครั้ง: <strong>' . htmlspecialchars($maintenanceEndLabel, ENT_QUOTES, 'UTF-8') . '</strong></p>';
        echo '<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>กำลังซ่อมบำรุง</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f1f5f9;font-family:system-ui,sans-serif;color:#172033}.box{max-width:34rem;margin:1.5rem;padding:2.5rem;border-radius:1rem;background:#fff;box-shadow:0 12px 35px #0f172a18;text-align:center}h1{margin:0 0 .75rem;font-size:1.6rem}p{margin:0;color:#526176;line-height:1.7}.end-time{margin-top:1rem;padding:.8rem 1rem;border-radius:.75rem;background:#eff6ff;color:#1e40af}.end-time strong{white-space:nowrap}</style></head><body><main class="box"><h1>ระบบกำลังซ่อมบำรุง</h1><p>ขออภัยในความไม่สะดวก กรุณาลองใช้งานใหม่อีกครั้งภายหลัง</p>' . $endAtHtml . '</main></body></html>';
    }
    exit;
}

if (strpos($path, '/api') === 0) {
    $useLegacy = false;
    if (defined('PHP_VERSION_ID') && PHP_VERSION_ID < 80200) {
        $useLegacy = true;
    }

    $envPath = $rootDir . DIRECTORY_SEPARATOR . '.env';
    if (file_exists($envPath)) {
        $parsedEnv = parse_ini_file($envPath, false, INI_SCANNER_RAW);
        if (is_array($parsedEnv) && isset($parsedEnv['LEGACY_API'])) {
            $flag = strtolower(trim((string) $parsedEnv['LEGACY_API']));
            if ($flag === 'true' || $flag === '1') {
                $useLegacy = true;
            }
        }
    }

    if (!$useLegacy && file_exists($rootDir . DIRECTORY_SEPARATOR . 'bootstrap' . DIRECTORY_SEPARATOR . 'app.php')) {
        require $rootDir . DIRECTORY_SEPARATOR . 'vendor' . DIRECTORY_SEPARATOR . 'autoload.php';
        $app = require $rootDir . DIRECTORY_SEPARATOR . 'bootstrap' . DIRECTORY_SEPARATOR . 'app.php';
        $kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);
        $request = Illuminate\Http\Request::capture();
        $response = $kernel->handle($request);
        $response->send();
        $kernel->terminate($request, $response);
        exit;
    }

    $legacyApi = $rootDir . DIRECTORY_SEPARATOR . 'compat' . DIRECTORY_SEPARATOR . 'legacy_api.php';
    if (!file_exists($legacyApi)) {
        $legacyApi = $rootDir . DIRECTORY_SEPARATOR . 'api' . DIRECTORY_SEPARATOR . 'legacy_api.php';
    }
    require $legacyApi;
    exit;
}

$adminMap = [
    'admin' => $rootDir . DIRECTORY_SEPARATOR . 'backend' . DIRECTORY_SEPARATOR . 'admin.php',
    'admin-login' => $rootDir . DIRECTORY_SEPARATOR . 'backend' . DIRECTORY_SEPARATOR . 'admin_login.php',
    'admin-logout' => $rootDir . DIRECTORY_SEPARATOR . 'backend' . DIRECTORY_SEPARATOR . 'admin_logout.php',
    'admin.php' => $rootDir . DIRECTORY_SEPARATOR . 'backend' . DIRECTORY_SEPARATOR . 'admin.php',
    'admin_login.php' => $rootDir . DIRECTORY_SEPARATOR . 'backend' . DIRECTORY_SEPARATOR . 'admin_login.php',
    'admin_logout.php' => $rootDir . DIRECTORY_SEPARATOR . 'backend' . DIRECTORY_SEPARATOR . 'admin_logout.php',
    'admin_api.php' => $rootDir . DIRECTORY_SEPARATOR . 'backend' . DIRECTORY_SEPARATOR . 'admin_api.php',
];

if (preg_match('#/(admin|admin-login|admin-logout|admin\.php|admin_login\.php|admin_logout\.php|admin_api\.php)(?:/)?$#', $path, $matches)) {
    $key = $matches[1];
    if (isset($adminMap[$key]) && file_exists($adminMap[$key])) {
        require $adminMap[$key];
        exit;
    }
}

$legacyHtml = $publicDir . DIRECTORY_SEPARATOR . 'app' . DIRECTORY_SEPARATOR . 'index.html';
$indexHtml = $publicDir . DIRECTORY_SEPARATOR . 'index.html';

if (file_exists($legacyHtml)) {
    $file = $legacyHtml;
} elseif (file_exists($indexHtml)) {
    $file = $indexHtml;
} else {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'index.html not found';
    exit;
}

header('Content-Type: text/html; charset=utf-8');
header('Cross-Origin-Opener-Policy: same-origin-allow-popups');
$content = @file_get_contents($file);
if ($content === false) {
    http_response_code(500);
    echo 'failed to read index file';
    exit;
}

// Ensure relative asset paths in built SPA resolve correctly even on nested routes
if ($file === $legacyHtml && stripos($content, '<base ') === false) {
    $scriptName = isset($_SERVER['SCRIPT_NAME']) ? (string) $_SERVER['SCRIPT_NAME'] : '/public/index.php';
    $publicPath = str_replace('\\', '/', dirname($scriptName));
    $publicPath = rtrim($publicPath, '/');
    if ($publicPath === '' || $publicPath === '.') {
        $publicPath = '/public';
    }
    $appBase = $publicPath . '/app/';
    $baseTag = '<base href="' . htmlspecialchars($appBase, ENT_QUOTES, 'UTF-8') . '">';

    // Normalize built absolute URLs from other environments (e.g. /xxxx/public/app/...) to current app base
    $content = preg_replace(
        '#(src|href)="/[^"]*/public/app/#i',
        '$1="' . $appBase,
        $content
    );

    if (stripos($content, '</head>') !== false) {
        $content = preg_replace('/<\/head>/i', "    {$baseTag}\n</head>", $content, 1);
    } else {
        $content = $baseTag . "\n" . $content;
    }
}

if ($file === $legacyHtml) {
    $removeAddSubjectScript = <<<'HTML'
<script>
(function () {
    function improveDifficultyLayout() {
        var labels = document.querySelectorAll('h1, h2, h3, h4, div, p, span, label');
        for (var i = 0; i < labels.length; i++) {
            var label = labels[i];
            var text = (label.textContent || '').replace(/\s+/g, ' ').trim();
            if (text !== 'ระดับความยาก') {
                continue;
            }

            var card = label.closest('section, article, div');
            if (!card) {
                continue;
            }

            var groups = card.querySelectorAll('div, nav');
            for (var g = 0; g < groups.length; g++) {
                var group = groups[g];
                var options = group.querySelectorAll('button, [role="button"]');
                if (options.length < 3) {
                    continue;
                }

                var matchCount = 0;
                for (var o = 0; o < options.length; o++) {
                    var optionText = (options[o].textContent || '').replace(/\s+/g, ' ').trim();
                    if (optionText === 'ง่าย' || optionText === 'ปานกลาง' || optionText === 'มาก') {
                        matchCount++;
                    }
                }
                if (matchCount < 3) {
                    continue;
                }

                group.style.display = 'flex';
                group.style.gap = '8px';
                group.style.flexWrap = 'nowrap';
                group.style.justifyContent = 'space-between';
                group.style.alignItems = 'center';

                for (var j = 0; j < options.length; j++) {
                    var btn = options[j];
                    var btnText = (btn.textContent || '').replace(/\s+/g, ' ').trim();
                    if (btnText === 'ปานกลาง') {
                        btn.textContent = 'กลาง';
                    }
                    btn.style.flex = '1 1 0';
                    btn.style.minWidth = '72px';
                    btn.style.whiteSpace = 'nowrap';
                    btn.style.textAlign = 'center';
                    btn.style.paddingLeft = '10px';
                    btn.style.paddingRight = '10px';
                }
            }
        }
    }

    function removeAddSubjectButton() {
        var path = (window.location.pathname || '').toLowerCase();
        if (path.indexOf('/calendar') === -1) {
            return;
        }

        // Remove any direct "เพิ่มวิชา" action on calendar page.
        var allActions = document.querySelectorAll('button, a');
        for (var k = 0; k < allActions.length; k++) {
            var actionNode = allActions[k];
            var actionLabel = (actionNode.textContent || '').replace(/\s+/g, ' ').trim();
            if (actionLabel === 'เพิ่มวิชา' || actionLabel.indexOf('เพิ่มวิชา') !== -1) {
                actionNode.remove();
            }
        }

        var titleNodes = document.querySelectorAll('h1, h2, h3, h4, div, p, span');
        for (var i = 0; i < titleNodes.length; i++) {
            var titleNode = titleNodes[i];
            var titleText = (titleNode.textContent || '').replace(/\s+/g, ' ').trim();
            if (titleText !== 'จัดการรายวิชาในระบบ') {
                continue;
            }

            var container = titleNode.closest('section, article, div');
            if (!container) {
                continue;
            }

            var actionNodes = container.querySelectorAll('button, a');
            for (var j = 0; j < actionNodes.length; j++) {
                var action = actionNodes[j];
                var actionText = (action.textContent || '').replace(/\s+/g, ' ').trim();
                if (actionText === 'เพิ่มวิชา' || actionText.indexOf('เพิ่มวิชา') !== -1) {
                    action.remove();
                }
            }
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            removeAddSubjectButton();
            improveDifficultyLayout();
        });
    } else {
        removeAddSubjectButton();
        improveDifficultyLayout();
    }

    var observer = new MutationObserver(function () {
        removeAddSubjectButton();
        improveDifficultyLayout();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
})();
</script>
HTML;

    if (stripos($content, '</body>') !== false) {
        $content = preg_replace('/<\/body>/i', $removeAddSubjectScript . "\n</body>", $content, 1);
    } else {
        $content .= "\n" . $removeAddSubjectScript;
    }
}

echo $content;
