CREATE TYPE "public"."mail_check_status" AS ENUM('ok', 'warn', 'fail');--> statement-breakpoint
CREATE TABLE "mail_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"domain" text NOT NULL,
	"mailbox" text NOT NULL,
	"status" "mail_check_status" NOT NULL,
	"results" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "mailbox" text;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "dkim_selector" text;--> statement-breakpoint
ALTER TABLE "mail_checks" ADD CONSTRAINT "mail_checks_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_checks_service_time_idx" ON "mail_checks" USING btree ("service_id","checked_at");--> statement-breakpoint
-- 每天檢查一次企業信箱（DNS＋SMTP）。next_run_at 留 NULL：第一次 tick 只排定、不補跑。
INSERT INTO "scheduled_tasks" ("name", "kind", "job", "frequency", "interval_minutes", "time_of_day", "weekday", "system") VALUES
	('企業信箱檢查', 'builtin', 'mail-check', 'daily', NULL, '08:30', NULL, true);
