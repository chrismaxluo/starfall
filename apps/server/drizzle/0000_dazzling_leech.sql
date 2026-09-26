CREATE TABLE `account` (
	`id` integer PRIMARY KEY NOT NULL,
	`uid` integer NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`face` text DEFAULT '' NOT NULL,
	`cookies_enc` text NOT NULL,
	`refresh_token_enc` text DEFAULT '' NOT NULL,
	`expires_at` integer,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`filename` text NOT NULL,
	`sha256` text NOT NULL,
	`ext` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`duration_ms` integer,
	`has_alpha` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assets_sha256_unique` ON `assets` (`sha256`);--> statement-breakpoint
CREATE TABLE `blacklist` (
	`uid` integer PRIMARY KEY NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `effects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`builtin` integer DEFAULT false NOT NULL,
	`style` text,
	`asset_id` integer,
	`show_text` integer DEFAULT true NOT NULL,
	`texts` text NOT NULL,
	`sound_asset_id` integer,
	`volume` integer DEFAULT 70 NOT NULL,
	`position` text DEFAULT 'center' NOT NULL,
	`duration_ms` integer DEFAULT 5000 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sound_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `effects_name_unique` ON `effects` (`name`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`session_id` integer,
	`kind` text NOT NULL,
	`uid` integer NOT NULL,
	`uname` text NOT NULL,
	`viewer` text NOT NULL,
	`payload` text,
	`rule` text,
	`effect_id` integer,
	`status` text NOT NULL,
	`raw` text
);
--> statement-breakpoint
CREATE INDEX `events_ts` ON `events` (`ts`);--> statement-breakpoint
CREATE INDEX `events_uid_ts` ON `events` (`uid`,`ts`);--> statement-breakpoint
CREATE INDEX `events_kind_ts` ON `events` (`kind`,`ts`);--> statement-breakpoint
CREATE INDEX `events_session` ON `events` (`session_id`);--> statement-breakpoint
CREATE TABLE `live_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer
);
--> statement-breakpoint
CREATE TABLE `outputs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`app` text DEFAULT 'livehime' NOT NULL,
	`orient` text DEFAULT 'portrait' NOT NULL,
	`width` integer DEFAULT 1080 NOT NULL,
	`height` integer DEFAULT 1920 NOT NULL,
	`safe_top` integer DEFAULT 12 NOT NULL,
	`safe_bottom` integer DEFAULT 40 NOT NULL,
	`margin_x` integer DEFAULT 9 NOT NULL,
	`scale` integer DEFAULT 100 NOT NULL,
	`lite_mode` text DEFAULT 'auto' NOT NULL,
	`key` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outputs_key_unique` ON `outputs` (`key`);--> statement-breakpoint
CREATE TABLE `room` (
	`id` integer PRIMARY KEY NOT NULL,
	`room_id` integer NOT NULL,
	`short_id` integer DEFAULT 0 NOT NULL,
	`anchor_uid` integer NOT NULL,
	`anchor_name` text DEFAULT '' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rule_enter_bands` (
	`from_level` integer PRIMARY KEY NOT NULL,
	`effect_id` integer,
	`cooldown_min` integer NOT NULL,
	`enabled` integer NOT NULL,
	FOREIGN KEY (`effect_id`) REFERENCES `effects`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `rule_enter_tiers` (
	`tier` text PRIMARY KEY NOT NULL,
	`effect_id` integer,
	`cooldown_min` integer NOT NULL,
	`enabled` integer NOT NULL,
	FOREIGN KEY (`effect_id`) REFERENCES `effects`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `rule_exclusive` (
	`uid` integer PRIMARY KEY NOT NULL,
	`effect_id` integer NOT NULL,
	`cooldown_min` integer NOT NULL,
	`until` text,
	`enabled` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`effect_id`) REFERENCES `effects`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `viewers` (
	`uid` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`face` text DEFAULT '' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
