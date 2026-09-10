-- ============================================================
-- Migration 069: Insert 277 nuevos items al catálogo expandido
-- ============================================================
-- Ejecutar DESPUÉS de 067 (renames) y 068 (tipos).
-- Los items excluidos intencionalmente:
--   'Planta eléctrica' (cat. 9) -> ya existe como 'Planta eléctrica / generador'
--   16 duplicados de nombre entre categorías -> quedan en el tipo primario definido en 068
-- ============================================================

BEGIN;

-- -- SERVICIOS BÁSICOS E INFRAESTRUCTURA (24 nuevos) --------------------------
INSERT INTO adicionales_catalogo (tipo, nombre, orden) VALUES
  ('servicios_infraestructura', 'Agua de pozo', 20),
  ('servicios_infraestructura', 'Fosa séptica', 21),
  ('servicios_infraestructura', 'Instalación eléctrica trifásica', 22),
  ('servicios_infraestructura', 'Gas estacionario', 23),
  ('servicios_infraestructura', 'Fibra óptica', 24),
  ('servicios_infraestructura', 'Alumbrado público', 25),
  ('servicios_infraestructura', 'Recolección de basura', 26),
  ('servicios_infraestructura', 'Tinaco', 27),
  ('servicios_infraestructura', 'Bomba de agua', 28),
  ('servicios_infraestructura', 'Presurizador de agua', 29),
  ('servicios_infraestructura', 'Calentador de agua', 30),
  ('servicios_infraestructura', 'Calentador solar', 31),
  ('servicios_infraestructura', 'Planta eléctrica de emergencia en áreas comunes', 32),
  ('servicios_infraestructura', 'Sistema de captación de agua de lluvia', 33),
  ('servicios_infraestructura', 'Tratamiento de aguas residuales', 34),
  ('servicios_infraestructura', 'Pozo propio', 35),
  ('servicios_infraestructura', 'Sistema contra incendios', 36),
  ('servicios_infraestructura', 'Detectores de humo', 37),
  ('servicios_infraestructura', 'Rociadores contra incendios', 38),
  ('servicios_infraestructura', 'Extintores', 39),
  ('servicios_infraestructura', 'Salidas de emergencia', 40),
  ('servicios_infraestructura', 'Escaleras de emergencia', 41),
  ('servicios_infraestructura', 'Red de gas', 42),
  ('servicios_infraestructura', 'Cargadores para vehículos eléctricos', 43)
ON CONFLICT (nombre) DO NOTHING;

-- -- ESPACIOS Y AMBIENTES PRIVADOS (43 nuevos) --------------------------------
INSERT INTO adicionales_catalogo (tipo, nombre, orden) VALUES
  ('espacios_privados', 'Sala familiar', 50),
  ('espacios_privados', 'Sala de TV', 51),
  ('espacios_privados', 'Sala de estar', 52),
  ('espacios_privados', 'Recibidor', 53),
  ('espacios_privados', 'Cocina', 54),
  ('espacios_privados', 'Cocina con isla', 55),
  ('espacios_privados', 'Cocina abierta', 56),
  ('espacios_privados', 'Cocina cerrada', 57),
  ('espacios_privados', 'Cocineta', 58),
  ('espacios_privados', 'Despensa', 59),
  ('espacios_privados', 'Alacena', 60),
  ('espacios_privados', 'Desayunador', 61),
  ('espacios_privados', 'Dormitorio principal', 62),
  ('espacios_privados', 'Dormitorios secundarios', 63),
  ('espacios_privados', 'Walk-in closet', 64),
  ('espacios_privados', 'Clóset', 65),
  ('espacios_privados', 'Baño completo', 66),
  ('espacios_privados', 'Medio baño / baño de visitas', 67),
  ('espacios_privados', 'Baño en suite', 68),
  ('espacios_privados', 'Baño compartido', 69),
  ('espacios_privados', 'Biblioteca', 70),
  ('espacios_privados', 'Cuarto de juegos', 71),
  ('espacios_privados', 'Sala de cine privada', 72),
  ('espacios_privados', 'Gimnasio privado', 73),
  ('espacios_privados', 'Cuarto de música', 74),
  ('espacios_privados', 'Cuarto de costura', 75),
  ('espacios_privados', 'Habitación de servicio interior', 76),
  ('espacios_privados', 'Habitación de servicio exterior', 77),
  ('espacios_privados', 'Baño de servicio', 78),
  ('espacios_privados', 'Área de lavado', 79),
  ('espacios_privados', 'Patio de tendido', 80),
  ('espacios_privados', 'Mezanine', 81),
  ('espacios_privados', 'Terraza techada', 82),
  ('espacios_privados', 'Pérgola', 83),
  ('espacios_privados', 'Porche', 84),
  ('espacios_privados', 'Corredor', 85),
  ('espacios_privados', 'Bar', 86),
  ('espacios_privados', 'Cava de vinos', 87),
  ('espacios_privados', 'Taller', 88),
  ('espacios_privados', 'Cuarto de herramientas', 89),
  ('espacios_privados', 'Caseta de vigilancia privada', 90),
  ('espacios_privados', 'Cochera techada', 91),
  ('espacios_privados', 'Estacionamiento subterráneo privado', 92)
