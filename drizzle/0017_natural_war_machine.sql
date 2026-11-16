CREATE TABLE `__new_MessageFileAttached` (
	`id` text PRIMARY KEY NOT NULL,
	`channelId` text NOT NULL,
	`userId` text NOT NULL,
	`actualFileName` text NOT NULL,
	`savedFileName` text NOT NULL,
	`size` integer NOT NULL,
	`type` text NOT NULL,
	`messageId` text,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`channelId`) REFERENCES `Channel`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`messageId`) REFERENCES `Message`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_MessageFileAttached`(`id`, `channelId`, `userId`, `actualFileName`, `savedFileName`, `size`, `type`, `messageId`, `createdAt`)
SELECT f.`id`, f.`channelId`, f.`userId`, f.`actualFileName`, f.`savedFileName`, f.`size`, f.`type`, f.`messageId`,
	COALESCE(m.`createdAt`, unixepoch() * 1000)
FROM `MessageFileAttached` f
	LEFT JOIN `Message` m ON m.`id` = f.`messageId`;--> statement-breakpoint
DROP TABLE `MessageFileAttached`;--> statement-breakpoint
ALTER TABLE `__new_MessageFileAttached` RENAME TO `MessageFileAttached`;--> statement-breakpoint
CREATE INDEX `MessageFileAttached_channelId_idx` ON `MessageFileAttached` (`channelId`);--> statement-breakpoint
CREATE INDEX `MessageFileAttached_messageId_idx` ON `MessageFileAttached` (`messageId`);--> statement-breakpoint
CREATE INDEX `MessageFileAttached_userId_idx` ON `MessageFileAttached` (`userId`);
