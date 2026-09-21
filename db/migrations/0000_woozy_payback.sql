CREATE TYPE "public"."batch_status" AS ENUM('received', 'processing', 'processed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."error_type" AS ENUM('console_error', 'network_error');--> statement-breakpoint
CREATE TYPE "public"."group_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."receipt_outcome" AS ENUM('accepted', 'duplicate');--> statement-breakpoint
CREATE TABLE "batch_event_receipts" (
	"batch_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"sequence_number" integer NOT NULL,
	"outcome" "receipt_outcome" NOT NULL,
	CONSTRAINT "batch_event_receipts_batch_id_event_id_pk" PRIMARY KEY("batch_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "error_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"sequence_number" integer NOT NULL,
	"type" "error_type" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"normalized_summary" text,
	"fingerprint" varchar(64),
	"grouping_version" smallint DEFAULT 1 NOT NULL,
	"group_id" uuid,
	"group_was_created" boolean DEFAULT false NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "error_groups" (
	"group_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grouping_version" smallint NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"type" "error_type" NOT NULL,
	"title" text NOT NULL,
	"culprit" text,
	"status" "group_status" DEFAULT 'open' NOT NULL,
	"event_count" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_batches" (
	"batch_id" uuid PRIMARY KEY NOT NULL,
	"schema_version" smallint NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"status" "batch_status" DEFAULT 'received' NOT NULL,
	"request_size_bytes" integer NOT NULL,
	"body_hash" varchar(64) NOT NULL,
	"event_count" integer NOT NULL,
	"accepted_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"failure_reason" text
);
--> statement-breakpoint
ALTER TABLE "batch_event_receipts" ADD CONSTRAINT "batch_event_receipts_batch_id_ingestion_batches_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."ingestion_batches"("batch_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_event_receipts" ADD CONSTRAINT "batch_event_receipts_event_id_error_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."error_events"("event_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_events" ADD CONSTRAINT "error_events_batch_id_ingestion_batches_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."ingestion_batches"("batch_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_events" ADD CONSTRAINT "error_events_group_id_error_groups_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."error_groups"("group_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "batch_event_receipts_batch_sequence_idx" ON "batch_event_receipts" USING btree ("batch_id","sequence_number");--> statement-breakpoint
CREATE INDEX "error_events_batch_idx" ON "error_events" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "error_events_group_occurred_idx" ON "error_events" USING btree ("group_id","occurred_at");--> statement-breakpoint
CREATE INDEX "error_events_fingerprint_idx" ON "error_events" USING btree ("fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "error_groups_fingerprint_version_uidx" ON "error_groups" USING btree ("grouping_version","fingerprint");--> statement-breakpoint
CREATE INDEX "error_groups_inbox_idx" ON "error_groups" USING btree ("status","last_seen_at");--> statement-breakpoint
CREATE INDEX "ingestion_batches_status_idx" ON "ingestion_batches" USING btree ("status");