CREATE TYPE "public"."approval_action" AS ENUM('approve', 'reject');--> statement-breakpoint
CREATE TYPE "public"."attachment_kind" AS ENUM('signed_quote', 'payment_proof', 'other');--> statement-breakpoint
CREATE TYPE "public"."billing_cycle" AS ENUM('monthly', 'quarterly', 'yearly', 'biennial', 'triennial');--> statement-breakpoint
CREATE TYPE "public"."client_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."contact_role" AS ENUM('decision', 'finance', 'tech', 'other');--> statement-breakpoint
CREATE TYPE "public"."detect_source" AS ENUM('whois', 'tls');--> statement-breakpoint
CREATE TYPE "public"."notify_channel" AS ENUM('email', 'line');--> statement-breakpoint
CREATE TYPE "public"."quote_status" AS ENUM('draft', 'pending_approval', 'sent', 'accepted', 'rejected', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."renewal_state" AS ENUM('upcoming', 'drafted', 'pending_approval', 'sent', 'accepted', 'renewed', 'declined');--> statement-breakpoint
CREATE TYPE "public"."service_status" AS ENUM('active', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."service_type" AS ENUM('domain', 'hosting', 'ssl', 'maintenance', 'email', 'license', 'cdn', 'other');--> statement-breakpoint
CREATE TYPE "public"."site_status" AS ENUM('building', 'live', 'paused', 'closed');--> statement-breakpoint
CREATE TYPE "public"."tax_mode" AS ENUM('exclusive', 'inclusive', 'none');--> statement-breakpoint
CREATE TABLE "activity_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by_line_user_id" text,
	"action" "approval_action",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"short_name" text,
	"tax_id" text,
	"representative" text,
	"address" text,
	"phone" text,
	"note" text,
	"status" "client_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" "contact_role" DEFAULT 'other' NOT NULL,
	"email" text,
	"phone" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"receive_quotes" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"label" text NOT NULL,
	"url" text,
	"username" text,
	"secret_encrypted" text NOT NULL,
	"secret_iv" text NOT NULL,
	"secret_tag" text NOT NULL,
	"note" text,
	"last_accessed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"level" integer NOT NULL,
	"channel" "notify_channel" NOT NULL,
	"sent_on" date NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ok" boolean DEFAULT true NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "oauth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text DEFAULT 'google' NOT NULL,
	"account_email" text NOT NULL,
	"refresh_token_encrypted" text NOT NULL,
	"refresh_token_iv" text NOT NULL,
	"refresh_token_tag" text NOT NULL,
	"scope" text,
	"last_error" text,
	"last_refreshed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "service_type" DEFAULT 'hosting' NOT NULL,
	"spec_note" text NOT NULL,
	"price_amount" numeric(12, 2),
	"billing_cycle" "billing_cycle" DEFAULT 'yearly' NOT NULL,
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"kind" "attachment_kind" DEFAULT 'signed_quote' NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"signed_on" date,
	"note" text,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"service_id" uuid,
	"description" text NOT NULL,
	"spec_note" text,
	"period_start" date,
	"period_end" date,
	"quantity" numeric(10, 2) DEFAULT '1' NOT NULL,
	"unit" text DEFAULT '年' NOT NULL,
	"unit_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_no" text NOT NULL,
	"project_name" text,
	"delivery_method" text,
	"payment_note" text,
	"client_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"status" "quote_status" DEFAULT 'draft' NOT NULL,
	"anchor_service_id" uuid,
	"anchor_date" date NOT NULL,
	"issue_date" date NOT NULL,
	"valid_until" date NOT NULL,
	"currency" text DEFAULT 'TWD' NOT NULL,
	"tax_mode" "tax_mode" DEFAULT 'exclusive' NOT NULL,
	"tax_rate" numeric(5, 4) DEFAULT '0.0500' NOT NULL,
	"subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"note" text,
	"terms" text,
	"pdf_key" text,
	"line_pushed_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"sent_to" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"type" "service_type" NOT NULL,
	"identifier" text NOT NULL,
	"provider" text,
	"provider_account" text,
	"auth_code_encrypted" text,
	"detect_host" text,
	"plan_id" uuid,
	"spec_note" text,
	"is_ours" boolean DEFAULT true NOT NULL,
	"started_at" date,
	"expires_at" date NOT NULL,
	"billing_cycle" "billing_cycle" DEFAULT 'yearly' NOT NULL,
	"auto_renew" boolean DEFAULT false NOT NULL,
	"cost_amount" numeric(12, 2),
	"price_amount" numeric(12, 2),
	"currency" text DEFAULT 'TWD' NOT NULL,
	"status" "service_status" DEFAULT 'active' NOT NULL,
	"renewal_state" "renewal_state" DEFAULT 'upcoming' NOT NULL,
	"current_quote_id" uuid,
	"detected_expires_at" date,
	"detect_source" "detect_source",
	"detected_at" timestamp with time zone,
	"detect_error" text,
	"gcal_event_id" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"company_name" text,
	"company_tax_id" text,
	"company_representative" text,
	"company_address" text,
	"company_phone" text,
	"company_email" text,
	"company_line_id" text,
	"prepared_by" text,
	"bank_name" text,
	"bank_code" text,
	"bank_account" text,
	"bank_account_name" text,
	"quote_payment_note" text,
	"quote_trigger_days" integer DEFAULT 45 NOT NULL,
	"quote_window_days" integer DEFAULT 60 NOT NULL,
	"quote_valid_days" integer DEFAULT 14 NOT NULL,
	"default_tax_mode" "tax_mode" DEFAULT 'exclusive' NOT NULL,
	"default_tax_rate" numeric(5, 4) DEFAULT '0.0500' NOT NULL,
	"quote_terms" text,
	"gcal_calendar_id" text,
	"line_push_count" integer DEFAULT 0 NOT NULL,
	"line_push_reset_at" date,
	"line_push_monthly_limit" integer DEFAULT 200 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"primary_url" text,
	"cms_type" text,
	"status" "site_status" DEFAULT 'live' NOT NULL,
	"dns_note" text,
	"monitor_enabled" boolean DEFAULT false NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_uptime_ok" boolean,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uptime_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ok" boolean NOT NULL,
	"status_code" integer,
	"response_ms" integer,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_attachments" ADD CONSTRAINT "quote_attachments_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_current_quote_id_quotes_id_fk" FOREIGN KEY ("current_quote_id") REFERENCES "public"."quotes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_checks" ADD CONSTRAINT "uptime_checks_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_logs_created_idx" ON "activity_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_token_hash_key" ON "approvals" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_one_open_per_quote" ON "approvals" USING btree ("quote_id") WHERE used_at is null;--> statement-breakpoint
CREATE INDEX "contacts_client_idx" ON "contacts" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "credentials_service_idx" ON "credentials" USING btree ("service_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_key" ON "notifications" USING btree ("service_id","level","channel","sent_on");--> statement-breakpoint
CREATE INDEX "notifications_service_idx" ON "notifications" USING btree ("service_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_tokens_provider_key" ON "oauth_tokens" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "plans_sort_idx" ON "plans" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "quote_attachments_quote_idx" ON "quote_attachments" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "quote_items_quote_idx" ON "quote_items" USING btree ("quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_quote_no_key" ON "quotes" USING btree ("quote_no");--> statement-breakpoint
CREATE INDEX "quotes_client_idx" ON "quotes" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "quotes_site_idx" ON "quotes" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "quotes_status_idx" ON "quotes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "services_site_idx" ON "services" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "services_expires_idx" ON "services" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "services_renewal_state_idx" ON "services" USING btree ("renewal_state");--> statement-breakpoint
CREATE INDEX "services_current_quote_idx" ON "services" USING btree ("current_quote_id");--> statement-breakpoint
CREATE INDEX "sites_client_idx" ON "sites" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "uptime_checks_site_time_idx" ON "uptime_checks" USING btree ("site_id","checked_at");