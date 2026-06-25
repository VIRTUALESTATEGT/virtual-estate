-- Migration 033: add 'handoff_humano' to notificaciones_admin.tipo CHECK constraint
ALTER TABLE notificaciones_admin DROP CONSTRAINT IF EXISTS notificaciones_admin_tipo_check;
ALTER TABLE notificaciones_admin ADD CONSTRAINT notificaciones_admin_tipo_check
  CHECK (tipo IN (
    'verificacion_pendiente',
    'cotizacion_revision',
    'cliente_riesgo',
    'zona_roja',
    'handoff_humano'
  ));
