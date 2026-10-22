-- 弹幕列表外观第二版：小八的设置从「放哪」（头像旁边 / 气泡右端 / 头像右下角）换成「怎么出场」（先在框中间露脸 / 一直在右下角），新增奶油贴纸的头像框。
-- drizzle 生成的复制语句里会去旧表取还不存在的新列，这里手改：新列填默认值，旧的小八设置换成对应的新值
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_outputs` (
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
	`chat_enabled` integer DEFAULT true NOT NULL,
	`chat_side` text DEFAULT 'left' NOT NULL,
	`chat_size` text DEFAULT 'normal' NOT NULL,
	`chat_medal` text DEFAULT 'own' NOT NULL,
	`chat_max` integer DEFAULT 8 NOT NULL,
	`chat_fade_sec` integer DEFAULT 0 NOT NULL,
	`chat_look` text DEFAULT 'glass' NOT NULL,
	`chat_guard_frame` text DEFAULT 'theme' NOT NULL,
	`chat_mascot` text DEFAULT 'hop' NOT NULL,
	`chat_cream_frame` text DEFAULT 'hachi' NOT NULL,
	`chat_alpha` integer DEFAULT 0 NOT NULL,
	`chat_hide_blocked` integer DEFAULT false NOT NULL,
	`gifts_enabled` integer DEFAULT true NOT NULL,
	`gifts_side` text DEFAULT 'right' NOT NULL,
	`gifts_size` text DEFAULT 'normal' NOT NULL,
	`gifts_max` integer DEFAULT 6 NOT NULL,
	`gifts_speed` text DEFAULT 'normal' NOT NULL,
	`gifts_filter` text DEFAULT '{"mode":"all","gifts":[],"guard":true,"sc":true}' NOT NULL,
	`gifts_title` text DEFAULT '' NOT NULL,
	`gifts_look` text DEFAULT 'jingcai' NOT NULL,
	`gifts_motion` text DEFAULT 'credits' NOT NULL,
	`gifts_alpha` integer DEFAULT 50 NOT NULL,
	`key` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_outputs`("id", "name", "app", "orient", "width", "height", "safe_top", "safe_bottom", "margin_x", "scale", "lite_mode", "chat_enabled", "chat_side", "chat_size", "chat_medal", "chat_max", "chat_fade_sec", "chat_look", "chat_guard_frame", "chat_mascot", "chat_cream_frame", "chat_alpha", "chat_hide_blocked", "gifts_enabled", "gifts_side", "gifts_size", "gifts_max", "gifts_speed", "gifts_filter", "gifts_title", "gifts_look", "gifts_motion", "gifts_alpha", "key", "created_at") SELECT "id", "name", "app", "orient", "width", "height", "safe_top", "safe_bottom", "margin_x", "scale", "lite_mode", "chat_enabled", "chat_side", "chat_size", "chat_medal", "chat_max", "chat_fade_sec", "chat_look", "chat_guard_frame", CASE "chat_mascot" WHEN 'big' THEN 'hop' WHEN 'end' THEN 'corner' WHEN 'small' THEN 'corner' ELSE "chat_mascot" END, 'hachi', "chat_alpha", "chat_hide_blocked", "gifts_enabled", "gifts_side", "gifts_size", "gifts_max", "gifts_speed", "gifts_filter", "gifts_title", "gifts_look", "gifts_motion", "gifts_alpha", "key", "created_at" FROM `outputs`;--> statement-breakpoint
DROP TABLE `outputs`;--> statement-breakpoint
ALTER TABLE `__new_outputs` RENAME TO `outputs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `outputs_key_unique` ON `outputs` (`key`);