ON CONFLICT (nombre) DO NOTHING;

-- -- CARACTERÍSTICAS FÍSICAS Y DISTRIBUCIÓN (26 nuevos) -----------------------
INSERT INTO adicionales_catalogo (tipo, nombre, orden) VALUES
  ('caracteristicas_fisicas', 'Accesible sin gradas', 1),
  ('caracteristicas_fisicas', 'Un nivel', 2),
  ('caracteristicas_fisicas', 'Doble altura', 3),
  ('caracteristicas_fisicas', 'Techos altos', 4),
  ('caracteristicas_fisicas', 'Ventanales grandes', 5),
  ('caracteristicas_fisicas', 'Iluminación natural', 6),
  ('caracteristicas_fisicas', 'Ventilación cruzada', 7),
  ('caracteristicas_fisicas', 'Vista a ciudad', 8),
  ('caracteristicas_fisicas', 'Vista a montaña', 9),
  ('caracteristicas_fisicas', 'Vista al mar', 10),
  ('caracteristicas_fisicas', 'Vista a lago', 11),
  ('caracteristicas_fisicas', 'Vista a jardín', 12),
  ('caracteristicas_fisicas', 'Vista panorámica', 13),
  ('caracteristicas_fisicas', 'Frente a parque', 14),
  ('caracteristicas_fisicas', 'Frente a playa', 15),
  ('caracteristicas_fisicas', 'Frente a calle principal', 16),
  ('caracteristicas_fisicas', 'Esquina', 17),
  ('caracteristicas_fisicas', 'Lote en condominio', 18),
  ('caracteristicas_fisicas', 'Construcción nueva', 19),
  ('caracteristicas_fisicas', 'Remodelado', 20),
  ('caracteristicas_fisicas', 'Para remodelar', 21),
  ('caracteristicas_fisicas', 'Diseño contemporáneo', 22),
  ('caracteristicas_fisicas', 'Diseño colonial', 23),
  ('caracteristicas_fisicas', 'Diseño industrial', 24),
  ('caracteristicas_fisicas', 'Diseño rústico', 25),
  ('caracteristicas_fisicas', 'Diseño minimalista', 26)
ON CONFLICT (nombre) DO NOTHING;

-- -- EQUIPAMIENTO Y CONFORT (32 nuevos) ---------------------------------------
INSERT INTO adicionales_catalogo (tipo, nombre, orden) VALUES
  ('equipamiento_confort', 'Semi amueblado', 20),
  ('equipamiento_confort', 'Sin amueblar', 21),
  ('equipamiento_confort', 'Línea blanca incluida', 22),
  ('equipamiento_confort', 'Refrigeradora', 23),
  ('equipamiento_confort', 'Estufa', 24),
  ('equipamiento_confort', 'Horno', 25),
  ('equipamiento_confort', 'Microondas', 26),
  ('equipamiento_confort', 'Lavavajillas', 27),
  ('equipamiento_confort', 'Lavadora', 28),
  ('equipamiento_confort', 'Secadora', 29),
  ('equipamiento_confort', 'Centro de lavado', 30),
  ('equipamiento_confort', 'Aire acondicionado central', 31),
  ('equipamiento_confort', 'Mini split', 32),
  ('equipamiento_confort', 'Calefacción central', 33),
  ('equipamiento_confort', 'Ventiladores de techo', 34),
  ('equipamiento_confort', 'Cortinas o persianas', 35),
  ('equipamiento_confort', 'Blackout', 36),
  ('equipamiento_confort', 'Domótica', 37),
  ('equipamiento_confort', 'Iluminación inteligente', 38),
  ('equipamiento_confort', 'Cerradura inteligente', 39),
  ('equipamiento_confort', 'Videoportero', 40),
  ('equipamiento_confort', 'Intercomunicador', 41),
  ('equipamiento_confort', 'Sistema de sonido', 42),
  ('equipamiento_confort', 'Cableado estructurado', 43),
  ('equipamiento_confort', 'Internet instalado', 44),
  ('equipamiento_confort', 'Purificador de agua', 45),
  ('equipamiento_confort', 'Triturador de basura', 46),
  ('equipamiento_confort', 'Extractor de cocina', 47),
  ('equipamiento_confort', 'Tanque de gas', 48),
  ('equipamiento_confort', 'Bomba de calor', 49),
  ('equipamiento_confort', 'Generador privado', 50),
  ('equipamiento_confort', 'Paneles solares privados', 51)
