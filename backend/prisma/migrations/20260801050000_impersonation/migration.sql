-- Support access (impersonation).
--
-- Additive: one enum, two tables, no ALTER on anything existing. Both
-- hand-written partial unique indexes are untouched.

CREATE TYPE "ImpersonationStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'REVOKED', 'EXPIRED');

CREATE TABLE "ImpersonationGrant" (
  "id"                TEXT NOT NULL,
  "tenantId"          TEXT NOT NULL,
  "requestedById"     TEXT NOT NULL,
  "reason"            TEXT NOT NULL,
  "status"            "ImpersonationStatus" NOT NULL DEFAULT 'PENDING',
  "requestExpiresAt"  TIMESTAMP(3) NOT NULL,
  "respondedAt"       TIMESTAMP(3),
  "respondedByUserId" TEXT,
  "approvedUntil"     TIMESTAMP(3),
  "revokedAt"         TIMESTAMP(3),
  "revokedByUserId"   TEXT,
  "revokedBySelf"     BOOLEAN NOT NULL DEFAULT false,
  "viewAsUserId"      TEXT,
  "startedAt"         TIMESTAMP(3),
  "lastUsedAt"        TIMESTAMP(3),
  "requestCount"      INTEGER NOT NULL DEFAULT 0,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ImpersonationGrant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImpersonationGrant_tenantId_createdAt_idx" ON "ImpersonationGrant"("tenantId", "createdAt");
CREATE INDEX "ImpersonationGrant_status_requestExpiresAt_idx" ON "ImpersonationGrant"("status", "requestExpiresAt");

CREATE TABLE "ImpersonationAccessLog" (
  "id"      TEXT NOT NULL,
  "grantId" TEXT NOT NULL,
  "method"  TEXT NOT NULL,
  "path"    TEXT NOT NULL,
  "at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ImpersonationAccessLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImpersonationAccessLog_grantId_at_idx" ON "ImpersonationAccessLog"("grantId", "at");

ALTER TABLE "ImpersonationGrant" ADD CONSTRAINT "ImpersonationGrant_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImpersonationGrant" ADD CONSTRAINT "ImpersonationGrant_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "SuperAdmin"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImpersonationGrant" ADD CONSTRAINT "ImpersonationGrant_respondedByUserId_fkey"
  FOREIGN KEY ("respondedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ImpersonationGrant" ADD CONSTRAINT "ImpersonationGrant_viewAsUserId_fkey"
  FOREIGN KEY ("viewAsUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ImpersonationAccessLog" ADD CONSTRAINT "ImpersonationAccessLog_grantId_fkey"
  FOREIGN KEY ("grantId") REFERENCES "ImpersonationGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
