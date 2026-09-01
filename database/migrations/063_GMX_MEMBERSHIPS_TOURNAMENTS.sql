BEGIN;
CREATE TABLE IF NOT EXISTS gmx.membresia_tipos(
 id bigserial PRIMARY KEY, codigo text UNIQUE NOT NULL, nombre text NOT NULL, id_juego text NOT NULL,
 precio numeric(18,4) NOT NULL DEFAULT 0, vigencia_dias int NOT NULL DEFAULT 30,
 descuento_pct numeric(8,4) NOT NULL DEFAULT 0, entradas_incluidas int NOT NULL DEFAULT 4,
 limite_semanal int NOT NULL DEFAULT 1, activo boolean NOT NULL DEFAULT true,
 sku text UNIQUE NOT NULL, notas_publicas text, creado_at timestamptz NOT NULL DEFAULT now(), actualizado_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS gmx.cliente_membresias(
 id bigserial PRIMARY KEY, id_cliente text NOT NULL, id_tipo bigint NOT NULL REFERENCES gmx.membresia_tipos(id),
 inicio timestamptz NOT NULL, fin timestamptz NOT NULL, estado text NOT NULL DEFAULT 'ACTIVA',
 id_pedido text, qr_token_hash text UNIQUE NOT NULL, qr_codigo text UNIQUE NOT NULL,
 creado_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id_cliente,id_tipo,inicio));
CREATE INDEX IF NOT EXISTS ix_cliente_membresias_cliente ON gmx.cliente_membresias(id_cliente,estado,fin);
CREATE TABLE IF NOT EXISTS gmx.membresia_movimientos(
 id bigserial PRIMARY KEY,id_membresia bigint NOT NULL REFERENCES gmx.cliente_membresias(id),fecha timestamptz NOT NULL DEFAULT now(),
 tipo text NOT NULL,cantidad int NOT NULL DEFAULT 0,id_torneo bigint,referencia text,detalle text,usuario text);
CREATE TABLE IF NOT EXISTS gmx.torneos(
 id bigserial PRIMARY KEY,nombre text NOT NULL,id_juego text NOT NULL,categoria text NOT NULL DEFAULT 'LOCAL',
 fecha_inicio timestamptz NOT NULL,id_sucursal text,costo numeric(18,4) NOT NULL DEFAULT 0,cupo int,
 acepta_membresia boolean NOT NULL DEFAULT false,estado text NOT NULL DEFAULT 'PROGRAMADO',descripcion text,
 creado_at timestamptz NOT NULL DEFAULT now(),actualizado_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS gmx.torneo_membresias_aceptadas(id_torneo bigint REFERENCES gmx.torneos(id) ON DELETE CASCADE,id_tipo bigint REFERENCES gmx.membresia_tipos(id) ON DELETE CASCADE,PRIMARY KEY(id_torneo,id_tipo));
CREATE TABLE IF NOT EXISTS gmx.torneo_inscripciones(id bigserial PRIMARY KEY,id_torneo bigint REFERENCES gmx.torneos(id),id_cliente text NOT NULL,id_membresia bigint REFERENCES gmx.cliente_membresias(id),tipo_pago text NOT NULL DEFAULT 'MEMBRESIA',estado text NOT NULL DEFAULT 'CONFIRMADA',creado_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS ux_torneo_cliente_confirmado ON gmx.torneo_inscripciones(id_torneo,id_cliente) WHERE estado='CONFIRMADA';
CREATE TABLE IF NOT EXISTS gmx.producto_tcg_membresia(id_producto text PRIMARY KEY,id_juego text NOT NULL,actualizado_at timestamptz NOT NULL DEFAULT now());
-- Activa automáticamente membresías vendidas como SKU MEM-* cuando el pedido pasa a PAGADO.
CREATE OR REPLACE FUNCTION gmx.activar_membresias_pedido() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d record; t record; start_at timestamptz; code text;
BEGIN
 IF NEW.estado_pago='PAGADO' AND COALESCE(OLD.estado_pago,'') IS DISTINCT FROM 'PAGADO' THEN
  FOR d IN SELECT sku,cantidad FROM gmx.detalle_pedidos WHERE id_pedido=NEW.id_pedido AND sku LIKE 'MEM-%' LOOP
   SELECT * INTO t FROM gmx.membresia_tipos WHERE sku=d.sku AND activo=true LIMIT 1;
   IF FOUND AND NEW.id_cliente IS NOT NULL THEN
    FOR i IN 1..GREATEST(1,d.cantidad::int) LOOP
      SELECT COALESCE(MAX(fin),now()) INTO start_at FROM gmx.cliente_membresias cm WHERE cm.id_cliente=NEW.id_cliente AND cm.id_tipo=t.id AND cm.estado IN('ACTIVA','PROGRAMADA') AND cm.fin>now();
      IF start_at<now() THEN start_at:=now(); END IF;
      code:='GMX-'||upper(substr(md5(random()::text||clock_timestamp()::text),1,12));
      INSERT INTO gmx.cliente_membresias(id_cliente,id_tipo,inicio,fin,estado,id_pedido,qr_token_hash,qr_codigo)
      VALUES(NEW.id_cliente,t.id,start_at,start_at+make_interval(days=>t.vigencia_dias),CASE WHEN start_at>now() THEN 'PROGRAMADA' ELSE 'ACTIVA' END,NEW.id_pedido,encode(digest(code,'sha256'),'hex'),code);
    END LOOP;
   END IF;
  END LOOP;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_gmx_activar_membresias ON gmx.pedidos;
CREATE TRIGGER trg_gmx_activar_membresias AFTER UPDATE OF estado_pago ON gmx.pedidos FOR EACH ROW EXECUTE FUNCTION gmx.activar_membresias_pedido();
INSERT INTO gmx.schema_migrations(version,description) SELECT '063','GMX Membresias + Torneos R1' WHERE NOT EXISTS(SELECT 1 FROM gmx.schema_migrations WHERE version='063');
COMMIT;