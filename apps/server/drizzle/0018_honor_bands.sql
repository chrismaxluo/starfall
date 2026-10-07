CREATE TABLE `rule_enter_honor_bands` (
	`from_level` integer PRIMARY KEY NOT NULL,
	`effect_id` integer,
	`cooldown_min` integer NOT NULL,
	`enabled` integer NOT NULL,
	FOREIGN KEY (`effect_id`) REFERENCES `effects`(`id`) ON UPDATE no action ON DELETE restrict
);--> statement-breakpoint
INSERT INTO `rule_enter_honor_bands` (`from_level`, `effect_id`, `cooldown_min`, `enabled`) VALUES (50, NULL, 10, 0), (40, NULL, 10, 0), (30, NULL, 10, 0);
