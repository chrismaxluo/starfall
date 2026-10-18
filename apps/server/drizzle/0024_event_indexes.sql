CREATE INDEX `events_room_status_id` ON `events` (`room_id`,`status`,`id`);--> statement-breakpoint
CREATE INDEX `events_session_kind` ON `events` (`session_id`,`kind`);--> statement-breakpoint
CREATE INDEX `events_room_id_uname` ON `events` (`room_id`,`id`,`uname`);