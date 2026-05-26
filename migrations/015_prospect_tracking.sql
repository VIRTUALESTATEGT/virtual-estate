-- Migration 015: Prospect tracking (persiste aunque se borre el chat)

CREATE TABLE IF NOT EXISTS prospect_tracking (
  id            SERIAL PRIMARY KEY,
  phone_number  VARCHAR(20) UNIQUE,
  contact_count INT DEFAULT 1,
  first_contact TIMESTAMP DEFAULT NOW(),
  last_contact  TIMESTAMP DEFAULT NOW(),
  status        VARCHAR(20) DEFAULT 'lead',
  CONSTRAINT status_check CHECK (status IN ('lead', 'contacted', 'converted'))
);

CREATE INDEX IF NOT EXISTS idx_prospect_phone  ON prospect_tracking(phone_number);
CREATE INDEX IF NOT EXISTS idx_prospect_status ON prospect_tracking(status);

ALTER TABLE prospect_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_prospect_tracking" ON prospect_tracking
  FOR ALL USING (true) WITH CHECK (true);
