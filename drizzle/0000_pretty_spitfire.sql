CREATE TABLE `BlockedIPAddress` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`address` text NOT NULL,
	`blockedCount` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	`latestAccess` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `BlockedIPAddress_address_unique` ON `BlockedIPAddress` (`address`);--> statement-breakpoint
CREATE TABLE `ChannelJoinOnDefault` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channelId` text NOT NULL,
	FOREIGN KEY (`channelId`) REFERENCES `Channel`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ChannelJoinOnDefault_channelId_unique` ON `ChannelJoinOnDefault` (`channelId`);--> statement-breakpoint
CREATE TABLE `ChannelJoin` (
	`channelJoinedAt` integer NOT NULL,
	`channelId` text NOT NULL,
	`userId` text NOT NULL,
	PRIMARY KEY(`userId`, `channelId`),
	FOREIGN KEY (`channelId`) REFERENCES `Channel`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `ChannelJoin_userId_idx` ON `ChannelJoin` (`userId`);--> statement-breakpoint
CREATE INDEX `ChannelJoin_channelId_idx` ON `ChannelJoin` (`channelId`);--> statement-breakpoint
CREATE TABLE `ChannelMute` (
	`userId` text NOT NULL,
	`channelId` text NOT NULL,
	`mutedAt` integer NOT NULL,
	PRIMARY KEY(`userId`, `channelId`),
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`channelId`) REFERENCES `Channel`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ChannelMute_userId_idx` ON `ChannelMute` (`userId`);--> statement-breakpoint
CREATE INDEX `ChannelMute_channelId_idx` ON `ChannelMute` (`channelId`);--> statement-breakpoint
CREATE TABLE `ChannelViewableRole` (
	`channelId` text NOT NULL,
	`roleId` text NOT NULL,
	PRIMARY KEY(`channelId`, `roleId`),
	FOREIGN KEY (`channelId`) REFERENCES `Channel`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`roleId`) REFERENCES `RoleInfo`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ChannelViewableRole_roleId_idx` ON `ChannelViewableRole` (`roleId`);--> statement-breakpoint
CREATE INDEX `ChannelViewableRole_channelId_idx` ON `ChannelViewableRole` (`channelId`);--> statement-breakpoint
CREATE TABLE `Channel` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`isArchived` integer DEFAULT false NOT NULL,
	`createdUserId` text NOT NULL,
	FOREIGN KEY (`createdUserId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Channel_name_unique` ON `Channel` (`name`);--> statement-breakpoint
CREATE TABLE `CustomEmoji` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`uploadedUserId` text NOT NULL,
	FOREIGN KEY (`uploadedUserId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `CustomEmoji_code_unique` ON `CustomEmoji` (`code`);--> statement-breakpoint
CREATE INDEX `CustomEmoji_uploadedUserId_idx` ON `CustomEmoji` (`uploadedUserId`);--> statement-breakpoint
CREATE TABLE `Inbox` (
	`type` text NOT NULL,
	`happendAt` integer NOT NULL,
	`messageId` text NOT NULL,
	`userId` text NOT NULL,
	PRIMARY KEY(`messageId`, `userId`),
	FOREIGN KEY (`messageId`) REFERENCES `Message`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `Inbox_userId_idx` ON `Inbox` (`userId`);--> statement-breakpoint
CREATE TABLE `Invitation` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`inviteCode` text NOT NULL,
	`createdUserId` text NOT NULL,
	`usedCount` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`createdUserId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Invitation_inviteCode_unique` ON `Invitation` (`inviteCode`);--> statement-breakpoint
CREATE TABLE `MessageFileAttached` (
	`id` text PRIMARY KEY NOT NULL,
	`channelId` text NOT NULL,
	`userId` text NOT NULL,
	`actualFileName` text NOT NULL,
	`savedFileName` text NOT NULL,
	`size` integer NOT NULL,
	`type` text NOT NULL,
	`messageId` text,
	FOREIGN KEY (`channelId`) REFERENCES `Channel`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`messageId`) REFERENCES `Message`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `MessageFileAttached_channelId_idx` ON `MessageFileAttached` (`channelId`);--> statement-breakpoint
CREATE INDEX `MessageFileAttached_messageId_idx` ON `MessageFileAttached` (`messageId`);--> statement-breakpoint
CREATE INDEX `MessageFileAttached_userId_idx` ON `MessageFileAttached` (`userId`);--> statement-breakpoint
CREATE TABLE `MessageReaction` (
	`id` text PRIMARY KEY NOT NULL,
	`channelId` text NOT NULL,
	`userId` text NOT NULL,
	`emojiCode` text NOT NULL,
	`messageId` text,
	`reactedAt` integer NOT NULL,
	FOREIGN KEY (`channelId`) REFERENCES `Channel`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`messageId`) REFERENCES `Message`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `MessageReaction_channelId_idx` ON `MessageReaction` (`channelId`);--> statement-breakpoint
CREATE INDEX `MessageReaction_messageId_idx` ON `MessageReaction` (`messageId`);--> statement-breakpoint
CREATE INDEX `MessageReaction_userId_idx` ON `MessageReaction` (`userId`);--> statement-breakpoint
CREATE TABLE `MessageReadTime` (
	`readTime` integer NOT NULL,
	`channelId` text NOT NULL,
	`userId` text NOT NULL,
	PRIMARY KEY(`channelId`, `userId`),
	FOREIGN KEY (`channelId`) REFERENCES `Channel`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `MessageReadTime_userId_idx` ON `MessageReadTime` (`userId`);--> statement-breakpoint
CREATE INDEX `MessageReadTime_channelId_idx` ON `MessageReadTime` (`channelId`);--> statement-breakpoint
CREATE TABLE `MessageUrlPreview` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`url` text NOT NULL,
	`type` text NOT NULL,
	`messageId` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`faviconLink` text,
	`imageLink` text,
	`videoLink` text,
	FOREIGN KEY (`messageId`) REFERENCES `Message`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `Message` (
	`id` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`isSystemMessage` integer DEFAULT false NOT NULL,
	`isEdited` integer DEFAULT false NOT NULL,
	`replyingMessageId` text,
	`userId` text NOT NULL,
	`channelId` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`channelId`) REFERENCES `Channel`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `Message_channelId_idx` ON `Message` (`channelId`);--> statement-breakpoint
CREATE INDEX `Message_userId_idx` ON `Message` (`userId`);--> statement-breakpoint
CREATE TABLE `NotificationConfig` (
	`userId` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`mode` text DEFAULT 'mention' NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `NotificationDevice` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token` text NOT NULL,
	`platform` text NOT NULL,
	`keys` text,
	`deviceName` text,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`lastUsedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `NotificationDevice_token_unique` ON `NotificationDevice` (`token`);--> statement-breakpoint
CREATE INDEX `NotificationDevice_userId_idx` ON `NotificationDevice` (`userId`);--> statement-breakpoint
CREATE TABLE `Password` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`password` text NOT NULL,
	`salt` text NOT NULL,
	`userId` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Password_userId_unique` ON `Password` (`userId`);--> statement-breakpoint
CREATE TABLE `RoleInfo` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`createdUserId` text NOT NULL,
	`color` text DEFAULT '#fff' NOT NULL,
	`createdAt` integer NOT NULL,
	`manageServer` integer DEFAULT false NOT NULL,
	`manageChannel` integer DEFAULT false NOT NULL,
	`manageUser` integer DEFAULT false NOT NULL,
	`manageRole` integer DEFAULT false NOT NULL,
	`manageEmoji` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`createdUserId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `RoleInfo_name_unique` ON `RoleInfo` (`name`);--> statement-breakpoint
CREATE TABLE `RoleLink` (
	`roleId` text NOT NULL,
	`roleLinkedAt` integer NOT NULL,
	`userId` text NOT NULL,
	PRIMARY KEY(`userId`, `roleId`),
	FOREIGN KEY (`roleId`) REFERENCES `RoleInfo`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `RoleLink_userId_idx` ON `RoleLink` (`userId`);--> statement-breakpoint
CREATE INDEX `RoleLink_roleId_idx` ON `RoleLink` (`roleId`);--> statement-breakpoint
CREATE TABLE `ServerConfig` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`introduction` text NOT NULL,
	`RegisterAvailable` integer DEFAULT true NOT NULL,
	`RegisterInviteOnly` integer DEFAULT true NOT NULL,
	`RegisterAnnounceChannelId` text DEFAULT '' NOT NULL,
	`MessageMaxLength` integer DEFAULT 3000 NOT NULL,
	`MessageMaxFileSize` integer DEFAULT 512000 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `Token` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text DEFAULT 'ログイン情報' NOT NULL,
	`token` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Token_token_unique` ON `Token` (`token`);--> statement-breakpoint
CREATE INDEX `Token_userId_idx` ON `Token` (`userId`);--> statement-breakpoint
CREATE TABLE `User` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`selfIntroduction` text NOT NULL,
	`isBanned` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `User_name_unique` ON `User` (`name`);