CREATE TABLE `BotManage` (
	`id` text PRIMARY KEY NOT NULL,
	`remoteUserId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`createdBy` text NOT NULL,
	`isApproved` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`remoteUserId`) REFERENCES `User`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `BotManage_createBy_idx` ON `BotManage` (`createdBy`);--> statement-breakpoint
CREATE INDEX `BotManage_remoteUserId_idx` ON `BotManage` (`remoteUserId`);--> statement-breakpoint
ALTER TABLE `ServerConfig` ADD `BotEnabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `User` ADD `isBot` integer DEFAULT false NOT NULL;