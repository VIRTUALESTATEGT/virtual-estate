# AUDITORÍA SISTEMA — Virtual Estate GT
**Fecha:** 2026-06-12 | **Estado:** Pre-lanzamiento | **Solo lectura — no modifica código**

---

## 1. INVENTARIO DE ENDPOINTS

### Públicos (sin autenticación)

| Ruta | Método | Propósito | Tablas | Env vars | Auth |
|---|---|---|---|---|---|
| `GET /api/propiedades/public` | GET | Catálogo público de propiedades | `propiedades`, `propiedades_adicionales` | `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Ninguna |
| `POST /api/leads/public` | POST | Formulario de contacto landing | `leads` | `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Ninguna |
| `GET /api/webhook/whatsapp` | GET | Verificación Meta webhook WA (legacy path) | — | `WHATSAPP_VERIFY_TOKEN` | Token verify |
| `POST /api/webhook/whatsapp` | POST | Recepción mensajes WA (legacy path) | — | `WHATSAPP_APP_SECRET` | X-Hub-Signature-256 |
| `GET /api/webhook/whatsapp` → `GET /api/whatsapp/webhook` | GET | Verificación Meta (path activo) | — | `WHATSAPP_VERIFY_TOKEN` | Token verify |
| `POST /api/whatsapp/webhook` | POST | Recepción mensajes WA (path activo) | `conversaciones_multicanal`, `mensajes`, `instrucciones_ia_dinamicas` | `WHATSAPP_APP_SECRET`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `CLAUDE_API_KEY` | X-Hub-Signature-256 ✅ |
| `GET /api/instagram/webhook` | GET | Verificación Meta webhook Instagram | — | `INSTAGRAM_VERIFY_TOKEN`, `WHATSAPP_VERIFY_TOKEN` | Token verify |
| `POST /api/instagram/webhook` | POST | Recepción DMs Instagram | `conversaciones_instagram` | `INSTAGRAM_ACCESS_TOKEN`, `CLAUDE_API_KEY` | ❌ Sin firma |
| `GET /api/confirmacion/cotizacion/:id` | GET | Portal público de cotización | `cotizaciones`, `clientes`, `leads` | `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Ninguna |
| `POST /api/confirmacion/lead/:id/terminos` | POST | Confirmación desde portal cliente | `cotizaciones`, `clientes`, `leads`, `confirmaciones_registro`, `mensajes` | `SUPABASE_*`, `SMTP_*` | Ninguna |
| `POST /api/confirmacion/cotizacion/confirmar` | POST | Confirmación desde CRM admin | Mismas que anterior | Mismas | ❌ Sin auth (VERIFICAR si es intencional) |
| `POST /api/cron/limpiar` | POST | Cron: limpia cotizaciones vencidas | `cotizaciones` | `CRON_SECRET` | `x-cron-secret` header |
| `GET /api/cotizacion/zonas` | GET | Lista de zonas públicas | `zonas_seguridad` | `SUPABASE_*` | Ninguna |
| `GET /api/cotizacion/precios` | GET | Lista de precios públicos | `precios_servicios` | `SUPABASE_*` | Ninguna |

### Protegidos con JWT (requieren rol staff mínimo)

| Ruta | Método | Rol mínimo | Propósito |
|---|---|---|---|
| `POST /api/auth/login` | POST | — | Login usuarios staff |
| `GET /api/auth/verify` | GET | — | Verificar token |
| `GET/POST/PUT/DELETE /api/leads` | ALL | asistente | CRUD leads |
| `GET/POST/PUT/DELETE /api/clientes` | ALL | asistente/cliente | CRUD clientes + portal |
| `GET /api/clientes/me` | GET | cliente (portal) | Perfil del cliente autenticado |
| `GET/POST/PUT/DELETE /api/propiedades` | ALL | asistente | CRUD propiedades |
| `GET/POST/PUT/DELETE /api/proyectos` | ALL | asistente | CRUD proyectos |
| `GET/POST/PUT/DELETE /api/cotizaciones` | ALL | asistente | CRUD cotizaciones |
| `POST /api/cotizaciones/:id/generar-pdf` | POST | asistente | Genera PDF con puppeteer |
| `POST /api/whatsapp/enviar-cotizacion` | POST | asistente | Envía COT por WhatsApp (template) |
| `POST /api/email/enviar-cotizacion` | POST | asistente | Envía COT por email con PDF adjunto |
| `POST /api/facebook/enviar-cotizacion` | POST | asistente | 501 Not Implemented |
| `POST /api/instagram/enviar-cotizacion` | POST | asistente | 501 Not Implemented |
| `GET/POST /api/agente-ia/responder` | POST | asistente | Llamada directa al agente IA |
| `GET/POST /api/conversaciones` | ALL | asistente | CRUD conversaciones multicanal |
| `GET/POST/PUT/DELETE /api/agentes` | ALL | gerente | CRUD agentes |
| `GET/POST/PUT/DELETE /api/usuarios` | ALL | superadmin | CRUD usuarios |
| `POST /api/marketing/generate` | POST | gerente | Generar posts con IA |
| `GET/PUT /api/marketing/posts/*` | ALL | gerente | Gestión posts marketing |
| `POST /api/marketing/publish-post/:id` | POST | gerente | Publicar en Instagram |
| `GET/POST /api/gallery/*` | ALL | gerente | Galería de imágenes de marca |
| `GET /api/notificaciones` | GET | asistente | Notificaciones admin |
| `POST /api/meta/refresh-token` | POST | — | Renovar token Meta (CRON_SECRET) |
| `GET /api/meta/token-status` | GET | — | Estado tokens Meta (CRON_SECRET) |

### ⚠️ Nota de rutas duplicadas
Existen **dos** paths para el webhook de WhatsApp activos simultáneamente:
- `app.use('/api/webhook/whatsapp', webhookWARouter)` — recibe mensajes
- `app.get('/api/whatsapp/webhook', ...)` + `app.post('/api/whatsapp/webhook', ...)` — registrado inline

Ambos están activos. VERIFICAR MANUALMENTE en Meta App Dashboard cuál está configurado como callback URL.

---

## 2. INVENTARIO DE BASE DE DATOS

### Migraciones

| # | Archivo | Crea / Modifica |
|---|---|---|
| 001 | `roles_permissions.sql` | Tablas: `usuarios`, `roles`, `permisos_usuario` |
| 002 | `multicanal_ia_verificacion.sql` | Tablas: `zonas_seguridad`, `cliente_verificacion_identidad`, `conversaciones_multicanal`, `mensajes`, `instrucciones_ia_dinamicas`, `notificaciones_admin`; columnas en `propiedades`, `cotizaciones` |
| 003 | `row_level_security.sql` | Activa RLS en ~12 tablas; crea políticas por rol |
| 004 | `rls_propiedades_adicionales_favoritos.sql` | RLS en `propiedades_adicionales`, `favoritos` |
| 005 | `pronombre_agente_solicitud.sql` | Tabla `agente_solicitudes` |
| 006 | `precios_servicios.sql` | Tabla `precios_servicios` |
| 007 | `constructores_proyectos_zonas.sql` | Tablas: `constructores`, `proyectos` |
| 008 | `marketing_agent.sql` | Tablas: `brand_identity`, `marketing_instructions`, `content_orders`, `generated_posts` |
| 009 | `image_management.sql` | Tablas: `brand_images`, `reference_images` |
| 010 | `add_image_to_posts.sql` | Columnas en `generated_posts` |
| 011 | `whatsapp_messages.sql` | Tabla: `whatsapp_messages`; activa RLS |
| 012 | `whatsapp_rls_policies.sql` | Políticas RLS en `whatsapp_messages` |
| 013 | `whatsapp_contacts.sql` | Tabla: `whatsapp_contacts` |
| 014 | `pending_approvals.sql` | Columnas de aprobación en `generated_posts` |
| 015 | `prospect_tracking.sql` | Columnas tracking en leads/cotizaciones |
| 016 | `confirmacion_cotizacion.sql` | Columnas en `clientes`, `cotizaciones`; tablas: `cotizacion_secuencia`, `confirmaciones_registro` |
| 017 | `envio_cotizacion.sql` | Columnas de envío en `cotizaciones` |
| 018 | `precios_servicios_v2.sql` | Extend `precios_servicios` |
| 019 | `cotizaciones_extra.sql` | Columnas adicionales en `cotizaciones` |
| 020 | `fix_canal_moneda.sql` | Fix CHECK constraint `canal` / `moneda` |
| 021 | `direccion_ubicacion.sql` | Columnas de ubicación en `cotizaciones` |
| 022 | `leads_missing_columns.sql` | Columnas faltantes en `leads` |
| 023 | `cotizaciones_documento_url.sql` | Columna `documento_url` en `cotizaciones` |
| 024 | `leads_apellido.sql` | Columna `apellido` en `leads` |
| 025 | `clientes_apellido_lead_fk.sql` | Columna `apellido` en `clientes`; FK ON DELETE SET NULL |
| 026 | `clientes_numero_agente.sql` | Columna `numero_agente` en `clientes` |
| 027 | `conversaciones_webhook_rls.sql` | Políticas anon INSERT/SELECT en `conversaciones_multicanal`, `mensajes` |
| 028 | `conversaciones_instagram.sql` | Tabla: `conversaciones_instagram` (sin RLS) |
| 029 | `meta_tokens.sql` | Tabla: `meta_tokens` (plataforma + token + expiry) |

### Estado RLS por tabla crítica

| Tabla | RLS | Políticas anon | Políticas authenticated | Riesgo |
|---|---|---|---|---|
| `usuarios` | ✅ ON | Ninguna | Solo ver propio row (superadmin: todo) | ✅ Bajo |
| `clientes` | ✅ ON | INSERT only (cotización) | Staff full; cliente propio | ✅ Bajo |
| `cotizaciones` | ✅ ON | Ninguna | Staff (CRUD); anon via /confirmacion | ✅ Bajo |
| `conversaciones_multicanal` | ✅ ON | ⚠️ INSERT+SELECT (mig.027) | Staff + agente propio | ⚠️ Mig.027 abre SELECT anon a toda la tabla |
| `mensajes` | ✅ ON | ⚠️ INSERT (mig.027) | Staff | ⚠️ Igual — anon puede insertar mensajes |
| `leads` | ✅ ON | INSERT only (landing) | Staff | ✅ Bajo |
| `instrucciones_ia_dinamicas` | ✅ ON | Ninguna | Solo superadmin | ✅ Bajo |
| `notificaciones_admin` | ✅ ON | Ninguna | Staff | ✅ Bajo |
| `whatsapp_messages` | ✅ ON | INSERT+SELECT (mig.012) | All (mig.012) | ⚠️ Política `service_role_all` da acceso total a cualquier rol authenticated |
| `propiedades` | ✅ ON | SELECT only | Staff | ✅ Bajo |
| `conversaciones_instagram` | 🔴 OFF | — | — | ⚠️ Sin RLS — cualquiera con la key puede leer/escribir |
| `meta_tokens` | 🔴 OFF | — | — | 🔴 Sin RLS — tokens almacenados expuestos a cualquier query con service key |

**Nota crítica:** Toda la backend usa `SUPABASE_SECRET_KEY` (service_role). El service_role bypasea RLS completamente. Las políticas RLS protegen el acceso directo desde el frontend o llamadas con `anon` key.

---

## 3. CANALES DE MENSAJERÍA

### WhatsApp ✅ FUNCIONA

**Flujo completo:**
1. Meta envía POST a `/api/whatsapp/webhook` (o `/api/webhook/whatsapp` — duplicado)
2. `validateSignature()` verifica HMAC-SHA256 con `WHATSAPP_APP_SECRET` ✅
3. ACK 200 inmediato
4. `processClientMessage(from, text)`:
   - SELECT/INSERT en `conversaciones_multicanal` (sin timeout — puede colgar si RLS activa con anon key)
   - INSERT mensaje en `mensajes`
   - `responderIA(conv.id, text, 'whatsapp')` → carga instrucciones + historial + Claude API → respuesta
   - `sendWhatsAppMessage(from, respuesta)` → Meta Graph API
5. Admin commands (RESUMEN, RESPONDER, etc.) via `WHATSAPP_ADMIN_NUMBER`

**Variables usadas:** `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_ADMIN_NUMBER`, `CLAUDE_API_KEY`, `SUPABASE_*`

**Envío de cotizaciones WA:**
- `POST /api/whatsapp/enviar-cotizacion` (auth requerida)
- Envía PDF como documento + template `cotizacion_confirmacion` con `{{1}}=código`, `{{2}}=link`
- Template language: `es` ✅ (corregido)

### Instagram ⚠️ PARCIALMENTE FUNCIONA

**Flujo actual:**
1. Meta envía POST a `/api/instagram/webhook`
2. ❌ **Sin validación de firma** — acepta cualquier POST sin verificar HMAC
3. Proceso **síncrono** (res.sendStatus(200) al FINAL, max 4s)
4. `processClientMessage(psid, text)`:
   - INSERT directo en `conversaciones_instagram` (tabla sin RLS, sin FK a `mensajes`)
   - INSERT en `mensajes` falla silenciosamente (FK references `conversaciones_multicanal`, no `conversaciones_instagram`)
   - `responderIA(convId, text, 'instagram')`:
     - Salta historial (array vacío)
     - Salta INSERT en `mensajes` y UPDATE en `conversaciones_multicanal`
     - Llama Claude API directamente via `fetch()` con timeout 20s
     - Devuelve respuesta de texto
   - `sendInstagramMessage(psid, respuesta)` → llama `getMetaToken('instagram')`:
     - Intenta leer de tabla `meta_tokens` (sin RLS, puede colgar si Supabase tiene issues)
     - Fallback a `INSTAGRAM_ACCESS_TOKEN` env var
     - POST a `https://graph.facebook.com/v19.0/me/messages`

**Variables usadas:** `INSTAGRAM_VERIFY_TOKEN`, `WHATSAPP_VERIFY_TOKEN` (fallback), `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_ADMIN_PSID`, `CLAUDE_API_KEY`, `SUPABASE_*`

**Problemas conocidos:**
- ❌ Sin validación X-Hub-Signature-256
- ❌ Historial de conversación no persiste (Instagram ignora `mensajes` tabla)
- ⚠️ `getMetaToken` hace query a Supabase en cada mensaje — si la tabla tarda, introduce latencia
- ⚠️ Sistema de auto-refresh (mig.029 + endpoint) **está en el código** pero **no se ha ejecutado la migración** — VERIFICAR MANUALMENTE si `meta_tokens` existe en Supabase
- ⚠️ El cron semanal llama `POST /api/meta/refresh-token?platform=instagram` pero no pasa `x-cron-secret` en el query string — el endpoint requiere ese header/param

### Facebook Messenger 🔴 NO IMPLEMENTADO

- `POST /api/facebook/enviar-cotizacion` → 501 Not Implemented
- No existe webhook de Messenger
- No existe procesamiento de mensajes Messenger

### Comparación de flujos

| Aspecto | WhatsApp | Instagram | Messenger |
|---|---|---|---|
| Webhook verificación | ✅ HMAC-SHA256 | ❌ Sin firma | 🔴 No existe |
| ACK timing | Inmediato (async post) | Síncrono (4s max) | — |
| Persistencia conversación | ✅ `conversaciones_multicanal` | ⚠️ `conversaciones_instagram` (sin historial útil) | — |
| Historial en IA | ✅ Últimos 20 mensajes | ❌ Array vacío | — |
| Envío cotización | ✅ Template + PDF | ❌ 501 | — |
| Token fuente | Env var directa | DB → fallback env var | — |
| Admin commands | ✅ 8+ comandos | ⚠️ Solo RESUMEN + RESPONDER | — |

---

## 4. AGENTE IA (`agente-ia.js`)

**Función principal:** `responderIA(conversacionId, mensajeCliente, canal='whatsapp')`

**Flujo por canal:**
```
canal='whatsapp':
  1. loadDynamicInstructions() → SELECT instrucciones_ia_dinamicas (Supabase)
  2. getConversationHistory(id) → SELECT mensajes ORDER BY timestamp LIMIT 20
  3. Claude API: modelo haiku-4-5-20251001, max_tokens=600
     → raw fetch() con timeout 20s (reemplazó SDK para compatibilidad Promise.race)
  4. INSERT mensajes (respuesta IA)
  5. UPDATE conversaciones_multicanal.ultima_respuesta_tipo

canal='instagram':
  1. loadDynamicInstructions() → SELECT (puede colgar si RLS issue)
  2. history = [] (skipeado)
  3. Claude API: mismo modelo, mismo timeout
  4. SKIP INSERT mensajes
  5. SKIP UPDATE conversaciones_multicanal
```

**Heurística baja confianza:** si la respuesta contiene "verificar con el equipo" / "te contacto en breve" / "no estoy seguro" → llama `notifyAdmin()` por WhatsApp.

**Recopilación de datos para cotizaciones:** ❌ No implementado. El agente conversa pero **no extrae datos estructurados** (tipo_servicio, m2, zona, contacto) ni crea cotizaciones automáticamente. Solo conversa e informa.

**Instrucciones dinámicas:** cargadas en cada llamada desde `instrucciones_ia_dinamicas`. Staff puede agregar FAQ, políticas y respuestas personalizadas vía WhatsApp commands.

**Endpoint HTTP:** `POST /api/agente-ia/responder` (requiere auth + role asistente).

---

## 5. SISTEMA DE COTIZACIONES

### Machote PDF
- **Ubicación:** `public/assets/machote-cotizacion.html` ✅ Existe
- **Selectores usados en `pdf.js`:** `.doc-codigo-valor`, `.campo-val[]` (nombre, empresa, email, tel, dirección), tabla de servicios (`.r` cells), totales, fecha
- **Generación:** Puppeteer + `@sparticuz/chromium` (serverless) con fallback a Chromium local

### Flujo de cotización completo

```
CRM Admin → Crear cotización (POST /api/cotizaciones)
          → Agregar servicios + precios
          → Frontend construye HTML del machote (_buildMachotePDFHtml)
          → POST /api/cotizaciones/:id/generar-pdf con HTML
             → generarCotizacionPDFFromHTML(html) → puppeteer → PDF buffer
             → subirPDFSupabase(buf, 'COT-XX-XXXXX.pdf') → Supabase Storage
             → UPDATE cotizaciones SET documento_url=url
          → Enviar por WhatsApp (template) o Email (PDF adjunto)
          → Cliente confirma en portal → lead→cliente, código generado, email confirmación
```

### Estado del sistema de cotizaciones

| Componente | Estado |
|---|---|
| CRUD cotizaciones (admin) | ✅ Funciona |
| Precios desde BD | ✅ Funciona |
| Machote HTML | ✅ Existe |
| Generación PDF (puppeteer) | ✅ Funciona en Vercel (sparticuz/chromium) |
| Upload PDF a Supabase Storage | ✅ Funciona |
| Envío email con PDF adjunto | ✅ Funciona (con retry Zoho) |
| Envío WhatsApp (template) | ✅ Funciona |
| Portal cliente (confirmación) | ✅ Funciona |
| Lead → Cliente automático | ✅ Funciona |
| Email confirmación al cliente | ✅ Funciona (con retry) |
| Cotización desde chat IA | 🔴 No implementado |

---

## 6. CRM / PORTAL CLIENTE / WEB

### CRM (`admin.html`)
- Auth: JWT almacenado en `localStorage` con `ve_token`
- `API_URL`: relativa en producción (mismo dominio), `http://localhost:3000` en local
- Funciones: leads, clientes, cotizaciones, propiedades, proyectos, conversaciones, verificaciones
- Auto-refresh dashboard: `setInterval(loadDashboard, 30000)` con guard `window._dashRefreshInterval`
- ⚠️ Diagnósticos `[ENVIO]` aún activos en producción

### Portal cliente (`portal/cotizacion.html`)
- Público: `?cot=ID` no requiere auth
- Muestra: servicios, totales, checkbox de términos
- Confirmación: `POST /api/confirmacion/lead/:id/terminos`
- Éxito: muestra `COT-XX-XXXXX` + `CLI-YY-YYYYY`

### Web pública
- Rutas HTML: `/`, `/admin.html`, `/portal.html`, `/landing.html`, `/real-estate.html`, etc.
- `portal.html`: redirige `?cot=ID` → `portal/cotizacion.html?cot=ID`
- Cookie banner: VERIFICAR MANUALMENTE si existe — no visible en auditoría de código

---

## 7. SEGURIDAD

### Webhooks — validación de firma

| Canal | Endpoint | Firma validada |
|---|---|---|
| WhatsApp | `POST /api/whatsapp/webhook` | ✅ HMAC-SHA256 `x-hub-signature-256` |
| WhatsApp | `POST /api/webhook/whatsapp` (duplicado) | ✅ HMAC-SHA256 (mismo handler) |
| Instagram | `POST /api/instagram/webhook` | ❌ **Sin validación** |
| Cron `/api/cron/limpiar` | POST | ✅ `CRON_SECRET` header |
| Meta `/api/meta/refresh-token` | POST | ✅ `CRON_SECRET` header |

### Secretos hardcodeados en código

| Archivo | Línea | Valor hardcodeado | Riesgo |
|---|---|---|---|
| `src/middleware/auth.js:3` | `'virtual-estate-secret-key'` | JWT_SECRET fallback | 🔴 ALTO — si `JWT_SECRET` no está en Vercel, cualquiera puede forjar tokens |
| `src/routes/auth.js:7` | `'virtual-estate-secret-key'` | Mismo fallback | 🔴 ALTO |
| `src/routes/marketing-agent.js:382` | `'17841443547214652'` | Instagram Account ID fallback | ⚠️ Medio — expone ID de cuenta |

### Llave Supabase usada

**Toda la backend usa `SUPABASE_SECRET_KEY` (service_role)** — bypasea RLS completamente. Esto es correcto para operaciones de servidor, pero implica que cualquier bug que ejecute queries arbitrarias tiene acceso total a la base de datos.

La `SUPABASE_ANON_KEY` está en `.env` local pero **no se usa en ninguna ruta backend**.

### Rate limiting

❌ **No existe rate limiting** en ningún endpoint. Un atacante puede:
- Spam a `/api/leads/public` (crea leads ilimitados)
- Spam a `/api/auth/login` (brute force contraseñas)
- Spam al webhook de Instagram (sin firma = sin costo)
- Generar llamadas ilimitadas a Claude API si obtiene el token de sesión

### Sanitización de inputs

- ✅ Inputs de usuario **no se ejecutan como SQL** (Supabase ORM maneja escape)
- ✅ `sanitizeUsuario()` elimina `password_hash` de respuestas
- ⚠️ Los mensajes de usuarios pasan directamente a Claude API sin sanitización. Posible prompt injection si un usuario envía instrucciones maliciosas. Mitigado parcialmente por el system prompt.
- ❌ No hay validación de tipo/longitud de campos en la mayoría de rutas

### Aislamiento de datos del portal cliente

- `GET /api/clientes/me` → busca por email del JWT — ✅ correcto
- Favoritos/verificación en `/api/clientes/*` → filtra por `cliente_id` del JWT — ✅ correcto
- Portal cotización: `GET /api/confirmacion/cotizacion/:id` → sin validación de ownership (cualquiera con el ID puede ver la cotización) — ⚠️ Riesgo bajo (IDs no predecibles, datos no críticos)

---

## 8. VARIABLES DE ENTORNO

| Variable | Usado en | Obligatorio |
|---|---|---|
| `SUPABASE_URL` | Toda la app | ✅ Sí |
| `SUPABASE_SECRET_KEY` | Toda la app (service_role) | ✅ Sí |
| `JWT_SECRET` | `auth.js`, `middleware/auth.js` | 🔴 Sí — si falta usa fallback inseguro |
| `WHATSAPP_PHONE_NUMBER_ID` | `whatsapp.js`, `envio-cotizacion.js` | ✅ Para WA |
| `WHATSAPP_ACCESS_TOKEN` | `whatsapp.js`, `envio-cotizacion.js` | ✅ Para WA |
| `WHATSAPP_VERIFY_TOKEN` | `webhook-whatsapp.js`, `webhook-instagram.js` | ✅ Para webhooks |
| `WHATSAPP_APP_SECRET` | `webhook-whatsapp.js` (firma) | ✅ Para WA firma |
| `WHATSAPP_ADMIN_NUMBER` | `whatsapp.js` | Opcional |
| `INSTAGRAM_ACCESS_TOKEN` | `webhook-instagram.js`, `marketing-agent.js` | ✅ Para IG |
| `INSTAGRAM_VERIFY_TOKEN` | `webhook-instagram.js` | Opcional (fallback a WA token) |
| `INSTAGRAM_ADMIN_PSID` | `webhook-instagram.js` | Opcional |
| `INSTAGRAM_ACCOUNT_ID` | `marketing-agent.js` | Para publicación posts |
| `MESSENGER_ACCESS_TOKEN` | `meta-tokens.js` | Para Messenger (no implementado) |
| `META_APP_ID` | `meta-tokens.js` (refresh token) | Para renovación tokens |
| `META_APP_SECRET` | `meta-tokens.js` (refresh token) | Para renovación tokens |
| `CLAUDE_API_KEY` | `agente-ia.js` | ✅ Para IA |
| `SMTP_HOST` | `confirmacion.js`, `envio-cotizacion.js` | ✅ Para emails |
| `SMTP_USER` | Mismos | ✅ Para emails |
| `SMTP_PASS` | Mismos | ✅ Para emails |
| `SMTP_PORT` | Mismos | Opcional (default 587) |
| `SMTP_FROM` | Mismos | Opcional (default SMTP_USER) |
| `CRON_SECRET` | `confirmacion.js`, `meta-tokens.js` | ✅ Para crons |
| `APP_URL` | Marketing agent (publicación posts) | Para posts IG |

**VERIFICAR MANUALMENTE en Vercel → Settings → Environment Variables:** que todas las marcadas ✅ estén configuradas.

---

## 9. MARKETING IA

### Estado actual

| Componente | Estado |
|---|---|
| `GET/POST /api/marketing/brand-identity` | ✅ Construido |
| `GET/POST /api/marketing/instructions` | ✅ Construido |
| `GET/POST/DELETE /api/marketing/orders` | ✅ Construido |
| `POST /api/marketing/generate` (5 posts con Claude) | ✅ Construido |
| `GET /api/marketing/posts/pending` | ✅ Construido |
| `PUT /api/marketing/posts/:id/approve` | ✅ Construido |
| `PUT /api/marketing/posts/:id/reject` | ✅ Construido |
| `POST /api/marketing/posts/:id/publish` | ✅ Construido — **nunca probado** |
| `POST /api/marketing/publish-post/:id` | ✅ Construido — **nunca probado** |
| Panel de marketing (`marketing-agent-panel.html`) | ✅ Construido |
| Galería de imágenes de marca | ✅ Construido |
| `image_prompt` para posts | ⚠️ Generado por Claude pero puede ser genérico |
| Publicación real a Instagram | ⚠️ Código existe, requiere: `INSTAGRAM_ACCOUNT_ID` + `INSTAGRAM_ACCESS_TOKEN` + cuenta Business aprobada + imagen pública accesible |

**Nota:** El botón "Publicar" en el panel llama `POST /api/marketing/publish-post/:id` con una imagen de la galería. La publicación usa la Instagram Graph API (`/{account_id}/media` + `/{account_id}/media_publish`). **Nunca ha sido probado en producción.**

---

## 10. CONCLUSIÓN

### Semáforo de componentes

| Componente | Estado | Notas |
|---|---|---|
| Auth JWT (login/verify) | ✅ | Funciona; ⚠️ fallback inseguro si falta JWT_SECRET |
| CRM admin (admin.html) | ✅ | Funciona con logs diagnóstico aún activos |
| CRUD Leads/Clientes/Cots | ✅ | Funciona |
| PDF generación (puppeteer) | ✅ | Funciona en Vercel |
| Envío email cotización | ✅ | Funciona con retry Zoho |
| Email confirmación exitosa | ✅ | Funciona con retry + 15s pre-delay |
| WhatsApp webhook | ✅ | Funciona con firma HMAC |
| WhatsApp envío cotización | ✅ | Template `cotizacion_confirmacion` activo |
| WhatsApp agente IA | ✅ | Funciona con historial |
| Portal cliente (confirmación) | ✅ | Funciona |
| Lead → Cliente automático | ✅ | Funciona |
| Instagram webhook | ⚠️ | Funciona parcialmente — sin firma, sin historial |
| Instagram agente IA | ⚠️ | Responde pero no persiste historial |
| Instagram envío cotización | 🔴 | 501 Not Implemented |
| Sistema refresh tokens Meta | ⚠️ | Código existe, migración pendiente de ejecutar |
| Facebook Messenger | 🔴 | No implementado |
| Marketing IA generación | ⚠️ | Construido, no probado en prod |
| Marketing publicación IG | ⚠️ | Construido, nunca probado |
| Rate limiting | 🔴 | No existe |
| Firma Instagram webhook | 🔴 | No implementada |

### Lista priorizada para lanzamiento

#### 🔴 BLOQUEANTES

1. **JWT_SECRET en Vercel** — si `JWT_SECRET` no está configurado, el fallback `'virtual-estate-secret-key'` permite forjar tokens de admin. VERIFICAR MANUALMENTE.
2. **Validar firma Instagram webhook** — cualquiera puede enviar POSTs falsos a `/api/instagram/webhook` y disparar llamadas a Claude API (costo) o insertar mensajes falsos.
3. **Migración 029** — ejecutar `meta_tokens` en Supabase si el auto-refresh de token va a usarse.
4. **Migración 027** — verificar que los políticas anon para webhooks están aplicadas (necesario si `SUPABASE_SECRET_KEY` no está en el entorno en alguna invocación).

#### ⚠️ IMPORTANTES

5. **Eliminar logs diagnóstico** del código — `[ENVIO]`, `[WA-COT-DEBUG]`, `[ENVIO-WA-DEBUG]` en `admin.html` y `envio-cotizacion.js` son ruido en producción.
6. **Rate limiting mínimo** — al menos en `/api/auth/login` y `/api/leads/public` para prevenir brute force y spam.
7. **Duplicado de rutas WhatsApp** — `/api/whatsapp/webhook` Y `/api/webhook/whatsapp` — verificar cuál está en Meta Dashboard y eliminar el otro.
8. **Instagram Account ID hardcodeado** (`'17841443547214652'` en `marketing-agent.js:382`) — mover a env var.
9. **Historial Instagram** — `conversaciones_instagram` no linkea a `mensajes` (FK rota). El agente IA responde sin contexto conversacional.
10. **Cron refresh token Instagram** — el cron en `vercel.json` llama `GET` pero el endpoint es `POST`. VERIFICAR.

#### 💡 MEJORAS (post-lanzamiento)

11. Sanitización de inputs en Claude (anti-prompt-injection básico).
12. Aislamiento cotización portal — agregar validación de ownership en `GET /api/confirmacion/cotizacion/:id`.
13. Historial persistente para Instagram (rediseñar tabla).
14. Agente IA que extrae datos estructurados y crea cotizaciones desde el chat.
15. Implementar Facebook Messenger.
16. Probar publicación Instagram desde Marketing panel.

### Riesgos de "esto puede romper lo que ya funciona"

| Cambio planificado | Riesgo potencial |
|---|---|
| Agregar firma HMAC a Instagram | Si se configura mal en Meta, los webhooks dejarán de llegar |
| Modificar `agente-ia.js` | Afecta WhatsApp Y Instagram — testing separado obligatorio |
| Cambiar tabla de conversaciones Instagram | La tabla actual `conversaciones_instagram` tiene filas — migración necesaria |
| Ejecutar migración 027 (anon RLS) | Si la migración ya se aplicó parcialmente, puede fallar o crear políticas duplicadas |
| Tocar `confirmacion.js` | Afecta el flujo de confirmación de cotizaciones — riesgo alto de regresión |
| Cambiar SMTP transporter | Los reintentos y delays están calibrados para Zoho — un cambio puede romper el timing |
| Nuevos middleware en server.js | El orden de rutas es crítico — las `/api/whatsapp/webhook` deben ir antes del auth middleware |

---

*Documento generado por auditoría automática. Valores de secretos no incluidos. Secciones marcadas "VERIFICAR MANUALMENTE" requieren revisión en Vercel Dashboard, Supabase Dashboard o Meta App Dashboard.*
