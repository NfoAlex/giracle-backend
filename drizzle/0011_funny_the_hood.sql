CREATE TABLE `MessageUrlPreviewThumbnail` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`url` text NOT NULL,
	`fileName` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `MessageUrlPreviewThumbnail_url_unique` ON `MessageUrlPreviewThumbnail` (`url`);