ON CONFLICT (nombre) DO NOTHING;

-- -- SEGURIDAD, ACCESO Y ESTACIONAMIENTO (21 nuevos) --------------------------
INSERT INTO adicionales_catalogo (tipo, nombre, orden) VALUES
  ('seguridad_estacionamiento', 'Garita de seguridad', 30),
  ('seguridad_estacionamiento', 'Recepción', 31),
  ('seguridad_estacionamiento', 'Control de acceso', 32),
  ('seguridad_estacionamiento', 'Acceso con tarjeta', 33),
  ('seguridad_estacionamiento', 'Acceso biométrico', 34),
  ('seguridad_estacionamiento', 'Circuito cerrado de cámaras', 35),
  ('seguridad_estacionamiento', 'Cerca eléctrica', 36),
  ('seguridad_estacionamiento', 'Condominio cerrado', 37),
  ('seguridad_estacionamiento', 'Puerta automática', 38),
  ('seguridad_estacionamiento', 'Portón eléctrico', 39),
  ('seguridad_estacionamiento', 'Vigilancia privada', 40),
  ('seguridad_estacionamiento', 'Parqueo de visitas', 41),
  ('seguridad_estacionamiento', 'Estacionamiento asignado', 42),
  ('seguridad_estacionamiento', 'Estacionamiento techado', 43),
  ('seguridad_estacionamiento', 'Estacionamiento para motocicletas', 44),
  ('seguridad_estacionamiento', 'Bicicletero', 45),
  ('seguridad_estacionamiento', 'Bodega asociada a estacionamiento', 46),
  ('seguridad_estacionamiento', 'Acceso para personas con movilidad reducida', 47),
  ('seguridad_estacionamiento', 'Rampas', 48),
  ('seguridad_estacionamiento', 'Elevador de carga', 49),
  ('seguridad_estacionamiento', 'Montacargas', 50)
ON CONFLICT (nombre) DO NOTHING;

-- -- AMENIDADES COMPARTIDAS (41 nuevos) ---------------------------------------
INSERT INTO adicionales_catalogo (tipo, nombre, orden) VALUES
  ('amenidades_compartidas', 'Piscina para niños', 40),
  ('amenidades_compartidas', 'Piscina climatizada', 41),
  ('amenidades_compartidas', 'Jacuzzi comunal', 42),
  ('amenidades_compartidas', 'Vapor', 43),
  ('amenidades_compartidas', 'Spa', 44),
  ('amenidades_compartidas', 'Área de pilates', 45),
  ('amenidades_compartidas', 'Cancha de fútbol', 46),
  ('amenidades_compartidas', 'Cancha de básquetbol', 47),
  ('amenidades_compartidas', 'Cancha de voleibol', 48),
  ('amenidades_compartidas', 'Cancha de squash', 49),
  ('amenidades_compartidas', 'Pista para correr', 50),
  ('amenidades_compartidas', 'Senderos', 51),
  ('amenidades_compartidas', 'Ludoteca', 52),
  ('amenidades_compartidas', 'Mesa de billar', 53),
  ('amenidades_compartidas', 'Ping pong', 54),
  ('amenidades_compartidas', 'Putting green', 55),
  ('amenidades_compartidas', 'Salón social', 56),
  ('amenidades_compartidas', 'Salón para eventos', 57),
  ('amenidades_compartidas', 'Salón de reuniones', 58),
  ('amenidades_compartidas', 'Business center', 59),
  ('amenidades_compartidas', 'Sala de estudio', 60),
  ('amenidades_compartidas', 'Lounge', 61),
  ('amenidades_compartidas', 'Rooftop comunal', 62),
  ('amenidades_compartidas', 'Roof garden comunal', 63),
  ('amenidades_compartidas', 'Terraza comunal', 64),
  ('amenidades_compartidas', 'Jardines comunes', 65),
  ('amenidades_compartidas', 'Parque para mascotas', 66),
  ('amenidades_compartidas', 'Área de mascotas', 67),
  ('amenidades_compartidas', 'Pet spa', 68),
  ('amenidades_compartidas', 'Cocina comunal', 69),
  ('amenidades_compartidas', 'Bar comunal', 70),
  ('amenidades_compartidas', 'Huerto comunitario', 71),
  ('amenidades_compartidas', 'Área de picnic', 72),
  ('amenidades_compartidas', 'Capilla', 73),
  ('amenidades_compartidas', 'Club house', 74),
  ('amenidades_compartidas', 'Muelle', 75),
  ('amenidades_compartidas', 'Marina', 76),
  ('amenidades_compartidas', 'Campo de golf', 77),
  ('amenidades_compartidas', 'Lago artificial', 78),
  ('amenidades_compartidas', 'Mirador', 79),
  ('amenidades_compartidas', 'Área de meditación', 80)
