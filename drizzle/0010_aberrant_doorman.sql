DROP INDEX `RequestLog_createdAt_idx`;--> statement-breakpoint
CREATE INDEX `RequestLog_createdAt_idx` ON `RequestLog` (`createdAt`,`id`);