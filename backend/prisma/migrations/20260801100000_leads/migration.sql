-- Leads: a pipeline that exists before anyone has messaged.
--
-- Purely additive — four tables and three enums, plus one nullable column on
-- nothing existing. Both hand-written partial unique indexes
-- (`WorkflowInstance_one_active_per_conversation`, `Price_one_active_per_plan_interval`)
-- are untouched.
--
-- `Lead` is separate from `Customer` on purpose. `Customer` is keyed on `waId`
-- and created by the inbound webhook, so it cannot represent a name and a number
-- written down after a phone call. `Lead.customerId` links them when that person
-- does message.

CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST');

CREATE TYPE "LeadEventType" AS ENUM (
  'CREATED', 'UPDATED', 'STATUS_CHANGED', 'ASSIGNED', 'UNASSIGNED',
  'NOTE', 'CALL_LOGGED', 'REMINDER_SET', 'REMINDER_COMPLETED', 'LINKED_TO_CUSTOMER'
);

CREATE TYPE "CallOutcome" AS ENUM (
  'CONNECTED', 'NO_ANSWER', 'BUSY', 'WRONG_NUMBER', 'CALLBACK_REQUESTED'
);

CREATE TABLE "Lead" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "phone"           TEXT NOT NULL,
  "email"           TEXT,
  "company"         TEXT,
  "source"          TEXT,
  "status"          "LeadStatus" NOT NULL DEFAULT 'NEW',
  "ownerId"         TEXT,
  "valuePaise"      INTEGER,
  "notes"           TEXT,
  "customerId"      TEXT,
  "nextActionAt"    TIMESTAMP(3),
  "lastContactedAt" TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadEvent" (
  "id"         TEXT NOT NULL,
  "leadId"     TEXT NOT NULL,
  "type"       "LeadEventType" NOT NULL,
  "fromStatus" "LeadStatus",
  "toStatus"   "LeadStatus",
  "actorId"    TEXT,
  "body"       TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CallLog" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "leadId"          TEXT,
  "actorId"         TEXT,
  "phone"           TEXT NOT NULL,
  "outcome"         "CallOutcome" NOT NULL,
  "notes"           TEXT,
  "durationSeconds" INTEGER,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CallLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Reminder" (
  "id"          TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "leadId"      TEXT,
  "assigneeId"  TEXT NOT NULL,
  "dueAt"       TIMESTAMP(3) NOT NULL,
  "note"        TEXT NOT NULL,
  "completedAt" TIMESTAMP(3),
  "notifiedAt"  TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- One person is one lead. Two agents entering the same number is the most common
-- way a pipeline stops being trustworthy, and the second row silently detaches
-- every call and reminder recorded against the first.
CREATE UNIQUE INDEX "Lead_tenantId_phone_key" ON "Lead" ("tenantId", "phone");
CREATE UNIQUE INDEX "Lead_customerId_key" ON "Lead" ("customerId");
CREATE INDEX "Lead_tenantId_status_updatedAt_idx" ON "Lead" ("tenantId", "status", "updatedAt");
CREATE INDEX "Lead_tenantId_ownerId_idx" ON "Lead" ("tenantId", "ownerId");
CREATE INDEX "Lead_tenantId_nextActionAt_idx" ON "Lead" ("tenantId", "nextActionAt");

CREATE INDEX "LeadEvent_leadId_createdAt_idx" ON "LeadEvent" ("leadId", "createdAt");

CREATE INDEX "CallLog_tenantId_createdAt_idx" ON "CallLog" ("tenantId", "createdAt");
CREATE INDEX "CallLog_leadId_createdAt_idx" ON "CallLog" ("leadId", "createdAt");

CREATE INDEX "Reminder_tenantId_assigneeId_completedAt_dueAt_idx"
  ON "Reminder" ("tenantId", "assigneeId", "completedAt", "dueAt");
CREATE INDEX "Reminder_leadId_idx" ON "Reminder" ("leadId");
-- The sweep's query: open reminders that have come due, across every workspace.
CREATE INDEX "Reminder_completedAt_dueAt_idx" ON "Reminder" ("completedAt", "dueAt");

ALTER TABLE "Lead" ADD CONSTRAINT "Lead_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- SetNull, not Cascade: removing a colleague must not delete the pipeline they
-- were working. The lead returns to the unassigned pool.
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LeadEvent" ADD CONSTRAINT "LeadEvent_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- SetNull for the same reason `AuditEvent.superAdminId` is: deleting the person
-- must not erase the record of what they did.
ALTER TABLE "LeadEvent" ADD CONSTRAINT "LeadEvent_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Cascade here: a reminder for somebody who has left the workspace is noise on
-- nobody's list.
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_assigneeId_fkey"
  FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
