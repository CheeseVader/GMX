BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION gmx.procesar_membresia_pagada(
  p_id_pedido text,
  p_sku text,
  p_cantidad integer
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  p record;
  t record;
  existing record;
  raw_token text;
  new_membership_id bigint;
  qty integer;
BEGIN
  IF p_sku IS NULL OR UPPER(BTRIM(p_sku)) NOT LIKE 'MEM-%' THEN
    RETURN;
  END IF;

  SELECT id_pedido,id_cliente,estado_pago
  INTO p
  FROM gmx.pedidos
  WHERE id_pedido=p_id_pedido
  LIMIT 1;

  IF NOT FOUND OR UPPER(COALESCE(p.estado_pago,'')) <> 'PAGADO' THEN
    RETURN;
  END IF;

  IF p.id_cliente IS NULL OR BTRIM(p.id_cliente::text)='' THEN
    RAISE EXCEPTION 'MEMBERSHIP_CLIENT_REQUIRED';
  END IF;

  qty := GREATEST(1,COALESCE(p_cantidad,1));
  IF qty <> 1 THEN
    RAISE EXCEPTION 'MEMBERSHIP_QUANTITY_ONE_REQUIRED';
  END IF;

  SELECT *
  INTO t
  FROM gmx.membresia_tipos
  WHERE UPPER(sku)=UPPER(BTRIM(p_sku))
    AND activo=true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBERSHIP_TYPE_NOT_FOUND';
  END IF;

  -- Idempotencia: si este mismo pedido ya genero esta membresia, no repetir.
  IF EXISTS(
    SELECT 1
    FROM gmx.cliente_membresias cm
    WHERE cm.id_pedido=p_id_pedido
      AND cm.id_tipo=t.id
  ) THEN
    RETURN;
  END IF;

  -- Regla definitiva:
  -- una sola membresia ACTIVA/PROGRAMADA por cliente + TCG hasta vencimiento.
  SELECT cm.id,cm.estado,cm.inicio,cm.fin,mt.nombre,mt.sku
  INTO existing
  FROM gmx.cliente_membresias cm
  JOIN gmx.membresia_tipos mt ON mt.id=cm.id_tipo
  WHERE cm.id_cliente=p.id_cliente
    AND mt.id_juego=t.id_juego
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
    p.id_cliente,
    t.id,
    NOW(),
    NOW()+make_interval(days=>t.vigencia_dias),
    'ACTIVA',
    p_id_pedido,
    encode(digest(raw_token,'sha256'),'hex'),
    raw_token
  )
  RETURNING id INTO new_membership_id;

  INSERT INTO gmx.membresia_movimientos(
    id_membresia,tipo,cantidad,referencia,detalle,usuario
  )
  VALUES(
    new_membership_id,
    'OTORGAMIENTO',
    COALESCE(t.entradas_incluidas,4),
    p_id_pedido,
    'Alta automatica posterior a pago confirmado. SKU '||t.sku,
    'POS'
  );
END
$$;

CREATE OR REPLACE FUNCTION gmx.trg_detalle_membresia_pagada()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF UPPER(COALESCE(NEW.sku,'')) LIKE 'MEM-%' THEN
    PERFORM gmx.procesar_membresia_pagada(
      NEW.id_pedido,
      NEW.sku,
      COALESCE(NEW.cantidad,1)::integer
    );
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_gmx_detalle_membresia_pagada ON gmx.detalle_pedidos;

CREATE TRIGGER trg_gmx_detalle_membresia_pagada
AFTER INSERT ON gmx.detalle_pedidos
FOR EACH ROW
EXECUTE FUNCTION gmx.trg_detalle_membresia_pagada();

CREATE OR REPLACE FUNCTION gmx.activar_membresias_pedido()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  d record;
BEGIN
  -- Este trigger queda para pedidos que NO nacen pagados y posteriormente
  -- cambian a PAGADO. En POS directo la activacion ocurre al insertar detalle.
  IF UPPER(COALESCE(NEW.estado_pago,''))='PAGADO'
     AND (TG_OP='UPDATE' AND UPPER(COALESCE(OLD.estado_pago,'')) IS DISTINCT FROM 'PAGADO') THEN
    FOR d IN
      SELECT sku,COALESCE(cantidad,1)::integer cantidad
      FROM gmx.detalle_pedidos
      WHERE id_pedido=NEW.id_pedido
        AND UPPER(COALESCE(sku,'')) LIKE 'MEM-%'
    LOOP
      PERFORM gmx.procesar_membresia_pagada(NEW.id_pedido,d.sku,d.cantidad);
    END LOOP;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_gmx_activar_membresias ON gmx.pedidos;

CREATE TRIGGER trg_gmx_activar_membresias
AFTER UPDATE OF estado_pago ON gmx.pedidos
FOR EACH ROW
EXECUTE FUNCTION gmx.activar_membresias_pedido();

INSERT INTO gmx.schema_migrations(version,description)
SELECT '067','GMX membresia POS activada al insertar detalle pagado y bloqueo duplicado transaccional R5I'
WHERE NOT EXISTS(
  SELECT 1 FROM gmx.schema_migrations WHERE version='067'
);

COMMIT;
