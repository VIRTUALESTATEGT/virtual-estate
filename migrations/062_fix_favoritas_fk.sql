-- Migration 062: Fix FK on propiedades_favoritas.cliente_id → clientes(id)
--
-- Background: the table was created before migration 001 ran, so the IF NOT EXISTS
-- skipped the CREATE TABLE entirely. The pre-existing FK pointed to usuarios(id)
-- instead of clientes(id), causing FK violations when the endpoint tried to insert
-- using the resolved clientes.id.
--
-- ⚠️  Run the diagnostic SELECT below BEFORE executing this migration:
--
--   SELECT
--     pf.id,
--     pf.cliente_id        AS stored_value,
--     u.email              AS email_si_es_usuario,
--     c_by_usr.id          AS clientes_id_del_usuario,
--     c_direct.id          AS clientes_id_directo
--   FROM propiedades_favoritas pf
--   LEFT JOIN usuarios  u         ON u.id           = pf.cliente_id
--   LEFT JOIN clientes  c_by_usr  ON c_by_usr.email = u.email
--   LEFT JOIN clientes  c_direct  ON c_direct.id    = pf.cliente_id;
--
--   If table is empty       → run from Step 2 directly (no data loss).
--   If c_by_usr.id NOT NULL → rows are recoverable; Step 1 maps them before deletion.
--   If c_by_usr.id IS NULL  → rows are unrecoverable; Step 1 deletes them as garbage.

-- ── Step 1a: OPTIONAL — remap recoverable rows (usuarios.id → correct clientes.id)
--   Run only if the diagnostic shows recoverable rows you want to keep.
--
-- UPDATE propiedades_favoritas pf
-- SET cliente_id = c.id
-- FROM usuarios u
-- JOIN clientes c ON c.email = u.email
-- WHERE u.id = pf.cliente_id;

-- ── Step 1b: Delete rows whose cliente_id has no matching clientes record
--   (either unreachable by email or already remapped in Step 1a)
DELETE FROM propiedades_favoritas
WHERE cliente_id NOT IN (SELECT id FROM clientes);

-- ── Step 2: Drop the wrong FK (usuarios(id))
ALTER TABLE propiedades_favoritas
  DROP CONSTRAINT IF EXISTS propiedades_favoritas_cliente_id_fkey;

-- ── Step 3: Add the correct FK → clientes(id) with CASCADE to match migration 001
ALTER TABLE propiedades_favoritas
  ADD CONSTRAINT propiedades_favoritas_cliente_id_fkey
  FOREIGN KEY (cliente_id)
  REFERENCES clientes(id)
  ON DELETE CASCADE;

-- ── Verify
SELECT
  tc.table_name,
  kcu.column_name,
  ccu.table_name  AS references_table,
  ccu.column_name AS references_column,
  rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
JOIN information_schema.referential_constraints rc
  ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name = 'propiedades_favoritas'
  AND kcu.column_name = 'cliente_id';
-- Expected: references_table = clientes, delete_rule = CASCADE
