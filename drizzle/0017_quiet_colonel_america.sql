-- Inbox.channelId は既存行を Message から引き継ぐ必要があり、NOT NULL 列は ALTER TABLE ADD COLUMN で追加できない
-- (既存行があると "Cannot add a NOT NULL column with default value NULL" で失敗する)。
-- また drizzle-kit が生成する ADD COLUMN は references の ON DELETE 句を落とすため、テーブルを作り直して
-- 既存通知を引き継ぎつつ channelId の FK(cascade) と索引を張り直す。
CREATE TABLE `__new_Inbox` (
	`type` text NOT NULL,
	`happendAt` integer NOT NULL,
	`messageId` text NOT NULL,
	`channelId` text NOT NULL,
	`userId` text NOT NULL,
	PRIMARY KEY(`messageId`, `userId`),
	FOREIGN KEY (`messageId`) REFERENCES `Message`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`channelId`) REFERENCES `Channel`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_Inbox` (`type`, `happendAt`, `messageId`, `channelId`, `userId`)
	SELECT `i`.`type`, `i`.`happendAt`, `i`.`messageId`, `m`.`channelId`, `i`.`userId`
	FROM `Inbox` AS `i` INNER JOIN `Message` AS `m` ON `m`.`id` = `i`.`messageId`;
--> statement-breakpoint
DROP TABLE `Inbox`;--> statement-breakpoint
ALTER TABLE `__new_Inbox` RENAME TO `Inbox`;--> statement-breakpoint
CREATE INDEX `Inbox_userId_idx` ON `Inbox` (`userId`);--> statement-breakpoint
CREATE INDEX `Inbox_channelId_idx` ON `Inbox` (`channelId`);
