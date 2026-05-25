CREATE SCHEMA "beacon";
--> statement-breakpoint
CREATE TYPE "public"."delivery_job_type" AS ENUM('deliver-immediate', 'deliver-digest');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('email', 'push', 'both');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('queued', 'delivered', 'failed', 'opted_out', 'duplicate', 'rate_limited');--> statement-breakpoint
CREATE TYPE "public"."urgency" AS ENUM('critical', 'high', 'normal', 'low');--> statement-breakpoint
CREATE TYPE "public"."user_notification_channel_type" AS ENUM('email', 'push');--> statement-breakpoint
CREATE TABLE "beacon"."notification_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"job_type" "delivery_job_type" NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"status" "notification_status" NOT NULL,
	"urgency" "urgency",
	"event_count" integer DEFAULT 1 NOT NULL,
	"provider_message_id" text,
	"error_message" text,
	"metadata" jsonb,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beacon"."notification_preferences" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"channel" "notification_channel" DEFAULT 'both' NOT NULL,
	"cooldown_secs" integer DEFAULT 300 NOT NULL,
	"is_opted_out" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_pk" PRIMARY KEY("tenant_id","user_id","category")
);
--> statement-breakpoint
CREATE TABLE "beacon"."tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"rate_limit_per_minute" integer DEFAULT 600 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beacon"."user_notification_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"channel_type" "user_notification_channel_type" NOT NULL,
	"destination" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beacon"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"external_user_id" text NOT NULL,
	"email" text,
	"push_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "beacon"."notification_logs" ADD CONSTRAINT "notification_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "beacon"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beacon"."notification_logs" ADD CONSTRAINT "notification_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "beacon"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beacon"."notification_preferences" ADD CONSTRAINT "notification_preferences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "beacon"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beacon"."notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "beacon"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beacon"."user_notification_channels" ADD CONSTRAINT "user_notification_channels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "beacon"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beacon"."user_notification_channels" ADD CONSTRAINT "user_notification_channels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "beacon"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beacon"."users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "beacon"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_logs_tenant_user_idx" ON "beacon"."notification_logs" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "notification_logs_status_idx" ON "beacon"."notification_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "notification_logs_created_at_idx" ON "beacon"."notification_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notification_preferences_tenant_user_idx" ON "beacon"."notification_preferences" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_unique" ON "beacon"."tenants" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "user_notification_channels_tenant_user_idx" ON "beacon"."user_notification_channels" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_notification_channels_unique_destination_per_type" ON "beacon"."user_notification_channels" USING btree ("user_id","channel_type","destination");--> statement-breakpoint
CREATE UNIQUE INDEX "users_tenant_external_user_unique" ON "beacon"."users" USING btree ("tenant_id","external_user_id");--> statement-breakpoint
CREATE INDEX "users_tenant_idx" ON "beacon"."users" USING btree ("tenant_id");