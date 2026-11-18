import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// No audio, transcripts or drawings are stored in the hosting database.
export const speechHost = sqliteTable('speech_host', {
  id: text('id').primaryKey(),
  url: text('url').notNull(),
  heartbeat: integer('heartbeat').notNull(),
});
export const demoUsage = sqliteTable('demo_usage', {
  id: text('id').primaryKey(),
  count: integer('count').notNull(),
  expires: integer('expires').notNull(),
});
export const speechBudget = sqliteTable('speech_budget', {
  id: text('id').primaryKey(),
  used: integer('used').notNull(),
});
export const speechLease = sqliteTable('speech_lease', {
  id: text('id').primaryKey(),
  visitor: text('visitor').notNull(),
  expires: integer('expires').notNull(),
  reserved: integer('reserved').notNull(),
  settled: integer('settled').notNull(),
});
