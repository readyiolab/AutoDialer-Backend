-- Telecaller ↔ message template assignment for WhatsApp share
CREATE TABLE `user_message_templates` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `user_message_templates_userId_templateId_key`(`userId`, `templateId`),
    INDEX `user_message_templates_userId_idx`(`userId`),
    INDEX `user_message_templates_templateId_idx`(`templateId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `user_message_templates`
  ADD CONSTRAINT `user_message_templates_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `user_message_templates`
  ADD CONSTRAINT `user_message_templates_templateId_fkey`
    FOREIGN KEY (`templateId`) REFERENCES `message_templates`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
