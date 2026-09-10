-- ============================================================
-- Migration 068: Actualización de tipos (categorías) del catálogo
-- ============================================================
-- Cambia el campo `tipo` de los 76 items existentes a los 10 slugs nuevos.
-- NO hay cascade: propiedades_adicionales almacena `nombre`, no `tipo`.
-- Ejecutar DESPUÉS de 067 (los nombres ya están actualizados).
-- ============================================================

BEGIN;

-- -- SERVICIOS BÁSICOS -> servicios_infraestructura (11 items) -----------------
-- (Portero se maneja abajo junto con los que van a seguridad_estacionamiento)
UPDATE adicionales_catalogo SET tipo = 'servicios_infraestructura'
WHERE nombre IN (
  'Agua potable',
  'Drenaje sanitario',
  'Cable / TV',
  'Electricidad',
  'Gas natural',
  'Internet disponible',
  'Pavimento o calles asfaltadas',
  'Telefonía',
  'Paneles solares',
  'Planta eléctrica / generador',
  'Cisterna'
);

-- -- ESPACIOS Y AMBIENTES -> espacios_privados (25 items) ---------------------
UPDATE adicionales_catalogo SET tipo = 'espacios_privados'
WHERE nombre IN (
  'Antecomedor',
  'Ático',
  'Balcón',
  'Bodega',
  'Chimenea',
  'Cocina equipada',
  'Cocina integral',
  'Comedor',
  'Cuarto de servicio',
  'Escritorio',
  'Estudio',
  'Galería',
  'Garaje',
  'Jardín',
  'Lavandería',
  'Living comedor',
  'Mini bodega',
  'Oficina privada',
  'Patio',
  'Sala',
  'Sótano',
  'Suite principal',
  'Terraza',
  'Vestíbulo',
  'Roof garden privado'
);

-- -- ESPACIOS Y AMBIENTES -> caracteristicas_fisicas (4 items) ----------------
UPDATE adicionales_catalogo SET tipo = 'caracteristicas_fisicas'
WHERE nombre IN (
  'Dos niveles',
  'Planta baja',
  'Recámara en planta baja',
  'Tres o más niveles'
);

-- -- ESPACIOS Y AMBIENTES -> seguridad_estacionamiento (1 item) ---------------
UPDATE adicionales_catalogo SET tipo = 'seguridad_estacionamiento'
WHERE nombre = 'Elevador' AND tipo = 'espacios_ambientes';

-- -- ESPACIOS Y AMBIENTES -> amenidades_compartidas (1 item) ------------------
UPDATE adicionales_catalogo SET tipo = 'amenidades_compartidas'
WHERE nombre = 'Asadores';

-- -- ADICIONALES -> equipamiento_confort (4 items) ----------------------------
UPDATE adicionales_catalogo SET tipo = 'equipamiento_confort'
WHERE nombre IN (
  'Aire acondicionado',
  'Amueblado',
  'Calefacción',
  'Sistema de riego automático'
);

-- -- ADICIONALES -> espacios_privados (5 items) -------------------------------
UPDATE adicionales_catalogo SET tipo = 'espacios_privados'
WHERE nombre IN (
  'Piscina privada',
  'Deck',
  'Jacuzzi privado',
  'Asador / parrilla privada',
  'Solárium'
);

-- -- ADICIONALES -> seguridad_estacionamiento (5 items) -----------------------
UPDATE adicionales_catalogo SET tipo = 'seguridad_estacionamiento'
WHERE nombre IN (
  'Portero',
  'Alarma',
  'Estacionamiento subterráneo',
  'Muro perimetral',
  'Seguridad 24 horas',
  'Lobby'
);

-- -- ADICIONALES -> caracteristicas_fisicas (1 item) --------------------------
UPDATE adicionales_catalogo SET tipo = 'caracteristicas_fisicas'
WHERE nombre = 'En construcción';

-- -- ADICIONALES -> amenidades_compartidas (4 items) --------------------------
UPDATE adicionales_catalogo SET tipo = 'amenidades_compartidas'
WHERE nombre IN (
  'Sauna',
  'Simulador de golf',
  'Área de yoga',
  'Acceso a playa'
);

-- -- ADICIONALES -> politicas_condiciones (2 items) ---------------------------
UPDATE adicionales_catalogo SET tipo = 'politicas_condiciones'
WHERE nombre IN (
  'Apto crédito hipotecario',
  'Apto para mascotas'
);

-- -- AMENIDADES -> amenidades_compartidas (12 items, bulk) --------------------
-- Cubre: Área de juegos infantiles, Cancha de pádel, Cancha de tenis,
--        Área deportiva, Cine/sala de cine, Fire pit/fogatero, Gimnasio,
--        Piscina comunitaria, Sala de juegos, SUM/salón de usos múltiples,
--        BBQ común, Coworking
UPDATE adicionales_catalogo SET tipo = 'amenidades_compartidas'
WHERE tipo = 'amenidades';

-- -- VERIFICACIÓN -------------------------------------------------------------
-- Debe retornar 0 filas (ningún item con tipo viejo)
-- SELECT nombre, tipo FROM adicionales_catalogo
-- WHERE tipo IN ('servicios_basicos','espacios_ambientes','adicionales','amenidades')
-- ORDER BY tipo, nombre;

COMMIT;
