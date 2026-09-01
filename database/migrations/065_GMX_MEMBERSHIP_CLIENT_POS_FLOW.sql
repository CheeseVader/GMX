BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE OR REPLACE FUNCTION gmx.activar_membresias_pedido() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d record;t record;start_at timestamptz;raw_token text;qty integer;
BEGIN
 IF NEW.estado_pago='PAGADO' AND (TG_OP='INSERT' OR COALESCE(OLD.estado_pago,'') IS DISTINCT FROM 'PAGADO') THEN
  FOR d IN SELECT sku,cantidad FROM gmx.detalle_pedidos WHERE id_pedido=NEW.id_pedido AND sku LIKE 'MEM-%' LOOP
   SELECT * INTO t FROM gmx.membresia_tipos WHERE sku=d.sku AND activo=true LIMIT 1;
   IF FOUND THEN
    IF NEW.id_cliente IS NULL OR BTRIM(NEW.id_cliente::text)='' THEN RAISE EXCEPTION 'MEMBERSHIP_CLIENT_REQUIRED'; END IF;
    qty:=GREATEST(1,COALESCE(d.cantidad,1)::integer); IF qty<>1 THEN RAISE EXCEPTION 'MEMBERSHIP_QUANTITY_ONE_REQUIRED'; END IF;
    IF EXISTS(SELECT 1 FROM gmx.cliente_membresias cm WHERE cm.id_pedido=NEW.id_pedido AND cm.id_tipo=t.id) THEN CONTINUE; END IF;
    SELECT COALESCE(MAX(cm.fin),NOW()) INTO start_at FROM gmx.cliente_membresias cm JOIN gmx.membresia_tipos mt2 ON mt2.id=cm.id_tipo WHERE cm.id_cliente=NEW.id_cliente AND mt2.id_juego=t.id_juego AND cm.estado IN('ACTIVA','PROGRAMADA') AND cm.fin>NOW();
    IF start_at<NOW() THEN start_at:=NOW(); END IF;
    raw_token:='GMX-'||UPPER(encode(gen_random_bytes(24),'hex'));
    INSERT INTO gmx.cliente_membresias(id_cliente,id_tipo,inicio,fin,estado,id_pedido,qr_token_hash,qr_codigo) VALUES(NEW.id_cliente,t.id,start_at,start_at+make_interval(days=>t.vigencia_dias),CASE WHEN start_at>NOW() THEN 'PROGRAMADA' ELSE 'ACTIVA' END,NEW.id_pedido,encode(digest(raw_token,'sha256'),'hex'),raw_token);
    INSERT INTO gmx.membresia_movimientos(id_membresia,tipo,cantidad,referencia,detalle,usuario) SELECT cm.id,'OTORGAMIENTO',COALESCE(t.entradas_incluidas,4),NEW.id_pedido,'Alta posterior a pago confirmado. SKU '||t.sku,'POS' FROM gmx.cliente_membresias cm WHERE cm.id_pedido=NEW.id_pedido AND cm.id_tipo=t.id ORDER BY cm.id DESC LIMIT 1;
   END IF;
  END LOOP;
 END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_gmx_activar_membresias ON gmx.pedidos;
CREATE TRIGGER trg_gmx_activar_membresias AFTER INSERT OR UPDATE OF estado_pago ON gmx.pedidos FOR EACH ROW EXECUTE FUNCTION gmx.activar_membresias_pedido();
INSERT INTO gmx.schema_migrations(version,description) SELECT '065','GMX alta cliente membresia via POS posterior a pago R5' WHERE NOT EXISTS(SELECT 1 FROM gmx.schema_migrations WHERE version='065');
COMMIT;
