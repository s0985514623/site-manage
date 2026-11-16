<?php
/**
 * 門檻計算與去重的測試（純 PHP，不需要 PHPUnit）：
 *
 *   php tests/run.php
 */

declare(strict_types=1);

require __DIR__ . '/../lib.php';

$failures = 0;
function check(string $name, bool $ok): void
{
    global $failures;
    echo ($ok ? '  ✓ ' : '  ✗ ') . $name . "\n";
    if (!$ok) {
        $failures++;
    }
}

$jobs = ['quote-draft' => 26 * 3600, 'weekly-report' => 8 * 86400, 'uptime' => 3 * 3600];
$now = strtotime('2026-11-16T10:00:00+08:00');
$h = 3600;

echo "evaluate\n";
$state = ['installed_at' => $now - 30 * 86400, 'last_seen' => [
    'quote-draft' => $now - 25 * $h,
    'weekly-report' => $now - 7 * 86400,
    'uptime' => $now - 2 * $h,
], 'alerted' => []];
check('全部在門檻內、健康 200 → 沒有問題', evaluate($state, $jobs, 200, $now) === []);

$state['last_seen']['quote-draft'] = $now - 27 * $h;
$p = evaluate($state, $jobs, 200, $now);
check('每日排程超過 26 小時 → 告警', array_keys($p) === ['job:quote-draft']);
check('訊息寫出已沉默多久', str_contains($p['job:quote-draft'], '1.1 天'));

$state['last_seen']['quote-draft'] = $now - 25 * $h;
$state['last_seen']['uptime'] = $now - 4 * $h;
check('每小時排程超過 3 小時 → 告警', array_keys(evaluate($state, $jobs, 200, $now)) === ['job:uptime']);

$state['last_seen']['uptime'] = $now - 2 * $h;
$state['last_seen']['weekly-report'] = $now - 9 * 86400;
check('每週排程超過 8 天 → 告警', array_keys(evaluate($state, $jobs, 200, $now)) === ['job:weekly-report']);

$state['last_seen']['weekly-report'] = $now - 7 * 86400;
check('健康檢查 503 → 告警', array_keys(evaluate($state, $jobs, 503, $now)) === ['health']);
check('健康檢查連不上 → 告警', str_contains(evaluate($state, $jobs, null, $now)['health'], '連不上'));

$fresh = ['installed_at' => $now - 2 * $h, 'last_seen' => [], 'alerted' => []];
check('剛啟用、還沒到門檻 → 不告警（從未回報的排程以啟用時間起算）', evaluate($fresh, ['quote-draft' => 26 * $h], 200, $now) === []);
$fresh['installed_at'] = $now - 27 * $h;
check('啟用超過門檻仍沒回報 → 告警', array_keys(evaluate($fresh, ['quote-draft' => 26 * $h], 200, $now)) === ['job:quote-draft']);

echo "plan_alerts\n";
$s = ['alerted' => []];
$first = plan_alerts($s, ['health' => 'x'], '2026-11-16');
check('第一次發現 → 告警', array_keys($first['alert']) === ['health']);
$again = plan_alerts($s, ['health' => 'x'], '2026-11-16');
check('同一天同一問題 → 不重複告警', $again['alert'] === []);
$next = plan_alerts($s, ['health' => 'x'], '2026-11-17');
check('隔天仍有問題 → 再告警一次', array_keys($next['alert']) === ['health']);
$ok = plan_alerts($s, [], '2026-11-17');
check('問題消失 → 回報恢復並清除紀錄', $ok['recovered'] === ['health'] && $s['alerted'] === []);

echo "today_taipei\n";
check('台北 00:30 時 UTC 還是前一天，日期以台北為準', today_taipei(strtotime('2026-11-17T00:30:00+08:00')) === '2026-11-17');

echo "with_state\n";
$tmp = sys_get_temp_dir() . '/php-monitor-test-' . getmypid() . '.json';
with_state(function (array &$st) { $st['last_seen']['uptime'] = 123; }, $tmp);
$read = with_state(fn (array &$st) => $st['last_seen']['uptime'] ?? null, $tmp);
check('寫入後讀得回來', $read === 123);
@unlink($tmp);

echo $failures === 0 ? "\n全部通過\n" : "\n{$failures} 項失敗\n";
exit($failures === 0 ? 0 : 1);
