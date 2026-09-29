ALTER TABLE `effects` ADD `fade_in_ms` integer DEFAULT 500 NOT NULL;--> statement-breakpoint
ALTER TABLE `effects` ADD `fade_out_ms` integer DEFAULT 500 NOT NULL;--> statement-breakpoint
-- 已有的素材保持升级前的样子：以前淡入占总时长的 5%、淡出占 8%
UPDATE `effects` SET
  `fade_in_ms` = max(100, min(5000, coalesce((SELECT `duration_ms` FROM `assets` WHERE `assets`.`id` = `effects`.`asset_id`), `effects`.`duration_ms`) * 5 / 100)),
  `fade_out_ms` = max(100, min(5000, coalesce((SELECT `duration_ms` FROM `assets` WHERE `assets`.`id` = `effects`.`asset_id`), `effects`.`duration_ms`) * 8 / 100))
WHERE `asset_id` IS NOT NULL;
