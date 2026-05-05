-- Migration 005: Add sequential numeric ID to brands table
ALTER TABLE brands ADD COLUMN IF NOT EXISTS num SERIAL;
