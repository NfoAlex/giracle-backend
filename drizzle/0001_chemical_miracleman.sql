DROP INDEX `Message_channelId_idx`;--> statement-breakpoint
CREATE INDEX `Message_channelId_createdAt_idx` ON `Message` (`channelId`,`createdAt`);