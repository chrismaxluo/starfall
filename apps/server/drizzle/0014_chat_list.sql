ALTER TABLE `outputs` ADD `chat_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `outputs` ADD `chat_side` text DEFAULT 'left' NOT NULL;--> statement-breakpoint
ALTER TABLE `outputs` ADD `chat_size` text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE `outputs` ADD `chat_medal` text DEFAULT 'own' NOT NULL;