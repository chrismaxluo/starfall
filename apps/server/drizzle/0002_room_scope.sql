ALTER TABLE `events` ADD `room_id` integer;--> statement-breakpoint
CREATE INDEX `events_room_ts` ON `events` (`room_id`,`ts`);--> statement-breakpoint
ALTER TABLE `live_sessions` ADD `room_id` integer;--> statement-breakpoint
-- 旧数据分不出属于哪个直播间，都算成当前设置的直播间
UPDATE `events` SET `room_id` = (SELECT `room_id` FROM `room` WHERE `id` = 1) WHERE `room_id` IS NULL;--> statement-breakpoint
UPDATE `live_sessions` SET `room_id` = (SELECT `room_id` FROM `room` WHERE `id` = 1) WHERE `room_id` IS NULL;
