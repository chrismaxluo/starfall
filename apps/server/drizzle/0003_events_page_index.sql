CREATE INDEX `events_room_id` ON `events` (`room_id`,`id`);--> statement-breakpoint
CREATE INDEX `events_room_kind_id` ON `events` (`room_id`,`kind`,`id`);