-- GMX MEMBERSHIP DIGITAL CARD R1
BEGIN;

ALTER TABLE gmx.cliente_membresias
  ADD COLUMN IF NOT EXISTS codigo_membresia text;

UPDATE gmx.cliente_membresias
SET codigo_membresia = 'GMX-M-' || LPAD(id::text, 8, '0')
WHERE NULLIF(BTRIM(COALESCE(codigo_membresia,'')),'') IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_cliente_membresias_codigo_membresia
ON gmx.cliente_membresias (UPPER(codigo_membresia))
WHERE codigo_membresia IS NOT NULL;

CREATE OR REPLACE FUNCTION gmx.asignar_codigo_membresia()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NULLIF(BTRIM(COALESCE(NEW.codigo_membresia,'')),'') IS NULL THEN
    NEW.codigo_membresia := 'GMX-M-' || LPAD(NEW.id::text, 8, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gmx_codigo_membresia ON gmx.cliente_membresias;
CREATE TRIGGER trg_gmx_codigo_membresia
BEFORE INSERT ON gmx.cliente_membresias
FOR EACH ROW
EXECUTE FUNCTION gmx.asignar_codigo_membresia();

INSERT INTO gmx.schema_migrations(version,description)
SELECT '068','GMX credencial digital membresia QR + CODE128 R1'
WHERE NOT EXISTS(
  SELECT 1 FROM gmx.schema_migrations WHERE version='068'
);

COMMIT;
