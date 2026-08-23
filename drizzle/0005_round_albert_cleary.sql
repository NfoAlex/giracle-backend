-- SQLite の ALTER TABLE ADD COLUMN は式デフォルトを許可しないため手で修正（0003 と同様）。
ALTER TABLE `Token` ADD `expiresAt` integer;--> statement-breakpoint
UPDATE `Token` SET `expiresAt` = unixepoch() * 1000 + 14 * 24 * 60 * 60 * 1000 WHERE `expiresAt` IS NULL;