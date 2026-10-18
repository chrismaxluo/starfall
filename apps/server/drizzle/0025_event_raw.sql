CREATE TABLE `event_raw` (
	`id` integer PRIMARY KEY NOT NULL,
	`ts` integer NOT NULL,
	`raw` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `event_raw_ts` ON `event_raw` (`ts`);