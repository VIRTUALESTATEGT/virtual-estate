-- 043_plantillas_compuestas.sql
-- Plantillas de imágenes compuestas + columnas en ordenes_contenido y contenido_generado
-- Ejecutar manualmente en Supabase SQL Editor

create table if not exists plantillas_compuestas (
  id          serial primary key,
  slug        text unique not null,
  nombre      text not null,
  descripcion text,
  paneles     jsonb not null default '[]',
  activa      boolean default true,
  created_at  timestamptz default now()
);

alter table ordenes_contenido
  add column if not exists plantilla_id integer references plantillas_compuestas(id);

alter table contenido_generado
  add column if not exists plantilla_id integer references plantillas_compuestas(id),
  add column if not exists paneles       jsonb;

insert into plantillas_compuestas (slug, nombre, descripcion, paneles) values
  ('comparativa-2col',
   'Comparativa 2 Columnas',
   'Antes/Después o comparación de dos opciones. La IA genera solo las fotos; Sharp+SVG renderiza todos los textos.',
   '[
     {"id":"izq","label":"Panel Izquierdo","campos":["titulo","subtitulo","precio","detalle"]},
     {"id":"der","label":"Panel Derecho",  "campos":["titulo","subtitulo","precio","detalle"]}
   ]'::jsonb)
on conflict (slug) do nothing;
