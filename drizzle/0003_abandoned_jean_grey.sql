ALTER TABLE `User` ADD `createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL;--> statement-breakpoint
CREATE INDEX `User_id_createdAt_idx` ON `User` (`id`,`createdAt`);