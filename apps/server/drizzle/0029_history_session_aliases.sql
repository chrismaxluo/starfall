CREATE TABLE `history_session_aliases` (
	`room_id` integer NOT NULL,
	`source_started_at` integer NOT NULL,
	`session_id` integer NOT NULL,
	PRIMARY KEY(`room_id`, `source_started_at`),
	FOREIGN KEY (`session_id`) REFERENCES `live_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
