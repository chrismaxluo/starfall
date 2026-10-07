CREATE TABLE `gift_pins` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`item` text NOT NULL,
	`sort` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gift_pins_event_id_unique` ON `gift_pins` (`event_id`);