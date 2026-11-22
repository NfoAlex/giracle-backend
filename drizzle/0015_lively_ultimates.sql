-- Prisma 時代の旧DBはインデックス名が `_key` 、Drizzle 生成DBは `_unique` のため両方試す
DROP INDEX IF EXISTS `Token_token_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `Token_token_key`;--> statement-breakpoint
ALTER TABLE `Token` DROP COLUMN `token`;