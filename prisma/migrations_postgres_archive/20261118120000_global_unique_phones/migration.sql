-- Global unique user phones and lead mobiles (whole database)

-- Resolve duplicate user phones: keep oldest, reassign others to unique placeholders
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY phone ORDER BY "createdAt" ASC) AS rn
  FROM "users"
)
UPDATE "users" u
SET phone = ('5' || right(replace(u.id::text, '-', ''), 9))
FROM ranked r
WHERE u.id = r.id AND r.rn > 1;

-- Resolve duplicate lead mobiles: keep oldest
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY "mobileNumber" ORDER BY "createdAt" ASC) AS rn
  FROM "leads"
)
UPDATE "leads" l
SET "mobileNumber" = ('5' || right(replace(l.id::text, '-', ''), 9))
FROM ranked r
WHERE l.id = r.id AND r.rn > 1;

-- Drop company-scoped uniques (constraint and/or index names vary)
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_phone_companyId_key";
DROP INDEX IF EXISTS "users_phone_companyId_key";

ALTER TABLE "leads" DROP CONSTRAINT IF EXISTS "leads_companyId_mobileNumber_key";
DROP INDEX IF EXISTS "leads_companyId_mobileNumber_key";

-- Add global uniques
CREATE UNIQUE INDEX IF NOT EXISTS "users_phone_key" ON "users"("phone");
CREATE UNIQUE INDEX IF NOT EXISTS "leads_mobileNumber_key" ON "leads"("mobileNumber");

CREATE INDEX IF NOT EXISTS "leads_mobileNumber_idx" ON "leads"("mobileNumber");
CREATE INDEX IF NOT EXISTS "leads_companyId_mobileNumber_idx" ON "leads"("companyId", "mobileNumber");
