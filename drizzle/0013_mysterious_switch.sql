CREATE TABLE `BotChannelPermission` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`botId` text NOT NULL,
	`channelId` text NOT NULL,
	FOREIGN KEY (`botId`) REFERENCES `BotManage`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channelId`) REFERENCES `Channel`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `BotChannelPermission_botId_channelId_unique` ON `BotChannelPermission` (`botId`,`channelId`);--> statement-breakpoint
CREATE INDEX `BotChannelPermission_channelId_idx` ON `BotChannelPermission` (`channelId`);--> statement-breakpoint
CREATE TABLE `BotManage` (
	`id` text PRIMARY KEY NOT NULL,
	`createdBy` text NOT NULL,
	`botName` text(64) NOT NULL,
	`remoteUserId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`tokenCode` text NOT NULL,
	`canFetchUserinfo` integer DEFAULT false NOT NULL,
	`canFetchRoleinfo` integer DEFAULT false NOT NULL,
	`canManageUser` integer DEFAULT false NOT NULL,
	`canManageServerConfig` integer DEFAULT false NOT NULL,
	`canReadMessage` integer DEFAULT false NOT NULL,
	`canSendMessage` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`remoteUserId`) REFERENCES `User`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "BotManage_botName_chk" CHECK(length("BotManage"."botName") <= 64)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `BotManage_botName_unique` ON `BotManage` (`botName`);--> statement-breakpoint
CREATE UNIQUE INDEX `BotManage_remoteUserId_unique` ON `BotManage` (`remoteUserId`);--> statement-breakpoint
CREATE UNIQUE INDEX `BotManage_tokenCode_unique` ON `BotManage` (`tokenCode`);--> statement-breakpoint
ALTER TABLE `Message` ADD `isBot` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `ServerConfig` ADD `BotEnabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `ServerConfig` ADD `BotAutoApprove` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `User` ADD `isBot` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `User_isBot_idx` ON `User` (`isBot`);