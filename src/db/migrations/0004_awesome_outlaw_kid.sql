CREATE TYPE "public"."schedule_frequency" AS ENUM('interval', 'daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."scheduled_task_kind" AS ENUM('builtin', 'line_message', 'http_request');--> statement-breakpoint
CREATE TABLE "scheduled_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" "scheduled_task_kind" NOT NULL,
	"job" text,
	"message" text,
	"url" text,
	"method" text,
	"frequency" "schedule_frequency" NOT NULL,
	"interval_minutes" integer,
	"time_of_day" text,
	"weekday" integer,
	"day_of_month" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"system" boolean DEFAULT false NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_ok" boolean,
	"last_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "scheduled_tasks_due_idx" ON "scheduled_tasks" USING btree ("enabled","next_run_at");--> statement-breakpoint
-- 種下原本 systemd timer 寫死的 8 支排程（時間與 deploy/systemd/*.timer 相同）。
-- next_run_at 留 NULL：第一次 tick 只排定下次時間，不會上線就補跑。
INSERT INTO "scheduled_tasks" ("name", "kind", "job", "frequency", "interval_minutes", "time_of_day", "weekday", "system") VALUES
	('Google 日曆對帳', 'builtin', 'gcal-sync', 'daily', NULL, '04:00', NULL, true),
	('WHOIS／TLS 到期偵測', 'builtin', 'detect', 'weekly', NULL, '08:00', 1, true),
	('到期掃描與提醒', 'builtin', 'expiry-scan', 'daily', NULL, '09:00', NULL, true),
	('LINE 每週週報', 'builtin', 'weekly-report', 'weekly', NULL, '09:00', 1, true),
	('擬定續約報價草稿', 'builtin', 'quote-draft', 'daily', NULL, '09:30', NULL, true),
	('報價未回覆追蹤', 'builtin', 'quote-followup', 'daily', NULL, '09:40', NULL, true),
	('未收款追蹤', 'builtin', 'payment-followup', 'daily', NULL, '09:45', NULL, true),
	('網站存活監控', 'builtin', 'uptime', 'interval', 15, NULL, NULL, true);
