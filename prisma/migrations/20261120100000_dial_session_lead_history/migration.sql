ALTER TABLE `dial_session_events`
    ADD COLUMN `leadId` VARCHAR(191) NULL,
    ADD INDEX `dial_session_events_sessionId_eventType_leadId_idx`(`sessionId`, `eventType`, `leadId`);
