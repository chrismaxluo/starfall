ALTER TABLE `outputs` ADD `chat_look` text DEFAULT 'glass' NOT NULL;--> statement-breakpoint
ALTER TABLE `outputs` ADD `chat_guard_frame` text DEFAULT 'theme' NOT NULL;--> statement-breakpoint
ALTER TABLE `outputs` ADD `chat_mascot` text DEFAULT 'big' NOT NULL;--> statement-breakpoint
ALTER TABLE `outputs` ADD `chat_alpha` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `outputs` ADD `chat_hide_blocked` integer DEFAULT false NOT NULL;