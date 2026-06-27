-- Allow 'remotive' as an additional job source.
ALTER TABLE job_offers DROP CONSTRAINT IF EXISTS job_offers_source_check;
ALTER TABLE job_offers ADD CONSTRAINT job_offers_source_check
  CHECK (source IN ('justjoin', 'nofluffjobs', 'remotive'));
