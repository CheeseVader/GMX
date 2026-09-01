BEGIN;
ALTER TABLE gmx.membresia_tipos ADD COLUMN IF NOT EXISTS imagen TEXT;
ALTER TABLE gmx.torneos ADD COLUMN IF NOT EXISTS imagen TEXT;

-- Repara productos de membresia creados parcialmente antes de R4.
UPDATE gmx.productos p
SET sku=mt.sku,
    nombre=mt.nombre,
    descripcion='Membresía GMX · '||mt.id_juego,
    precio=mt.precio,
    costo=0,
    stock=999999,
    stock_minimo=0,
    categoria='MEMBRESIA',
    imagen=mt.imagen,
    estado=CASE WHEN mt.activo THEN 'ACTIVO' ELSE 'INACTIVO' END,
    fecha_actualizacion=NOW()
FROM gmx.membresia_tipos mt
WHERE p.id='MEMBERSHIP-'||mt.id::text OR p.sku=mt.sku;

INSERT INTO gmx.productos(id,sku,nombre,descripcion,precio,costo,stock,stock_minimo,categoria,imagen,estado,fecha_creacion,fecha_actualizacion)
SELECT 'MEMBERSHIP-'||mt.id::text,mt.sku,mt.nombre,'Membresía GMX · '||mt.id_juego,mt.precio,0,999999,0,'MEMBRESIA',mt.imagen,CASE WHEN mt.activo THEN 'ACTIVO' ELSE 'INACTIVO' END,NOW(),NOW()
FROM gmx.membresia_tipos mt
WHERE NOT EXISTS (SELECT 1 FROM gmx.productos p WHERE p.id='MEMBERSHIP-'||mt.id::text OR p.sku=mt.sku);

INSERT INTO gmx.inventario_sucursales(id_registro,id_sucursal,sucursal,id_producto,sku,producto,stock,stock_minimo,fecha_actualizacion)
SELECT 'MEMINV-'||mt.id::text||'-'||s.id_sucursal, s.id_sucursal, COALESCE(s.nombre_sucursal,s.id_sucursal), 'MEMBERSHIP-'||mt.id::text, mt.sku, mt.nombre, 999999, 0, NOW()
FROM gmx.membresia_tipos mt
CROSS JOIN gmx.sucursales s
WHERE COALESCE(s.activa,true)=true
AND NOT EXISTS (
  SELECT 1 FROM gmx.inventario_sucursales i
  WHERE i.id_sucursal=s.id_sucursal AND i.id_producto='MEMBERSHIP-'||mt.id::text
);

INSERT INTO gmx.schema_migrations(version,description)
SELECT '064','GMX membresias torneos imagenes y correcciones R4'
WHERE NOT EXISTS(SELECT 1 FROM gmx.schema_migrations WHERE version='064');
COMMIT;
