<?php
/**
 * 心跳端點：site-manager 每支排程成功後 POST 到這裡。
 *
 *   POST /heartbeat.php?job=quote-draft
 *   Authorization: Bearer <token>
 *
 * 只記錄「這支排程最後一次成功的時間」，判斷與告警在 check.php。
 */

declare(strict_types=1);

require __DIR__ . '/lib.php';

header('Content-Type: application/json; charset=utf-8');

function respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond(405, ['error' => 'method not allowed']);
}

try {
    $config = monitor_config();
} catch (Throwable $e) {
    respond(500, ['error' => 'not configured']);
}

// Authorization 標頭在部分 Apache / CGI 設定下會被拿掉，兩個來源都看
$auth = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
$token = preg_replace('/^Bearer\s+/i', '', $auth);
if (!is_string($token) || !hash_equals((string) $config['token'], $token)) {
    respond(401, ['error' => 'unauthorized']);
}

$job = (string) ($_GET['job'] ?? '');
if (!array_key_exists($job, $config['jobs'])) {
    respond(400, ['error' => 'unknown job']);
}

with_state(function (array &$state) use ($job) {
    $state['last_seen'][$job] = time();
});

respond(200, ['ok' => true, 'job' => $job]);
