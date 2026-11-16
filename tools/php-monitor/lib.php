<?php
/**
 * site-manager 外部監控：共用函式。
 *
 * 心跳狀態存在 data/state.json（以 flock 互斥）。格式：
 *   {
 *     "installed_at": 1763258400,              首次執行時間，從未收到心跳的排程以此起算
 *     "last_seen":   { "<job>": <unix time> }, 各排程最後一次心跳
 *     "alerted":     { "<問題 key>": "YYYY-MM-DD" } 已告警的問題與日期（同問題同日只告警一次）
 *   }
 *
 * 這支程式刻意不用 composer、不用資料庫：放在任何有 PHP 8.1+ 與 curl 的主機都能跑。
 */

declare(strict_types=1);

const MONITOR_TZ = 'Asia/Taipei';

function monitor_config(): array
{
    $file = __DIR__ . '/config.php';
    if (!is_file($file)) {
        throw new RuntimeException('找不到 config.php，請複製 config.example.php 並填好設定');
    }
    $config = require $file;
    foreach (['token', 'health_url', 'jobs'] as $key) {
        if (empty($config[$key])) {
            throw new RuntimeException("config.php 缺少 {$key}");
        }
    }
    return $config;
}

function state_path(): string
{
    return __DIR__ . '/data/state.json';
}

/**
 * 在檔案鎖內讀出狀態、交給 $fn 修改、寫回。回傳 $fn 的回傳值。
 * heartbeat.php 與 check.php 可能同時執行，沒有鎖會互相覆蓋。
 */
function with_state(callable $fn, ?string $path = null)
{
    $path = $path ?? state_path();
    if (!is_dir(dirname($path))) {
        mkdir(dirname($path), 0700, true);
    }
    $fp = fopen($path, 'c+');
    if ($fp === false) {
        throw new RuntimeException("無法開啟狀態檔 {$path}");
    }
    try {
        flock($fp, LOCK_EX);
        $raw = stream_get_contents($fp);
        $state = $raw ? json_decode($raw, true) : null;
        if (!is_array($state)) {
            $state = ['installed_at' => time(), 'last_seen' => [], 'alerted' => []];
        }
        $result = $fn($state);
        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        fflush($fp);
        return $result;
    } finally {
        flock($fp, LOCK_UN);
        fclose($fp);
    }
}

function format_duration(int $seconds): string
{
    if ($seconds >= 86400) {
        return round($seconds / 86400, 1) . ' 天';
    }
    if ($seconds >= 3600) {
        return round($seconds / 3600, 1) . ' 小時';
    }
    return max(1, (int) round($seconds / 60)) . ' 分鐘';
}

/**
 * 找出目前的問題。純函式，方便測試。
 *
 * @param array $jobs        job => 逾時門檻（秒）
 * @param int|null $health   /healthz 的 HTTP 狀態碼；null = 連不上
 * @return array<string,string> 問題 key => 說明
 */
function evaluate(array $state, array $jobs, ?int $health, int $now): array
{
    $problems = [];
    if ($health !== 200) {
        $problems['health'] = $health === null
            ? 'VPS 健康檢查連不上（主機或網路可能停了）'
            : "VPS 健康檢查回應 HTTP {$health}（資料庫可能斷線）";
    }
    $since = (int) ($state['installed_at'] ?? $now);
    foreach ($jobs as $job => $threshold) {
        $last = $state['last_seen'][$job] ?? null;
        $silent = $now - (int) ($last ?? $since);
        if ($silent > $threshold) {
            $problems["job:{$job}"] = $last === null
                ? "排程 {$job} 從監控啟用以來 " . format_duration($silent) . ' 都沒有回報'
                : "排程 {$job} 已經 " . format_duration($silent) . ' 沒有回報（門檻 ' . format_duration($threshold) . '）';
        }
    }
    return $problems;
}

/**
 * 去重：同一個問題同一天只告警一次；問題消失時回報恢復並清掉紀錄。
 * 會修改 $state['alerted']。
 *
 * @return array{alert: array<string,string>, recovered: string[]}
 */
function plan_alerts(array &$state, array $problems, string $today): array
{
    $alerted = $state['alerted'] ?? [];
    $alert = [];
    foreach ($problems as $key => $message) {
        if (($alerted[$key] ?? null) !== $today) {
            $alert[$key] = $message;
            $alerted[$key] = $today;
        }
    }
    $recovered = [];
    foreach (array_keys($alerted) as $key) {
        if (!array_key_exists($key, $problems)) {
            $recovered[] = $key;
            unset($alerted[$key]);
        }
    }
    $state['alerted'] = $alerted;
    return ['alert' => $alert, 'recovered' => $recovered];
}

function today_taipei(int $now): string
{
    return (new DateTimeImmutable('@' . $now))->setTimezone(new DateTimeZone(MONITOR_TZ))->format('Y-m-d');
}

function http_status(string $url, int $timeout = 10): ?int
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_USERAGENT => 'site-manager-monitor',
    ]);
    curl_exec($ch);
    $code = curl_errno($ch) ? null : (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    return $code ?: null;
}

/** 推 LINE 給管理者。回傳是否成功 */
function send_line(array $config, string $text): bool
{
    if (empty($config['line_token']) || empty($config['line_to'])) {
        return false;
    }
    $ch = curl_init('https://api.line.me/v2/bot/message/push');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Authorization: Bearer ' . $config['line_token'],
        ],
        CURLOPT_POSTFIELDS => json_encode([
            'to' => $config['line_to'],
            'messages' => [['type' => 'text', 'text' => mb_substr($text, 0, 4900)]],
        ], JSON_UNESCAPED_UNICODE),
    ]);
    curl_exec($ch);
    $ok = !curl_errno($ch) && curl_getinfo($ch, CURLINFO_RESPONSE_CODE) === 200;
    curl_close($ch);
    return $ok;
}

/** 寄 Email（主機的 mail()）。回傳是否成功交給 MTA */
function send_mail(array $config, string $subject, string $body): bool
{
    if (empty($config['mail_to'])) {
        return false;
    }
    $headers = [
        'Content-Type: text/plain; charset=UTF-8',
        'From: ' . ($config['mail_from'] ?? 'monitor@localhost'),
    ];
    return mail($config['mail_to'], '=?UTF-8?B?' . base64_encode($subject) . '?=', $body, implode("\r\n", $headers));
}
