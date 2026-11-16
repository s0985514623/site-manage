CREATE TYPE "public"."line_flow_step" AS ENUM('choose_client', 'choose_category', 'input_name', 'choose_due_date');--> statement-breakpoint
CREATE TYPE "public"."notify_kind" AS ENUM('expiry', 'quote_followup', 'payment_followup', 'weekly_report', 'quote_draft');--> statement-breakpoint
CREATE TYPE "public"."project_category" AS ENUM('new_site', 'custom_plugin', 'bug_fix', 'other');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('not_started', 'in_progress', 'in_review', 'completed');--> statement-breakpoint
CREATE TABLE "line_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"line_user_id" text NOT NULL,
	"step" "line_flow_step" NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "line_conversations_line_user_id_unique" UNIQUE("line_user_id")
);
--> statement-breakpoint
CREATE TABLE "project_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"due_on" date NOT NULL,
	"completed_at" timestamp with time zone,
	"gcal_event_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"site_id" uuid,
	"name" text NOT NULL,
	"category" "project_category" NOT NULL,
	"status" "project_status" DEFAULT 'not_started' NOT NULL,
	"start_date" date,
	"due_date" date,
	"description" text,
	"estimated_amount" numeric(12, 2),
	"currency" text DEFAULT 'TWD' NOT NULL,
	"handover_completed_at" timestamp with time zone,
	"gcal_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "notifications_dedupe_key";--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "service_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "level" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "quotes" ALTER COLUMN "site_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ALTER COLUMN "anchor_date" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "kind" "notify_kind" DEFAULT 'expiry' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "quote_id" uuid;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "paid_on" date;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "paid_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "source_project_id" uuid;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "gcal_project_calendar_id" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "auto_send_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "quote_followup_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_milestones_project_idx" ON "project_milestones" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "projects_client_idx" ON "projects" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "projects_status_due_idx" ON "projects" USING btree ("status","due_date");--> statement-breakpoint
CREATE INDEX "projects_category_idx" ON "projects" USING btree ("category");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_source_project_id_projects_id_fk" FOREIGN KEY ("source_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_service" ON "notifications" USING btree ("kind","service_id","level","channel","sent_on") WHERE service_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_quote" ON "notifications" USING btree ("kind","quote_id","channel","sent_on") WHERE quote_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_global" ON "notifications" USING btree ("kind","channel","sent_on") WHERE service_id is null and quote_id is null;--> statement-breakpoint
CREATE INDEX "notifications_quote_idx" ON "notifications" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "quotes_project_idx" ON "quotes" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_site_or_project" CHECK ("quotes"."site_id" is not null or "quotes"."project_id" is not null);--> statement-breakpoint
-- D1：既有安裝維持「LINE 確認後自動寄」，部署不改變行為。新安裝沒有設定列，建立時用預設 false（手動寄）
UPDATE "settings" SET "auto_send_enabled" = true;
