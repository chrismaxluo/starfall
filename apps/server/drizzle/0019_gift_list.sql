ALTER TABLE `outputs` ADD `gifts_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `outputs` ADD `gifts_side` text DEFAULT 'right' NOT NULL;--> statement-breakpoint
ALTER TABLE `outputs` ADD `gifts_size` text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE `outputs` ADD `gifts_max` integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE `outputs` ADD `gifts_filter` text DEFAULT '{"mode":"all","gifts":[],"guard":true,"sc":true}' NOT NULL;