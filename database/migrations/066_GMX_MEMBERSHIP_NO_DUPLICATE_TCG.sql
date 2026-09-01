BEGIN;

CREATE OR REPLACE FUNCTION gmx.activar_membresias_pedido()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  d record;
  t record;
  existing record;
  raw_token text;
  qty integer;
BEGIN
  IF NEW.estado_pago = 'PAGADO'
     AND (TG_OP = 'INSERT' OR COALESCE(OLD.estado_pago,'') IS DISTINCT FROM 'PAGADO') THEN

    FOR d IN
      SELECT sku, cantidad
      FROM gmx.detalle_pedidos
      WHERE id_pedido = NEW.id_pedido
        AND UPPER(COALESCE(sku,'')) LIKE 'MEM-%'
    LOOP
      SELECT *
        INTO t
      FROM gmx.membresia_tipos
      WHERE UPPER(sku) = UPPER(d.sku)
        AND activo = true
      LIMIT 1;

      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      IF NEW.id_cliente IS NULL OR BTRIM(NEW.id_cliente::text) = '' THEN
        RAISE EXCEPTION 'MEMBERSHIP_CLIENT_REQUIRED';
      END IF;

      qty := GREATEST(1, COALESCE(d.cantidad,1)::integer);
      IF qty <> 1 THEN
        RAISE EXCEPTION 'MEMBERSHIP_QUANTITY_ONE_REQUIRED';
      END IF;

      -- Idempotencia del mismo pedido.
      IF EXISTS (
        SELECT 1
        FROM gmx.cliente_membresias cm
        WHERE cm.id_pedido = NEW.id_pedido
          AND cm.id_tipo = t.id
      ) THEN
        CONTINUE;
      END IF;

      -- REGLA FINAL GMX:
      -- Un cliente no puede comprar otra membresia del mismo TCG
      -- mientras exista una ACTIVA o PROGRAMADA cuya vigencia no haya terminado.
      SELECT
        cm.id,
        cm.estado,
        cm.inicio,
        cm.fin,
        mt.nombre,
        mt.sku
      INTO existing
      FROM gmx.cliente_membresias cm
      JOIN gmx.membresia_tipos mt ON mt.id = cm.id_tipo
      WHERE cm.id_cliente = NEW.id_cliente
        AND mt.id_juego = t.id_juego
        AND UPPER(COALESCE(cm.estado,'')) IN ('ACTIVA','PROGRAMADA')
        AND cm.fin > NOW()
      ORDER BY cm.fin DESC
      LIMIT 1;

      IF FOUND THEN
        RAISE EXCEPTION 'MEMBERSHIP_TCG_ALREADY_ACTIVE';
      END IF;

      raw_token := 'GMX-' || UPPER(encode(gen_random_bytes(24),'hex'));

      INSERT INTO gmx.cliente_membresias(
        id_cliente,id_tipo,inicio,fin,estado,id_pedido,qr_token_hash,qr_codigo
      )
      VALUES(
        NEW.id_cliente,
        t.id,
        NOW(),
        NOW() + make_interval(days => t.vigencia_dias),
        'ACTIVA',
        NEW.id_pedido,
        encode(digest(raw_token,'sha256'),'hex'),
        raw_token
      );

      INSERT INTO gmx.membresia_movimientos(
        id_membresia,tipo,cantidad,referencia,detalle,usuario
      )
      SELECT
        cm.id,
        'OTORGAMIENTO',
        COALESCE(t.entradas_incluidas,4),
        NEW.id_pedido,
        'Alta automatica posterior a pago confirmado. SKU ' || t.sku,
        'POS'
      FROM gmx.cliente_membresias cm
      WHERE cm.id_pedido = NEW.id_pedido
        AND cm.id_tipo = t.id
      ORDER BY cm.id DESC
      LIMIT 1;
    END LOOP;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_gmx_activar_membresias ON gmx.pedidos;

CREATE TRIGGER trg_gmx_activar_membresias
AFTER INSERT OR UPDATE OF estado_pago ON gmx.pedidos
FOR EACH ROW
EXECUTE FUNCTION gmx.activar_membresias_pedido();

INSERT INTO gmx.schema_migrations(version,description)
SELECT '066','GMX bloqueo absoluto de membresia duplicada por TCG hasta vencimiento R5H'
WHERE NOT EXISTS(
  SELECT 1 FROM gmx.schema_migrations WHERE version='066'
);

COMMIT;
