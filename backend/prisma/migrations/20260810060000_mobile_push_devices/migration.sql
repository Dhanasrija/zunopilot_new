-- Reaching the Flutter app, and letting a client ask what changed instead of re-reading everything.
--
-- ── PushSubscription gains a second transport ────────────────────────────────
--
-- Web Push addresses a browser by `endpoint` and encrypts with the subscription's own keys; FCM
-- addresses a phone by a registration token. Both sets of columns live on one table and both are
-- nullable, so the fan-out, the per-person preference check and the dead-row policy stay in one
-- place. The three web columns are dropped from NOT NULL for that reason and no other — every
-- existing row keeps its values and its meaning, and `platform` defaults to WEB so it keeps them
-- under the right name.
--
-- `(userId, deviceId)` is the key a phone re-registers against, **not the token**: an FCM token
-- rotates on reinstall, on restore from backup and sometimes on its own, so keying on it would
-- leave a stale row behind on every rotation and push to the same phone several times over.
-- `deviceToken` stays unique for the opposite failure — a token left on two rows delivers one
-- person's notifications to another's screen. Web rows have a null `deviceId` and Postgres treats
-- NULLs as distinct, so a laptop and a desktop are still two rows.
--
-- ── Message.updatedAt ────────────────────────────────────────────────────────
--
-- Backfilled from `createdAt`, not from NOW(): every message would otherwise look as if it had
-- just changed, and the first client to ask "what changed since I last looked" would be handed the
-- entire history. The DB default only covers this statement and any future raw insert — Prisma
-- sets the column itself on every write.
--
-- Both hand-written partial unique indexes (WorkflowInstance_one_active_per_conversation,
-- Price_one_active_per_plan_interval) are untouched.

CREATE TYPE "PushPlatform" AS ENUM ('WEB', 'ANDROID', 'IOS');

ALTER TABLE "PushSubscription" ADD COLUMN "platform" "PushPlatform" NOT NULL DEFAULT 'WEB';
ALTER TABLE "PushSubscription" ADD COLUMN "deviceToken" TEXT;
ALTER TABLE "PushSubscription" ADD COLUMN "deviceId" TEXT;
ALTER TABLE "PushSubscription" ADD COLUMN "deviceName" TEXT;
ALTER TABLE "PushSubscription" ADD COLUMN "appVersion" TEXT;

ALTER TABLE "PushSubscription" ALTER COLUMN "endpoint" DROP NOT NULL;
ALTER TABLE "PushSubscription" ALTER COLUMN "p256dh" DROP NOT NULL;
ALTER TABLE "PushSubscription" ALTER COLUMN "auth" DROP NOT NULL;

CREATE UNIQUE INDEX "PushSubscription_deviceToken_key" ON "PushSubscription"("deviceToken");
CREATE UNIQUE INDEX "PushSubscription_userId_deviceId_key" ON "PushSubscription"("userId", "deviceId");

ALTER TABLE "Message" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "Message" SET "updatedAt" = "createdAt";

CREATE INDEX "Message_conversationId_updatedAt_idx" ON "Message"("conversationId", "updatedAt");
