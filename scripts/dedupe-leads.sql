-- Keep oldest lead per companyId + mobileNumber; null out newer duplicates' mobile temporarily then delete extras
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY "companyId", "mobileNumber" ORDER BY "createdAt" ASC, id ASC) AS rn
  FROM leads
  WHERE "mobileNumber" IS NOT NULL AND "mobileNumber" <> ''
)
UPDATE leads
SET "mobileNumber" = "mobileNumber" || '__dup_' || id
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

DELETE FROM leads
WHERE "mobileNumber" LIKE '%__dup_%';
