# PROMPT DE TRASPASO — Auditoría de seguridad Virtual Estate

> Pegá TODO este texto en el chat nuevo. Es el estado completo del trabajo de seguridad
> para que nada se pase por alto y se continúe exactamente donde quedó.

---

## Quién soy y qué quiero

Soy Hector, dueño de **Virtual Estate GT** (virtualestategt.com), empresa guatemalteca de
escaneo 3D, tours virtuales y documentación inmobiliaria (Matterport Pro3). Opera bajo dos
sociedades: Paramétrica S.A. y Ciconsa S.A.

Estoy haciendo una **auditoría de ciberseguridad exhaustiva** de mi negocio, que tiene: un
**CRM**, un **portal de clientes** y una **página web**. Quiero que actúes como experto en
ciberseguridad, auditoría de CRM, accesos, protección de datos de clientes e intrusiones.

**Regla de oro innegociable:** nada puede dejar de funcionar. Todo debe seguir igual o mejor.
Antes de tocar cualquier cosa: diagnóstico primero, después plan para mi revisión, y solo con
mi aprobación se implementa, **un paso aislado a la vez**, probando en producción antes de
seguir. Respondé conciso y directo, en español. Soy principiante/intermedio en esto pero
aprendo rápido; me gusta ver el paso a paso resumido.

## Mi stack (confirmado)

- **Backend:** Node.js/Express en **Vercel Hobby** (límite Lambda 50MB; se prueba en
  producción, no local, porque Vercel sirve `public/` como CDN y no se replica localmente).
- **Base de datos:** **Supabase PostgreSQL** (free tier, Oregon). El backend usa la
  **SERVICE_ROLE key** en `src/config/supabase.js` → **bypassa RLS por completo**.
- **Frontend:** HTML estáticos en `public/` (admin.html, portal.html, index.html, landing.html,
  real-estate.html, etc.). **CRÍTICO:** producción sirve los de `public/`, no los de la raíz.
  Cualquier arreglo debe ir a `public/`. La duplicación raíz vs `public/` es fuente conocida de bugs.
- **Frontend NUNCA habla directo con Supabase** — todo pasa por la API. La anon key no se usa
  en ningún lado del backend ni frontend (verificado).
- **Repo:** VIRTUALESTATEGT/virtual-estate, rama `main`. Migraciones SQL numeradas
  secuencialmente (van por 052), se corren **a mano en el SQL Editor de Supabase**.
- **Email:** Zoho SMTP. Utilidades en `src/utils/email.js`:
  `enviarEmail({to,subject,html,attachments,label})`,
  `buildEmailBase({titulo,subtitulo,cuerpoHtml,ctaTexto,ctaLink,unsubscribeToken})`,
  `registrarEmail(...)`, `yaSeEnvio(...)`.
- **Implementación:** uso **Claude Code en VS Code**. Necesito los cambios como **prompts
  copiables** para Claude Code, que no commitee sin mostrarme antes el diff. Commits y tags solo
  con mi aprobación; tags tras verificar en producción, patrón `estable-[modulo]-[fase]`.

## Datos técnicos confirmados en la auditoría

- **Contraseñas:** hoy se guardan como **SHA-256 sin sal** (`crypto.createHash('sha256')`) en
  `src/routes/auth.js` (login, signup, registro-cliente). Columna `usuarios.password` (hex).
- **Roles:** `src/middleware/roles.js` — jerarquía asistente<agente<admin<gerente; `cliente`
  aparte; `is_superadmin` saltea todo. Middlewares: `requireMinRole`, `requirePortalOrStaff`,
  `requireSuperadmin`. Auth JWT en `src/middleware/auth.js`.
- **Token en frontend:** staff = `localStorage 've_token'`; portal cliente = `'ve_portal_token'`.
- **Rate limiting:** existe solo en login (tabla `rate_limit_intentos`, 5 intentos/15 min por IP).
- **Sin inyección SQL:** todo usa el query builder de supabase-js (parametrizado); los `.rpc()`
  usan parámetros con nombre.
- **`.env`:** NO está en git, nunca se commiteó (verificado). Bien.
- **Mi cuenta de acceso:** `hrodas.ciconsa@gmail.com`. Contraseña temporal actual:
  `VeTemporal2026` (se puso a mano en la BD porque no había recuperación). **Debe cambiarse en
  cuanto exista el flujo de cambio de contraseña.**

## LO QUE YA SE HIZO — Fase 1 (COMPLETA Y VERIFICADA)

Tag de restauración: **`estable-seguridad-fase1`** en commit `48beb53`.

1. **Migración 051** (corrida y verificada en Supabase): activó RLS en 8 tablas que estaban
   expuestas (`contenido_generado`, `conversaciones_instagram`, `conversaciones_multicanal`,
   `marca_identidad`, `marketing_instrucciones`, `ordenes_contenido`, `plantillas_compuestas`,
   `referencias_publicidad`) y **borró las políticas anon** (`conversaciones_anon_select` e
   `_insert`) de `conversaciones_multicanal` (evitaban lectura de chats con anon key). Seguro
   porque el backend usa service_role. Verificado: las 8 con `rowsecurity=true`, 0 políticas anon.
2. **`POST /api/auth/signup`** ahora protegido con `authMiddleware + requireSuperadmin` (antes
   era público y creaba usuarios staff). No lo usa ningún frontend.
3. **`src/routes/clientes.js`**: se agregó un guard a nivel de router que bloquea al rol
   `cliente` en toda ruta que no empiece con `/me` (antes un cliente podía listar TODA la base de
   clientes con `GET /api/clientes`). Probado en producción: signup sin token → 401; admin lista
   clientes → 200.

