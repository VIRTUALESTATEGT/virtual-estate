# Auditoría de botones — Virtual Estate

Revisión estática (solo lectura) de los botones y acciones del frontend en producción
(archivos `public/`). Cada elemento se clasifica en:

- ✅ **Funciona** — llama a un endpoint real o hace una acción real.
- 🟠 **Falso** — muestra un mensaje de éxito pero NO ejecuta la acción (engaña al usuario).
- 🟡 **Placeholder** — botón "próximamente" o demo; declara que no está listo.
- 🟢 **Intencional** — no hace acción directa a propósito (ej. redirige a WhatsApp).

Fecha: 11 jul 2026 · Basado en el commit de código auditado.

---

## Portal del cliente (`public/portal.html`)

| Botón / acción | Estado | Qué pasa realmente | Prioridad |
|---|---|---|---|
| **Cambiar contraseña** (perfil) | 🟠 Falso | Muestra "✅ Contraseña actualizada" pero NO cambia nada. No existe endpoint. El cliente cree que cambió su clave y no es así. | **Alta** |
| **¿Olvidaste tu contraseña?** | 🟠 Falso | Muestra "te enviaremos un correo" pero no llama a nada ni envía correo. No existe recuperación. | **Alta** |
| **Guardar cambios** (perfil) | 🟠 Falso | Muestra "✅ Información actualizada" pero NO guarda. El endpoint `PUT /api/clientes/me` SÍ existe — solo falta conectarlo. | **Media** |
| **Login con Apple ID / Google** (login y registro) | 🟡 Placeholder | Muestra "Redirigiendo…" sin OAuth real. | Baja |
| **Descargar cotización** (COT-26-0001) | 🟠 Falso | Descarga simulada con número fijo hardcodeado. | Media |
| **Agregar nueva tarjeta** (pagos) | 🟡 Placeholder | "Función disponible próximamente" (pago con tarjeta — backlog conocido). | Baja |
| **Cambiar foto** (perfil) | 🟡 Placeholder | "Función disponible próximamente". | Baja |
| **Solicitar cambio de cuenta bancaria** | 🟢 Intencional | Redirige a WhatsApp a propósito (dato sensible). | OK |
| **Copiar código de agente** | ✅ Funciona | Copia al portapapeles real. | OK |
| Login / Registro / Ver cotizaciones / Confirmar / Favoritos | ✅ Funciona | Llaman a endpoints reales (los usás a diario). | OK |

---

## Panel admin (`public/admin.html`)

| Botón / acción | Estado | Qué pasa realmente | Prioridad |
|---|---|---|---|
| **Guardar datos** (datos de empresa / config) | 🟠 Falso | Muestra "✅ Datos de empresa guardados" pero NO persiste nada. | Media |
| **Guardar** (preferencias de notificación) | 🟠 Falso | Muestra "✅ Preferencias guardadas" pero NO guarda. | Media |
| **Agregar usuario** | 🟡 Placeholder | "Función disponible próximamente". | Baja |
| **Contactar** (Roberto Vásquez / Sofía Herrera / Luis Castillo) | 🟡 Placeholder | Sección demo con nombres fijos; no son clientes reales ni contacta a nadie. | Baja |
| **WhatsApp** (en acciones de comisión) | 🟡 Placeholder | Muestra "WhatsApp…" sin acción. | Baja |
| Gestión de leads / clientes / cotizaciones / propiedades / marketing | ✅ Funciona | Endpoints reales protegidos con JWT. | OK |

---

## Páginas públicas (`index.html`, `landing.html`, `real-estate.html`)

No se encontraron botones falsos tipo "mostrar mensaje y no hacer nada". Los CTA usan
enlaces reales. (Pendiente opcional: verificar que ningún enlace/CTA apunte a una URL
rota — eso requiere prueba en vivo, no barrido estático.)

---

## Resumen y recomendación

Lo más urgente son los **botones "falsos"** (🟠), porque muestran un mensaje de éxito
sin hacer la acción — el usuario queda con información equivocada. En orden:

1. **Cambiar contraseña** (portal) — el más delicado: da falsa seguridad.
2. **Recuperar contraseña** (portal) — sin esto, recuperar acceso obliga a entrar a la BD.
3. **Guardar perfil** (portal) — el backend ya existe, es solo conectar el botón.
4. **Guardar datos de empresa / preferencias** (admin) — decidir si se implementan o se ocultan.

Los tres primeros encajan naturalmente en la **Fase 2 de seguridad** (junto con el flujo
seguro de contraseñas). Los 🟡 "próximamente" son honestos con el usuario; se pueden dejar
o esconder según prioridad de negocio.
