DROP INDEX `ChannelJoin_userId_idx`;--> statement-breakpoint
DROP INDEX `ChannelMute_userId_idx`;--> statement-breakpoint
DROP INDEX `ChannelViewableRole_channelId_idx`;--> statement-breakpoint
DROP INDEX `MessageReaction_messageId_idx`;--> statement-breakpoint
CREATE INDEX `MessageReaction_messageId_reactedAt_idx` ON `MessageReaction` (`messageId`,`reactedAt`);--> statement-breakpoint
DROP INDEX `MessageReadTime_channelId_idx`;--> statement-breakpoint
DROP INDEX `RoleLink_userId_idx`;--> statement-breakpoint
CREATE INDEX `MessageUrlPreview_messageId_idx` ON `MessageUrlPreview` (`messageId`);