CREATE TABLE `demo_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `speech_host` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`heartbeat` integer NOT NULL
);
