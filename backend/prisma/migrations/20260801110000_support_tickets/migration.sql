-- Customer support: tickets raised from a conversation, worked, and answered.
--
-- Additive. Two tables, three enums, and two nullable columns added to tables
-- created in the Leads migration — `CallLog.ticketId` and `Reminder.ticketId`
-- were deliberately deferred there because `Ticket` did not exist yet. Both
-- hand-written partial unique indexes are untouched.

CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED');
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
CREATE TYPE "TicketEventType" AS ENUM (
  'OPENED', 'STATUS_CHANGED', 'ASSIGNED', 'UNASSIGNED', 'NOTE',
  'CUSTOMER_UPDATE', 'UPDATE_NOT_SENT', 'RESOLVED', 'REOPENED'
);

CREATE TABLE "Ticket" (
  "id"               TEXT NOT NULL,
  "tenantId"         TEXT NOT NULL,
  "number"           TEXT NOT NULL,
  "sequence"         INTEGER NOT NULL,
  "subject"          TEXT NOT NULL,
  "body"             TEXT NOT NULL,
  "status"           "TicketStatus" NOT NULL DEFAULT 'OPEN',
  "priority"         "TicketPriority" NOT NULL DEFAULT 'NORMAL',
  "customerId"       TEXT,
  "conversationId"   TEXT,
  "assigneeId"       TEXT,
  "openedById"       TEXT,
  "openedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "firstRespondedAt" TIMESTAMP(3),
  "resolvedAt"       TIMESTAMP(3),
  "closedAt"         TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TicketEvent" (
  "id"                TEXT NOT NULL,
  "ticketId"          TEXT NOT NULL,
  "type"              "TicketEventType" NOT NULL,
  "fromStatus"        "TicketStatus",
  "toStatus"          "TicketStatus",
  "actorId"           TEXT,
  "body"              TEXT,
  "visibleToCustomer" BOOLEAN NOT NULL DEFAULT false,
  "messageId"         TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TicketEvent_pkey" PRIMARY KEY ("id")
);

-- `sequence` is unique per workspace and is what makes the numbers gapless: it
-- is allocated inside the same transaction that writes the ticket, and this
-- index is the backstop if two concurrent raises ever pick the same one.
CREATE UNIQUE INDEX "Ticket_tenantId_number_key" ON "Ticket" ("tenantId", "number");
CREATE UNIQUE INDEX "Ticket_tenantId_sequence_key" ON "Ticket" ("tenantId", "sequence");
CREATE INDEX "Ticket_tenantId_status_updatedAt_idx" ON "Ticket" ("tenantId", "status", "updatedAt");
CREATE INDEX "Ticket_tenantId_assigneeId_idx" ON "Ticket" ("tenantId", "assigneeId");
CREATE INDEX "Ticket_conversationId_idx" ON "Ticket" ("conversationId");
CREATE INDEX "TicketEvent_ticketId_createdAt_idx" ON "TicketEvent" ("ticketId", "createdAt");

ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- SetNull throughout, not Cascade: deleting a customer, a conversation or a
-- colleague must not delete the record that their problem was dealt with.
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_assigneeId_fkey"
  FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_openedById_fkey"
  FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TicketEvent" ADD CONSTRAINT "TicketEvent_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TicketEvent" ADD CONSTRAINT "TicketEvent_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Deferred from 20260801100000_leads.
ALTER TABLE "CallLog"  ADD COLUMN "ticketId" TEXT;
ALTER TABLE "Reminder" ADD COLUMN "ticketId" TEXT;

CREATE INDEX "CallLog_ticketId_idx"  ON "CallLog"  ("ticketId");
CREATE INDEX "Reminder_ticketId_idx" ON "Reminder" ("ticketId");

ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
