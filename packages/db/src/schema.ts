import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const schemaName = "beacon";

export const beaconSchema = pgSchema(schemaName);

export const notificationChannelEnum = pgEnum("notification_channel", [
  "email",
  "push",
  "both"
]);

export const deliveryJobTypeEnum = pgEnum("delivery_job_type", [
  "deliver-immediate",
  "deliver-digest"
]);

export const notificationStatusEnum = pgEnum("notification_status", [
  "queued",
  "delivered",
  "failed",
  "opted_out",
  "duplicate",
  "rate_limited"
]);

export const urgencyEnum = pgEnum("urgency", [
  "critical",
  "high",
  "normal",
  "low"
]);

export const userNotificationChannelTypeEnum = pgEnum("user_notification_channel_type", [
  "email",
  "push"
]);

export const tenants = beaconSchema.table(
  "tenants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    rateLimitPerMinute: integer("rate_limit_per_minute").notNull().default(600),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex("tenants_slug_unique").on(table.slug)]
);

export const users = beaconSchema.table(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    externalUserId: text("external_user_id").notNull(),
    email: text("email"),
    pushToken: text("push_token"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("users_tenant_external_user_unique").on(table.tenantId, table.externalUserId),
    index("users_tenant_idx").on(table.tenantId)
  ]
);

export const userNotificationChannels = beaconSchema.table(
  "user_notification_channels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channelType: userNotificationChannelTypeEnum("channel_type").notNull(),
    destination: text("destination").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    isEnabled: boolean("is_enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("user_notification_channels_tenant_user_idx").on(table.tenantId, table.userId),
    uniqueIndex("user_notification_channels_unique_destination_per_type").on(
      table.userId,
      table.channelType,
      table.destination
    )
  ]
);

export const notificationPreferences = beaconSchema.table(
  "notification_preferences",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    channel: notificationChannelEnum("channel").notNull().default("both"),
    cooldownSecs: integer("cooldown_secs").notNull().default(300),
    isOptedOut: boolean("is_opted_out").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    primaryKey({
      name: "notification_preferences_pk",
      columns: [table.tenantId, table.userId, table.category]
    }),
    index("notification_preferences_tenant_user_idx").on(table.tenantId, table.userId)
  ]
);

export const notificationLogs = beaconSchema.table(
  "notification_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    jobType: deliveryJobTypeEnum("job_type").notNull(),
    channel: notificationChannelEnum("channel").notNull(),
    status: notificationStatusEnum("status").notNull(),
    urgency: urgencyEnum("urgency"),
    eventCount: integer("event_count").notNull().default(1),
    providerMessageId: text("provider_message_id"),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("notification_logs_tenant_user_idx").on(table.tenantId, table.userId),
    index("notification_logs_status_idx").on(table.status),
    index("notification_logs_created_at_idx").on(table.createdAt)
  ]
);

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserNotificationChannel = typeof userNotificationChannels.$inferSelect;
export type NewUserNotificationChannel = typeof userNotificationChannels.$inferInsert;
export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type NewNotificationPreference = typeof notificationPreferences.$inferInsert;
export type NotificationLog = typeof notificationLogs.$inferSelect;
export type NewNotificationLog = typeof notificationLogs.$inferInsert;
