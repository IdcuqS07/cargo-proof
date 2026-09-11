CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`type` enum('PROOF_FAILED','RETRY_QUEUE','RELEASED') NOT NULL,
	`severity` enum('INFO','WARNING','ERROR') NOT NULL DEFAULT 'INFO',
	`title` varchar(180) NOT NULL,
	`message` text NOT NULL,
	`dedupeKey` varchar(180) NOT NULL,
	`readAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`),
	CONSTRAINT `notifications_dedupe_unique` UNIQUE(`dedupeKey`)
);
--> statement-breakpoint
CREATE TABLE `shipment_facility_mappings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`shipmentId` varchar(66) NOT NULL,
	`facilityId` varchar(66) NOT NULL,
	`sourceRegistry` varchar(42) NOT NULL,
	`chainKey` int NOT NULL DEFAULT 1,
	`active` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `shipment_facility_mappings_id` PRIMARY KEY(`id`),
	CONSTRAINT `shipment_facility_shipment_unique` UNIQUE(`shipmentId`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
);
--> statement-breakpoint
CREATE TABLE `worker_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sourceTxHash` varchar(66) NOT NULL,
	`sourceBlock` int NOT NULL,
	`shipmentId` varchar(66) NOT NULL,
	`milestoneId` varchar(66) NOT NULL,
	`milestoneType` int NOT NULL,
	`facilityId` varchar(66),
	`proofTxHash` varchar(66),
	`releaseTxHash` varchar(66),
	`status` enum('DETECTED','PROOF_PENDING','PROOF_ACCEPTED','RELEASED','FAILED') NOT NULL DEFAULT 'DETECTED',
	`attempts` int NOT NULL DEFAULT 0,
	`lastError` text,
	`nextRetryAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `worker_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `worker_events_source_tx_unique` UNIQUE(`sourceTxHash`)
);
--> statement-breakpoint
CREATE INDEX `notifications_unread_idx` ON `notifications` (`readAt`);--> statement-breakpoint
CREATE INDEX `shipment_facility_facility_idx` ON `shipment_facility_mappings` (`facilityId`);--> statement-breakpoint
CREATE INDEX `worker_events_milestone_idx` ON `worker_events` (`milestoneId`);--> statement-breakpoint
CREATE INDEX `worker_events_status_idx` ON `worker_events` (`status`);