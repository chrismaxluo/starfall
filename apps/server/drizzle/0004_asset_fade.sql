ALTER TABLE `effects` ADD `duration_custom` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `effects` ADD `fade_in` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `effects` ADD `fade_out` integer DEFAULT true NOT NULL;