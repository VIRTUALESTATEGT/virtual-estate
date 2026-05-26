-- Migration 012: RLS policies for whatsapp_messages

-- Allow service role full access (used by backend)
CREATE POLICY "service_role_all" ON whatsapp_messages
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Allow insert from any source (webhook)
CREATE POLICY "allow_insert_messages" ON whatsapp_messages
  FOR INSERT
  WITH CHECK (true);

-- Allow select for reading history
CREATE POLICY "allow_select_messages" ON whatsapp_messages
  FOR SELECT
  USING (true);
