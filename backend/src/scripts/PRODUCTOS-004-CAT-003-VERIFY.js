import { query } from "../db.js";

const sku = "TEST-PRODUCTOS-004-CAT003";

const result = await query(`
SELECT
  p.id,
  p.sku,
  p.nombre,
  p.precio,
  p.costo,
  p.stock,
  p.stock_minimo,
  p.categoria,
  p.estado,
  p.codigo_barras
FROM gmx.productos p
WHERE p.sku=$1
ORDER BY p.row_id DESC
LIMIT 1
`, [sku]);

console.log("=== PRODUCTO ===");
console.table(result.rows);

if (!result.rowCount) {
  console.log("RESULTADO: PRODUCTO_NO_ENCONTRADO");
  process.exit(2);
}

const product = result.rows[0];

const inv = await query(`
SELECT
  i.row_id,
  i.id_sucursal,
  s.nombre_sucursal,
  i.id_producto,
  i.sku,
  i.producto,
  i.stock,
  i.stock_minimo
FROM gmx.inventario_sucursales i
LEFT JOIN gmx.sucursales s ON s.id_sucursal=i.id_sucursal
WHERE i.id_producto=$1
   OR i.sku=$2
ORDER BY i.row_id
`, [String(product.id), sku]);

console.log("=== INVENTARIO SUCURSAL ===");
console.table(inv.rows);

const mov = await query(`
SELECT
  row_id,
  id_movimiento,
  tipo,
  id_sucursal,
  id_producto,
  sku,
  producto,
  cantidad,
  stock_anterior,
  stock_nuevo,
  referencia,
  motivo
FROM gmx.movimientos_inventario_sucursales
WHERE sku=$1
ORDER BY row_id DESC
LIMIT 10
`, [sku]);

console.log("=== MOVIMIENTOS ===");
console.table(mov.rows);

const bad = await query(`
SELECT
  p.id,
  p.sku,
  p.stock,
  COALESCE(SUM(i.stock),0) AS stock_sucursales,
  p.stock-COALESCE(SUM(i.stock),0) AS diferencia
FROM gmx.productos p
LEFT JOIN gmx.inventario_sucursales i
  ON i.id_producto=CAST(p.id AS TEXT)
  OR i.sku=p.sku
WHERE p.sku=$1
GROUP BY p.id,p.sku,p.stock
HAVING p.stock<>COALESCE(SUM(i.stock),0)
`, [sku]);

console.log("=== INTEGRIDAD ===");
console.table(bad.rows);

const stockInitial = mov.rows.filter(x => x.tipo === "STOCK_INICIAL");

console.log("=== CHECK ===");
console.log("PRODUCTO:", result.rowCount === 1 ? "PASS" : "FAIL");
console.log("INVENTARIO_SUCURSAL:", inv.rows.length > 0 ? "PASS" : "FAIL");
console.log("STOCK_INICIAL:", stockInitial.length > 0 ? "PASS" : "FAIL");
console.log("INTEGRIDAD:", bad.rows.length === 0 ? "PASS" : "FAIL");

if (bad.rows.length !== 0 || inv.rows.length === 0 || stockInitial.length === 0) {
  process.exit(3);
}

process.exit(0);
