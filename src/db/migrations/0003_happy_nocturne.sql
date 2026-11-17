CREATE TYPE "public"."stamp_kind" AS ENUM('company', 'person');--> statement-breakpoint
CREATE TABLE "stamps" (
	"kind" "stamp_kind" PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"uploaded_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "stamp_enabled" boolean DEFAULT true NOT NULL;