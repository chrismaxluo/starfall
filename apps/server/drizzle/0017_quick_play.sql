CREATE TABLE `quick_play` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sort` integer NOT NULL,
	`effect_id` integer NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`hotkey` text,
	`global_hotkey` text,
	FOREIGN KEY (`effect_id`) REFERENCES `effects`(`id`) ON UPDATE no action ON DELETE cascade
);
