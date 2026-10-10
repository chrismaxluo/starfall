CREATE TABLE `music_local` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sha256` text,
	`path` text,
	`ext` text NOT NULL,
	`filename` text NOT NULL,
	`size` integer NOT NULL,
	`title` text NOT NULL,
	`artist` text DEFAULT '' NOT NULL,
	`album` text DEFAULT '' NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`cover` text,
	`lyric` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `music_local_sha256` ON `music_local` (`sha256`);--> statement-breakpoint
CREATE UNIQUE INDEX `music_local_path` ON `music_local` (`path`);--> statement-breakpoint
CREATE TABLE `music_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer,
	`source` text NOT NULL,
	`song_id` text NOT NULL,
	`name` text NOT NULL,
	`artists` text DEFAULT '' NOT NULL,
	`album` text DEFAULT '' NOT NULL,
	`cover` text DEFAULT '' NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`uid` integer NOT NULL,
	`uname` text NOT NULL,
	`face` text DEFAULT '' NOT NULL,
	`guard` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`started_at` integer,
	`ended_at` integer
);
--> statement-breakpoint
CREATE INDEX `music_requests_status` ON `music_requests` (`status`,`sort`);--> statement-breakpoint
CREATE INDEX `music_requests_created` ON `music_requests` (`created_at`);