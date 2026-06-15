-- Subscription tracker: name, cost, billing cycle, renewal date.
CREATE TABLE subscriptions (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text          NOT NULL,
  cost_pln     numeric(8,2)  NOT NULL DEFAULT 0,
  billing_cycle text         NOT NULL DEFAULT 'monthly'
    CHECK (billing_cycle IN ('monthly', 'yearly', 'weekly')),
  renewal_date date,
  color        text,
  icon         text,
  created_at   timestamptz   DEFAULT now()
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