## HALLAZGOS ABIERTOS (pendientes) — por gravedad

**ALTO:**
- **IDOR portal de confirmación:** `GET /api/confirmacion/cotizacion/:id` es público y usa el ID
  secuencial de la cotización, sin token no adivinable → se puede enumerar y exponer PII (nombre,
  email, teléfono, monto). `POST .../confirmar` también acepta cualquier ID. → **Fase 2C**.
- **Webhook WhatsApp sin firma:** `_waWebhookPost` en `server.js` (~línea 548) NO valida
  `x-hub-signature-256` (el de Instagram en `src/routes/webhook-instagram.js` SÍ). Como el
  "dueño" se identifica por `msg.from` (controlable), se pueden falsificar comandos owner
  (`!cliente`, `!personal`). → **Fase 2B**.
- **Secretos con fallback hardcodeado:** `JWT_SECRET` cae a `'virtual-estate-secret-key'`
  (`src/middleware/auth.js` y `src/routes/auth.js`); verify token con fallback similar. Si falta
  la env var, se usa un secreto conocido → cualquiera podría firmar tokens. → **Fase 2B**.
- **Contraseñas SHA-256 sin sal** → migrar a bcrypt. → **Fase 2A**.

**MEDIO:**
- Sin rate limiting general (solo login). Endpoints públicos (`/api/leads/public`,
  `/api/propiedades/public`, confirmación, registro) abiertos a spam/enumeración/DoS. → Fase 3.
- **CORS totalmente abierto** (`app.use(cors())`, `server.js` línea 9). → Fase 3.
- **Faltan headers de seguridad** (helmet): sin X-Frame-Options (clickjacking del admin), HSTS,
  CSP, X-Content-Type-Options. → Fase 3.
- **Endpoints de debug** exponen info: `/api/debug` (`server.js` ~265) revela `__dirname` +
  listado de archivos; `/test-debug`; `/health`. → Fase 3.

**BAJO:**
- Logs verbosos con PII (teléfonos, cuerpo completo del webhook, prefijos de tokens). → Fase 3.

## AUDITORÍA DE BOTONES (documento `AUDITORIA-BOTONES.md` en la raíz del repo)

Barrido estático del frontend. Botones que muestran "✅ éxito" pero NO hacen nada ("falsos"):
- **Portal:** "Cambiar contraseña" (falso, peligroso), "¿Olvidaste tu contraseña?" (falso, sin
  backend), "Guardar cambios" del perfil (falso; el endpoint `PUT /api/clientes/me` YA existe),
  "Descargar cotización" (número fijo), y placeholders honestos ("Agregar tarjeta", "Cambiar foto",
  login Apple/Google).
- **Admin:** "Guardar datos de empresa" y "Guardar preferencias de notificación" (falsos),
  "Agregar usuario" y botones "Contactar" con nombres demo (placeholders).
- El formulario de perfil del portal es un **maquetado**: campos con datos falsos ("Ana",
  "ana@correo.com") y **sin `id`** — hay que cargar datos reales y ponerles id para conectarlos.

## PLAN DE LA FASE 2 (donde quedamos)

Decidido empezar por **Fase 2A**. Faltan confirmar 2 decisiones (mi recomendación: A y A):
- **Hashing:** (A) bcrypt **compatible hacia atrás** — el login acepta el hash viejo y lo
  re-guarda como bcrypt al iniciar sesión; nadie resetea. vs (B) forzar reset a todos. → yo me
  inclino por **A**.
- **Alcance del perfil:** (A) hacer perfil **completo** (cargar datos reales + guardar con el
  endpoint que ya existe) además de contraseñas. vs (B) solo contraseñas. → yo me inclino por **A**.

**Fase 2A — sistema de contraseñas seguro + perfil:**
1. Instalar **bcryptjs** (JS puro, seguro en Vercel Lambda; NO el `bcrypt` nativo).
2. Migrar hashing a bcrypt con compatibilidad hacia atrás (detectar SHA-256 vs bcrypt, validar,
   re-hashear al login exitoso). Registros nuevos con bcrypt.
3. `POST /api/auth/cambiar-password` (autenticado): valida actual, guarda nueva con bcrypt.
4. `POST /api/auth/recuperar` (público): token aleatorio (`crypto.randomBytes`) con expiración,
   guardado en BD, email con link por Zoho. Responde siempre 200 (no revela si el email existe).
5. `POST /api/auth/reset` (público): token + nueva contraseña, valida no expirado, actualiza con
   bcrypt, quema el token.
6. **Migración 052:** tabla `password_resets` (token, usuario/email, expira).
7. **Frontend `public/portal.html`:** conectar de verdad "¿Olvidaste tu contraseña?" (~línea 341),
   "Cambiar contraseña" (~1262) y una pantalla de reset (link del email); cargar datos reales del
   perfil y conectar "Guardar cambios" (~1249) a `PUT /api/clientes/me`. (Ojo: inputs sin id hoy.)

**Fase 2B — endurecimiento API (sin UI):** firma del webhook WhatsApp; quitar fallbacks de secretos.
**Fase 2C — IDOR confirmación:** token no adivinable en el link de confirmación (toca los emails).

## Qué necesito ahora

Confirmá las 2 decisiones (te recomiendo A y A) y armá el **plan detallado de la Fase 2A** con el
diagnóstico de cada cambio y el **prompt copiable para Claude Code** (que no commitee sin
mostrarme el diff). Recordá la regla de oro: nada puede dejar de funcionar. Un paso a la vez,
prueba en producción, commit y tag `estable-seguridad-fase2a` al final.
