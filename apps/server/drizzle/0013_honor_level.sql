ALTER TABLE `effects` ADD `honor_badge` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `viewers` ADD `honor` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- 弹幕规则的发送人条件加上「荣耀等级不低于某级」：以前的规则都是不按荣耀等级
UPDATE `rule_danmu` SET `who` = json_set(`who`, '$.honorMin', json('null')) WHERE json_valid(`who`) AND json_type(`who`, '$.honorMin') IS NULL;
