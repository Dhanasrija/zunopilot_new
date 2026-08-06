-- A request body template on an operation, so a POST can send the payload its API actually
-- wants.
--
-- Until now the body was a flat object assembled from inputs declared `in: "body"`, which
-- cannot express a nested payload or a constant field — most real POST APIs need one or both.
--
-- Purely additive: two nullable columns. Null keeps the old flat-body behaviour exactly, so
-- every operation that already exists is unaffected. Nothing is altered or dropped, so the
-- two hand-written partial unique indexes are untouched.
ALTER TABLE "ConnectorOperation" ADD COLUMN "bodyTemplate" JSONB;
ALTER TABLE "ConnectorTypeOperation" ADD COLUMN "bodyTemplate" JSONB;
