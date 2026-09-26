CREATE TABLE `rule_danmu` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sort` integer NOT NULL,
	`keywords` text NOT NULL,
	`mode` text NOT NULL,
	`who` text NOT NULL,
	`effect_id` integer,
	`global_cd_sec` integer NOT NULL,
	`user_cd_min` integer NOT NULL,
	`enabled` integer NOT NULL,
	FOREIGN KEY (`effect_id`) REFERENCES `effects`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `rule_gift_bands` (
	`from_gold` integer PRIMARY KEY NOT NULL,
	`effect_id` integer,
	`enabled` integer NOT NULL,
	FOREIGN KEY (`effect_id`) REFERENCES `effects`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `rule_gift_specific` (
	`gift_id` integer PRIMARY KEY NOT NULL,
	`gift_name` text DEFAULT '' NOT NULL,
	`effect_id` integer,
	`enabled` integer NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`effect_id`) REFERENCES `effects`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `rule_guard` (
	`tier` text PRIMARY KEY NOT NULL,
	`open_effect_id` integer,
	`renew_effect_id` integer,
	`enabled` integer NOT NULL,
	FOREIGN KEY (`open_effect_id`) REFERENCES `effects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`renew_effect_id`) REFERENCES `effects`(`id`) ON UPDATE no action ON DELETE restrict
);
