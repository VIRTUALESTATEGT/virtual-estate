-- Migration 014: Pending approvals for WhatsApp auto-responses

CREATE TABLE IF NOT EXISTS pending_approvals (
  id               SERIAL PRIMARY KEY,
  phone_number     VARCHAR(20),
  conversation_id  VARCHAR(50),
  question         TEXT,
  proposed_answer  TEXT,
  status           VARCHAR(20) DEFAULT 'pending',
  created_at       TIMESTAMP DEFAULT NOW(),
  approved_at      TIMESTAMP,
  message_id       VARCHAR(100),
  CONSTRAINT status_check CHECK (status IN ('pending', 'approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_pending_approvals_phone  ON pending_approvals(phone_number);
CREATE INDEX IF NOT EXISTS idx_pending_approvals_status ON pending_approvals(status);

ALTER TABLE pending_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_pending_approvals" ON pending_approvals
  FOR ALL USING (true) WITH CHECK (true);
