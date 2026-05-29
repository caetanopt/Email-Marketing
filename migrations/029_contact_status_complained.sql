-- Add 'complained' to contact_status enum (bounced already exists from 001_schema.sql)
-- 'bounced'   = hard bounce notified by AWS SES via SNS
-- 'complained' = spam complaint notified by AWS SES via SNS

ALTER TYPE contact_status ADD VALUE IF NOT EXISTS 'complained';
