<?php
/**
 * 複製成 config.php 後填寫。config.php 不要提交進版控，也不要讓網頁讀得到（見 .htaccess）。
 */
return [
    // 與 site-manager 的 .env HEARTBEAT_TOKEN 相同。產生方式：openssl rand -hex 32
    'token' => '',

    // VPS 的健康檢查網址
    'health_url' => 'https://site-manager.ren-codes.com/healthz',

    // 告警推給誰：LINE Messaging API 的 channel access token 與你的 userId
    // （可以沿用 site-manager 的 LINE_CHANNEL_ACCESS_TOKEN / LINE_ADMIN_USER_ID）
    'line_token' => '',
    'line_to' => '',

    // 告警 Email（用這台主機的 mail()；共享主機通常可直接用）
    'mail_to' => '',
    'mail_from' => 'monitor@example.com',

    // 每支排程多久沒回報算停擺（秒）。名稱必須與 /api/cron/<名稱> 相同
    'jobs' => [
        'expiry-scan' => 26 * 3600,      // 每日
        'quote-draft' => 26 * 3600,      // 每日
        'quote-followup' => 26 * 3600,   // 每日
        'payment-followup' => 26 * 3600, // 每日
        'gcal-sync' => 26 * 3600,        // 每日
        'weekly-report' => 8 * 86400,    // 每週一
        'detect' => 8 * 86400,           // 每週一
        'uptime' => 3600,                // 每 15 分鐘
    ],
];
