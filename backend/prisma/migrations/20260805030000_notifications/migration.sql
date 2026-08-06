-- Notifications: a row per thing someone should know about, plus per-user preferences and
-- per-device push subscriptions.
--
-- Until now an inbound WhatsApp message produced no signal unless the Inbox happened to be
-- open, because the only mechanism was that page's own one-second poll. Nothing survived a
-- closed tab.
--
-- Purely additive: three new tables and one new enum. No existing table is altered and nothing
-- is dropped, so the two hand-written partial unique indexes
-- (WorkflowInstance_one_active_per_conversation and Price_one_active_per_plan_interval) are
-- untouched.
--
-- Two constraints worth reading before changing anything here:
--
--   • Notification(tenantId, dedupeKey) is UNIQUE. Both inbound paths can see the same
--     WhatsApp message and pg-boss retries failed jobs, so the provider's message id is the
--     dedupe key and a retry collides instead of notifying twice. Postgres permits many NULLs
--     in a unique index, so notifications with nothing to dedupe on coexist freely.
--   • PushSubscription.endpoint is UNIQUE. It is the push service's own URL for one browser on
--     one device, so re-subscribing the same browser updates its row rather than adding another.

CREATE TYPE "NotificationKind" AS ENUM ('MESSAGE_RECEIVED', 'HANDOFF_REQUESTED', 'ORDER_CREATED');

CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    -- Null means the whole workspace, which is the normal case for a customer message.
    "userId" TEXT,
    "kind" "NotificationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "conversationId" TEXT,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- Covers the unread count, which runs on every poll of every open tab.
CREATE INDEX "Notification_tenantId_userId_readAt_idx" ON "Notification"("tenantId", "userId", "readAt");
CREATE INDEX "Notification_tenantId_createdAt_idx" ON "Notification"("tenantId", "createdAt");
CREATE UNIQUE INDEX "Notification_tenantId_dedupeKey_key" ON "Notification"("tenantId", "dedupeKey");

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "browser" BOOLEAN NOT NULL DEFAULT true,
    -- Off by default: push needs a per-device subscription that only exists once the person
    -- has granted permission in that browser.
    "push" BOOLEAN NOT NULL DEFAULT false,
    "messageReceived" BOOLEAN NOT NULL DEFAULT true,
    "handoffRequested" BOOLEAN NOT NULL DEFAULT true,
    "orderCreated" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationPreference_userId_key" ON "NotificationPreference"("userId");

ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
