DROP INDEX `User_id_createdAt_idx`;--> statement-breakpoint
CREATE INDEX `User_id_createdAt_idx` ON `User` (`createdAt`,`id`);