-- トークンはハッシュ保存へ移行する。既存セッションは復元できないため破棄する
DELETE FROM `Token`;--> statement-breakpoint
ALTER TABLE `Token` ADD `tokenHash` text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `Token_tokenHash_unique` ON `Token` (`tokenHash`);