ON CONFLICT (nombre) DO NOTHING;

-- -- SERVICIOS DEL EDIFICIO / CONDOMINIO (24 nuevos) --------------------------
INSERT INTO adicionales_catalogo (tipo, nombre, orden) VALUES
  ('servicios_edificio', 'Lavandería comunal', 1),
  ('servicios_edificio', 'Bodega comunal', 2),
  ('servicios_edificio', 'Lockers', 3),
  ('servicios_edificio', 'Buzones', 4),
  ('servicios_edificio', 'Paquetería / recepción de entregas', 5),
  ('servicios_edificio', 'Concierge', 6),
  ('servicios_edificio', 'Administración en sitio', 7),
  ('servicios_edificio', 'Limpieza de áreas comunes', 8),
  ('servicios_edificio', 'Cuarto de basura', 9),
  ('servicios_edificio', 'Cuarto de reciclaje', 10),
  ('servicios_edificio', 'Planta eléctrica para áreas comunes', 11),
  ('servicios_edificio', 'Cisterna comunal', 12),
  ('servicios_edificio', 'Agua incluida', 13),
  ('servicios_edificio', 'Internet en áreas comunes', 14),
  ('servicios_edificio', 'Wi-Fi comunal', 15),
  ('servicios_edificio', 'Transporte interno', 16),
  ('servicios_edificio', 'Shuttle', 17),
  ('servicios_edificio', 'Área comercial', 18),
  ('servicios_edificio', 'Mini mercado', 19),
  ('servicios_edificio', 'Restaurante o cafetería', 20),
  ('servicios_edificio', 'Farmacia', 21),
  ('servicios_edificio', 'Guardería', 22),
  ('servicios_edificio', 'Sala de espera', 23),
  ('servicios_edificio', 'Baños para visitas', 24)
ON CONFLICT (nombre) DO NOTHING;

-- -- OFICINAS Y LOCALES (25 nuevos) -------------------------------------------
INSERT INTO adicionales_catalogo (tipo, nombre, orden) VALUES
  ('oficinas_locales', 'Oficina amueblada', 1),
  ('oficinas_locales', 'Espacio abierto', 2),
  ('oficinas_locales', 'Planta libre', 3),
  ('oficinas_locales', 'Cubículos', 4),
  ('oficinas_locales', 'Sala de reuniones', 5),
  ('oficinas_locales', 'Sala de conferencias', 6),
  ('oficinas_locales', 'Área de espera', 7),
  ('oficinas_locales', 'Área de capacitación', 8),
  ('oficinas_locales', 'Comedor de empleados', 9),
  ('oficinas_locales', 'Archivo', 10),
  ('oficinas_locales', 'Cuarto de servidores', 11),
  ('oficinas_locales', 'Red de datos', 12),
  ('oficinas_locales', 'Acceso 24/7', 13),
  ('oficinas_locales', 'Parqueo para clientes', 14),
  ('oficinas_locales', 'Parqueo para empleados', 15),
  ('oficinas_locales', 'Local a pie de calle', 16),
  ('oficinas_locales', 'Vitrina', 17),
  ('oficinas_locales', 'Alto flujo peatonal', 18),
  ('oficinas_locales', 'Alta visibilidad', 19),
  ('oficinas_locales', 'Rótulo permitido', 20),
  ('oficinas_locales', 'Uso comercial', 21),
  ('oficinas_locales', 'Uso corporativo', 22),
  ('oficinas_locales', 'Uso médico', 23),
  ('oficinas_locales', 'Uso para restaurante', 24),
  ('oficinas_locales', 'Uso industrial ligero', 25)
