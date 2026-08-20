CREATE TABLE `RequestLog` (
	`id` text PRIMARY KEY NOT NULL,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`status` integer NOT NULL,
	`userId` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "RequestLog_method_chk" CHECK("RequestLog"."method" IN ('GET','POST','PUT','DELETE','PATCH')),
	CONSTRAINT "RequestLog_status_chk" CHECK("RequestLog"."status" BETWEEN 100 AND 999)
);
--> statement-breakpoint
CREATE INDEX `RequestLog_method_idx` ON `RequestLog` (`method`);--> statement-breakpoint
CREATE INDEX `RequestLog_path_idx` ON `RequestLog` (`path`);--> statement-breakpoint
CREATE INDEX `RequestLog_status_idx` ON `RequestLog` (`status`);--> statement-breakpoint
CREATE INDEX `RequestLog_userId_idx` ON `RequestLog` (`userId`);