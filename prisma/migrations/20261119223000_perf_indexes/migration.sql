-- Lead queue / unworked / inbox filters
CREATE INDEX `leads_companyId_assignedToId_updatedAt_idx` ON `leads`(`companyId`, `assignedToId`, `updatedAt`);
CREATE INDEX `leads_companyId_assignedToId_lastContactedAt_idx` ON `leads`(`companyId`, `assignedToId`, `lastContactedAt`);
CREATE INDEX `leads_companyId_assignedToId_nextFollowUpAt_idx` ON `leads`(`companyId`, `assignedToId`, `nextFollowUpAt`);

-- CallRecord MIS filters
CREATE INDEX `call_records_companyId_campaignId_createdAt_idx` ON `call_records`(`companyId`, `campaignId`, `createdAt`);
CREATE INDEX `call_records_companyId_disposition_createdAt_idx` ON `call_records`(`companyId`, `disposition`, `createdAt`);

-- Online telecallers / dashboard
CREATE INDEX `session_logs_isActive_loginAt_idx` ON `session_logs`(`isActive`, `loginAt`);
CREATE INDEX `users_companyId_roleId_status_idx` ON `users`(`companyId`, `roleId`, `status`);
