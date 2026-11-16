<?php
/**
 * 每 15 分鐘由主機 cron 執行：檢查 VPS 健康與各排程心跳，有問題就發 LINE + Email。
 *
 *   * /15 * * * * php /path/to/php-monitor/check.php
 *
 * 同一個問題同一天只告警一次；問題消失時發一則「已恢復」。
 * 只允許命令列執行（避免被外部觸發大量告警）。
 */

declare(strict_types=1);

require __DIR__ . '/lib.php';

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("forbidden\n");
}

$config = monitor_config();
$now = time();
$health = http_status($config['health_url']);

$plan = with_state(function (array &$state) use ($config, $health, $now) {
    $problems = evaluate($state, $config['jobs'], $health, $now);
    return plan_alerts($state, $problems, today_taipei($now));
});

$lines = [];
foreach ($plan['alert'] as $message) {
    $lines[] = "⚠ {$message}";
}
foreach ($plan['recovered'] as $key) {
    $lines[] = '✓ 已恢復：' . ($key === 'health' ? 'VPS 健康檢查' : '排程 ' . substr($key, 4));
}

if ($lines === []) {
    echo "ok\n";
    exit(0);
}

$text = "[site-manager 監控]\n" . implode("\n", $lines) . "\n\n" . $config['health_url'];
$line = send_line($config, $text);
$mail = send_mail($config, '[site-manager 監控] ' . (count($plan['alert']) ? '發現問題' : '已恢復'), $text);
echo $text . "\n\nLINE: " . ($line ? 'sent' : 'failed') . ', Email: ' . ($mail ? 'sent' : 'failed') . "\n";

if (!$line && !$mail) {
    // 兩個管道都沒送出去：不算已告警，15 分鐘後下一輪再試
    with_state(function (array &$state) use ($plan) {
        foreach (array_keys($plan['alert']) as $key) {
            unset($state['alerted'][$key]);
        }
    });
}
// 兩個管道都失敗時以非零結束，主機 cron 的錯誤信至少還會寄出來
exit($line || $mail ? 0 : 1);
