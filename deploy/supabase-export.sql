-- Exporta TODOS los datos de Aurum desde Supabase a un archivo, solo con el navegador.
--
-- 1. Supabase → tu proyecto → SQL Editor → New query.
-- 2. Pega todo este archivo y pulsa «Run».
-- 3. En el resultado (una fila por tabla): «Export» → «Download CSV».
-- 4. Copia el CSV descargado a C:\Aurum\datos\ y sigue DEPLOY-CASA.md
--    («Traer los datos con un archivo»).
--
-- Solo LEE datos: no modifica nada en Supabase.

create or replace function pg_temp.aurum_export()
returns table (tabla text, datos text)
language plpgsql
as $$
declare
  r record;
begin
  for r in
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name
  loop
    tabla := r.table_name;
    execute format('select coalesce(json_agg(x), ''[]''::json)::text from public.%I x', r.table_name) into datos;
    return next;
  end loop;
end;
$$;

select * from pg_temp.aurum_export();
