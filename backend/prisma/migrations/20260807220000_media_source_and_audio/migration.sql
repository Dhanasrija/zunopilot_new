-- Inbound customer media: an audio kind, and a source that decides who may read a file.
--
-- Until now every `MediaAsset` was a template header the business uploaded, and the route that
-- serves them is deliberately unauthenticated — Meta fetches template media from its own
-- servers and cannot present a bearer token. That trade is fine for a marketing image the
-- business chose to broadcast.
--
-- It is not fine for what a customer sends. A photograph of a damaged delivery, an ID document,
-- a prescription: serving those from the same open route would publish them to anyone holding
-- the id. `source` is what keeps the two apart — the public route refuses anything INBOUND, and
-- an authenticated, tenant-scoped route serves those instead.
--
-- `AUDIO` exists because a customer can send a voice note. A template header cannot be one, so
-- it never appears in the upload rules.
--
-- Purely additive: one enum value, one new enum, one column with a default that makes every
-- existing row exactly what it already was. Nothing is altered or dropped, so the two
-- hand-written partial unique indexes are untouched.

-- AlterEnum
ALTER TYPE "MediaKind" ADD VALUE 'AUDIO';

-- CreateEnum
CREATE TYPE "MediaSource" AS ENUM ('UPLOAD', 'INBOUND');

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN "source" "MediaSource" NOT NULL DEFAULT 'UPLOAD';
