ALTER TABLE "batch_event_receipts" ADD CONSTRAINT "batch_event_receipts_sequence_number_check" CHECK ("batch_event_receipts"."sequence_number" >= 0);--> statement-breakpoint
ALTER TABLE "error_events" ADD CONSTRAINT "error_events_sequence_number_check" CHECK ("error_events"."sequence_number" >= 0);--> statement-breakpoint
ALTER TABLE "error_events" ADD CONSTRAINT "error_events_grouping_version_check" CHECK ("error_events"."grouping_version" > 0);--> statement-breakpoint
ALTER TABLE "error_groups" ADD CONSTRAINT "error_groups_event_count_check" CHECK ("error_groups"."event_count" > 0);--> statement-breakpoint
ALTER TABLE "error_groups" ADD CONSTRAINT "error_groups_grouping_version_check" CHECK ("error_groups"."grouping_version" > 0);--> statement-breakpoint
ALTER TABLE "ingestion_batches" ADD CONSTRAINT "ingestion_batches_request_size_check" CHECK ("ingestion_batches"."request_size_bytes" between 1 and 512000);--> statement-breakpoint
ALTER TABLE "ingestion_batches" ADD CONSTRAINT "ingestion_batches_event_count_check" CHECK ("ingestion_batches"."event_count" between 1 and 5000);--> statement-breakpoint
ALTER TABLE "ingestion_batches" ADD CONSTRAINT "ingestion_batches_accepted_count_check" CHECK ("ingestion_batches"."accepted_count" >= 0);--> statement-breakpoint
ALTER TABLE "ingestion_batches" ADD CONSTRAINT "ingestion_batches_duplicate_count_check" CHECK ("ingestion_batches"."duplicate_count" >= 0);