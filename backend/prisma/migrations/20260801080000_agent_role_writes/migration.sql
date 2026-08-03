-- Keep existing Agent roles behaving as they did.
--
-- `customers:write` and `orders:write` were in the permission vocabulary but no
-- route enforced them, so every member could edit a customer and advance an order.
-- Those routes are now gated — which is what makes a restrictive custom role
-- possible at all — so the seeded Agent role has to carry them, or today's agents
-- silently lose something they have been doing all along.
--
-- Only touches roles this product seeded (`isSystem`) and only where the
-- permission is absent, so a workspace that has already customised its Agent role
-- is left exactly as it chose.

UPDATE "Role"
SET "permissions" = array_append("permissions", 'customers:write')
WHERE "isSystem" = true
  AND "isOwner" = false
  AND 'inbox:reply' = ANY("permissions")
  AND NOT ('customers:write' = ANY("permissions"));

UPDATE "Role"
SET "permissions" = array_append("permissions", 'orders:write')
WHERE "isSystem" = true
  AND "isOwner" = false
  AND 'inbox:reply' = ANY("permissions")
  AND NOT ('orders:write' = ANY("permissions"));