ON CONFLICT (nombre) DO NOTHING;

-- -- BODEGAS E INDUSTRIA (22 nuevos) ------------------------------------------
INSERT INTO adicionales_catalogo (tipo, nombre, orden) VALUES
  ('bodegas_industria', 'Nave industrial', 1),
  ('bodegas_industria', 'Andén de carga', 2),
  ('bodegas_industria', 'Rampas de carga', 3),
  ('bodegas_industria', 'Muelle de carga', 4),
  ('bodegas_industria', 'Altura libre alta', 5),
  ('bodegas_industria', 'Oficina administrativa', 6),
  ('bodegas_industria', 'Área de producción', 7),
  ('bodegas_industria', 'Área de almacenamiento', 8),
  ('bodegas_industria', 'Patio de maniobras', 9),
  ('bodegas_industria', 'Parqueo para camiones', 10),
  ('bodegas_industria', 'Acceso para tráiler', 11),
  ('bodegas_industria', 'Energía trifásica', 12),
  ('bodegas_industria', 'Rociadores', 13),
  ('bodegas_industria', 'Piso industrial', 14),
  ('bodegas_industria', 'Techo termoacústico', 15),
  ('bodegas_industria', 'Garita', 16),
  ('bodegas_industria', 'Circuito cerrado', 17),
  ('bodegas_industria', 'Zona franca', 18),
  ('bodegas_industria', 'Parque industrial', 19),
  ('bodegas_industria', 'Uso industrial', 20),
  ('bodegas_industria', 'Uso logístico', 21),
  ('bodegas_industria', 'Acceso a carretera principal', 22)
ON CONFLICT (nombre) DO NOTHING;

-- -- POLÍTICAS Y CONDICIONES (19 nuevos) --------------------------------------
INSERT INTO adicionales_catalogo (tipo, nombre, orden) VALUES
  ('politicas_condiciones', 'Sin mascotas', 10),
  ('politicas_condiciones', 'Apto para niños', 11),
  ('politicas_condiciones', 'Solo adultos', 12),
  ('politicas_condiciones', 'Apto para estudiantes', 13),
  ('politicas_condiciones', 'Apto para uso comercial', 14),
  ('politicas_condiciones', 'Apto para Airbnb / renta corta', 15),
  ('politicas_condiciones', 'Renta amueblada', 16),
  ('politicas_condiciones', 'Renta sin amueblar', 17),
  ('politicas_condiciones', 'Servicios incluidos', 18),
  ('politicas_condiciones', 'Mantenimiento incluido', 19),
  ('politicas_condiciones', 'Financiamiento disponible', 20),
  ('politicas_condiciones', 'Negociable', 21),
  ('politicas_condiciones', 'Entrega inmediata', 22),
  ('politicas_condiciones', 'Preventa', 23),
  ('politicas_condiciones', 'Propiedad vacacional', 24),
  ('politicas_condiciones', 'Propiedad de inversión', 25),
  ('politicas_condiciones', 'Accesible para personas con discapacidad', 26),
  ('politicas_condiciones', 'Se permite fumar', 27),
  ('politicas_condiciones', 'No fumar', 28)
ON CONFLICT (nombre) DO NOTHING;

-- -- VERIFICACIÓN -------------------------------------------------------------
-- Conteo por tipo (debe dar 353 activos + 1 Hidromasaje desactivado = 354):
-- SELECT tipo, COUNT(*) AS total, SUM(CASE WHEN activo THEN 1 ELSE 0 END) AS activos
-- FROM adicionales_catalogo GROUP BY tipo ORDER BY tipo;
--
-- Resultado esperado:
--   amenidades_compartidas   | 58  | 58
--   bodegas_industria        | 22  | 22
--   caracteristicas_fisicas  | 31  | 31
--   equipamiento_confort     | 36  | 36
--   espacios_privados        | 73  | 73
--   oficinas_locales         | 25  | 25
--   politicas_condiciones    | 21  | 21
--   seguridad_estacionamiento| 28  | 28
--   servicios_edificio       | 24  | 24
--   servicios_infraestructura| 35  | 35
--   (old tipos con Hidromasaje desactivado) | 1 | 0
--   TOTAL                    | 354 | 353

COMMIT;
