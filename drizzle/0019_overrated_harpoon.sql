CREATE TABLE `MessagePinned` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` text NOT NULL,
	`messageId` text NOT NULL,
	`channelId` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE no action,
	FOREIGN KEY (`messageId`) REFERENCES `Message`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`channelId`) REFERENCES `Channel`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `MessagePinned_messageId_unique` ON `MessagePinned` (`messageId`);--> statement-breakpoint
CREATE INDEX `MessagePinned_channelId_idx` ON `MessagePinned` (`channelId`);--> statement-breakpoint
CREATE INDEX `MessagePinned_channelId_createdAt_idx` ON `MessagePinned` (`channelId`,`createdAt`);--> statement-breakpoint
CREATE UNIQUE INDEX `MessagePinned_channelId_messageId_uq` ON `MessagePinned` (`channelId`,`messageId`);