ALTER TABLE `events` ADD `history_key` text;--> statement-breakpoint
ALTER TABLE `events` ADD `platform_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `events_history_key` ON `events` (`history_key`);--> statement-breakpoint
CREATE INDEX `events_platform_key` ON `events` (`platform_key`);