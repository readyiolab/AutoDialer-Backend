-- Faster telecaller today/lists aggregates
CREATE INDEX `leads_assignedToId_companyId_campaignId_idx` ON `leads`(`assignedToId`, `companyId`, `campaignId`);
CREATE INDEX `call_records_companyId_userId_campaignId_idx` ON `call_records`(`companyId`, `userId`, `campaignId`);
CREATE INDEX `call_records_companyId_userId_category_createdAt_idx` ON `call_records`(`companyId`, `userId`, `category`, `createdAt`);
