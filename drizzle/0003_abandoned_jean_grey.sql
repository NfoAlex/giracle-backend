-- SQLite の ALTER TABLE ADD COLUMN は式デフォルトを許可しないため手で修正。
-- drizzle-orm が INSERT 時に sql デフォルトを埋め込むため DB 側デフォルトは不要。
ALTER TABLE `User` ADD `createdAt` integer;--> statement-breakpoint
UPDATE `User` SET `createdAt` = unixepoch() * 1000 WHERE `createdAt` IS NULL;--> statement-breakpoint
CREATE INDEX `User_id_createdAt_idx` ON `User` (`id`,`createdAt`);