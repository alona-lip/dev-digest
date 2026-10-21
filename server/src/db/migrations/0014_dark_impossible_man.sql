ALTER TABLE "skills" ADD COLUMN "scan_status" text DEFAULT 'clean' NOT NULL;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "scan_method" text DEFAULT 'pattern' NOT NULL;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "scan_findings" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "scanned_at" timestamp with time zone;