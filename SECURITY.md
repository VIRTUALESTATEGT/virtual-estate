# Virtual Estate — Security Model

## Access Control Layers

### 1. JWT Authentication (`src/middleware/auth.js`)
Every protected API route requires a valid `Authorization: Bearer <token>` header.
Tokens are signed with `JWT_SECRET` (env var), expire in 8 hours, and contain:
`{ id, email, nombre, role, is_superadmin }`

The `/api/auth/verify` endpoint re-reads the DB on every call so permission changes take effect immediately without waiting for token expiry.

### 2. Role-Based Middleware (`src/middleware/roles.js`)

| Role | Level | Description |
|------|-------|-------------|
| `asistente` | 0 | Read-only access to CRM data |
| `agente` | 1 | Full lead/client/quote management |
| `admin` | 2 | + User and project management |
| `gerente` | 3 | + Agent management, sensitive reports |
| `is_superadmin: true` | ∞ | Full access to all modules |

**Route protection applied in `server.js`:**

| Route | Minimum Role |
|-------|-------------|
| `/api/leads` | asistente |
| `/api/clientes` | asistente |
| `/api/propiedades` | asistente |
| `/api/proyectos` | asistente |
| `/api/cotizaciones` | asistente |
| `/api/agentes` | gerente |
| `/api/usuarios` | superadmin only |
| `/api/agente-ia` | asistente |
| `/api/conversaciones` | asistente |
| `/api/notificaciones` | asistente |
| `/api/cliente/verificacion-identidad` | authenticated |

### 3. Row-Level Security (`migrations/003_row_level_security.sql`)

Supabase RLS is enabled on all 14 sensitive tables. The backend uses `SUPABASE_SECRET_KEY` (service role), which **automatically bypasses all RLS policies** — this is intentional and safe. RLS protects against:
- Direct anon key access from the browser
- Direct database connections with non-service credentials
- Future client-side SDK use

**Key helper functions (called inside Postgres policies):**
```sql
auth_user_id()       → int    (from JWT claim 'id')
auth_user_role()     → text   (from JWT claim 'role')
auth_is_superadmin() → bool   (from JWT claim 'is_superadmin')
```

**Per-table policies summary:**

| Table | Anon | Authenticated |
|-------|------|---------------|
| `propiedades` | SELECT (public catalog) | All roles read; gerente/admin write |
| `zonas_seguridad` | SELECT | All roles read; superadmin write |
| `leads` | INSERT only | asistente+ read/write; anon can insert |
| `clientes` | INSERT only | asistente+ read/write; anon can insert |
| `cotizaciones` | — | All roles read; gerente+ delete |
| `conversaciones_multicanal` | — | Agents see assigned; gerente sees all |
| `mensajes` | — | All roles read/insert |
| `cliente_verificacion_identidad` | — | gerente/admin only (contains DPI/selfie) |
| `usuarios` | — | Own row only; superadmin sees all |
| `permisos_usuario` | — | Own permissions; superadmin manages all |
| `proyectos` | — | All roles read; gerente+ write |
| `agentes` | — | All roles read; gerente+ write |
| `notificaciones_admin` | — | gerente/admin read; superadmin write |
| `instrucciones_ia_dinamicas` | — | superadmin only |

### 4. Audit Logging (`src/middleware/audit.js`)

Sensitive operations are logged to console and to the `audit_log` table.
The `auditMiddleware(table, action)` factory can be added to any router:

```js
router.delete('/:id', auditMiddleware('clientes', 'DELETE'), handler);
```

Logged fields: `ts, usuario_id, usuario_email, accion, recurso, recurso_id, ip`

`audit_log` table must be created manually in Supabase:
```sql
CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  ts         timestamptz NOT NULL DEFAULT now(),
  usuario_id int,
  usuario_email text,
  accion     text NOT NULL,
  recurso    text NOT NULL,
  recurso_id text,
  detalles   jsonb,
  ip         text
);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_superadmin" ON audit_log FOR ALL TO authenticated
  USING (auth_is_superadmin()) WITH CHECK (auth_is_superadmin());
```

---

## Sensitive Data Handling

- **Passwords** are stored as SHA-256 hashes. `sanitizeUsuario()` in `roles.js` strips `password_hash` before any API response.
- **DPI images and selfies** are stored as base64/URL in `cliente_verificacion_identidad`. Only gerente/admin can access via API; RLS blocks all other roles at the DB layer.
- **WhatsApp tokens** (`WHATSAPP_ACCESS_TOKEN`) and **Claude API key** are environment variables, never returned in any endpoint.

---

## Adding New Policies

1. **New table**: Add `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;` and appropriate policies to `migrations/003_row_level_security.sql`, then run in Supabase SQL Editor.
2. **New route requiring a role**: Import `requireRole` or `requireMinRole` from `src/middleware/roles.js` and add as middleware in `server.js`.
3. **New audit point**: Add `auditMiddleware('table', 'ACTION')` to the relevant router.

---

## Environment Variables (required in Vercel)

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Public anon key (only used for `/api/propiedades/public`) |
| `SUPABASE_SECRET_KEY` | Service role key — bypasses RLS — keep secret |
| `JWT_SECRET` | Signs/verifies auth tokens — must be a strong random string in production |
| `WHATSAPP_BUSINESS_PHONE_ID` | Meta Graph API phone ID |
| `WHATSAPP_ACCESS_TOKEN` | Meta Graph API bearer token |
| `WHATSAPP_APP_SECRET` | Used for X-Hub-Signature-256 webhook validation |
| `WHATSAPP_ADMIN_NUMBER` | Phone number that receives admin notifications |
| `WHATSAPP_VERIFY_TOKEN` | Token for Meta webhook verification handshake |
| `CLAUDE_API_KEY` | Anthropic API key for the IA agent |

---

## Known Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| `JWT_SECRET` default fallback `'virtual-estate-secret-key'` | Set a strong `JWT_SECRET` env var in Vercel before going to production |
| Service role key in environment | Already in `.env` (gitignored); set in Vercel env panel — never commit |
| `trigger` column name in `instrucciones_ia_dinamicas` | PostgreSQL reserved word — rename to `trigger_texto` if migration fails |
| No HTTPS enforcement at Express level | Handled by Vercel edge; do not deploy naked HTTP in production |
