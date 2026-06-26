-- Job offers scraped from JustJoin.IT and NoFluffJobs.
CREATE TABLE job_offers (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text        NOT NULL,
  company      text        NOT NULL,
  salary_from  integer,
  salary_to    integer,
  currency     text,
  url          text        NOT NULL,
  source       text        NOT NULL CHECK (source IN ('justjoin', 'nofluffjobs')),
  location     text,
  remote       boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  dismissed    boolean     NOT NULL DEFAULT false,
  UNIQUE(url)
);

ALTER TABLE job_offers ENABLE ROW LEVEL SECURITY;
