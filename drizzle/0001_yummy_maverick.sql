CREATE TABLE `speech_budget` (
	`id` text PRIMARY KEY NOT NULL,
	`used` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `speech_lease` (
	`id` text PRIMARY KEY NOT NULL,
	`visitor` text NOT NULL,
	`expires` integer NOT NULL,
	`reserved` integer NOT NULL,
	`settled` integer NOT NULL
);
