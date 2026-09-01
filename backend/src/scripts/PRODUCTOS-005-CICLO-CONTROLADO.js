import { query } from "../db.js";

const id="PROD-000014";
const sku="TEST-PRODUCTOS-004-CAT003";

const p=await query(`
SELECT row_id,id,sku,nombre,precio,costo,stock,stock_minimo,categoria,estado
FROM gmx.productos
WHERE id=$1 OR sku=$2
ORDER BY row_id DESC
LIMIT 1
`,[id,sku]);

console.log("=== PRODUCTO ===");
console.table(p.rows);

const inv=await query(`
SELECT row_id,id_sucursal,id_producto,sku,producto,stock,stock_minimo
FROM gmx.inventario_sucursales
WHERE id_producto=$1 OR sku=$2
ORDER BY row_id
`,[id,sku]);

console.log("=== INVENTARIO ===");
console.table(inv.rows);

const mov=await query(`
SELECT row_id,id_movimiento,tipo,id_sucursal,id_producto,sku,cantidad,
       stock_anterior,stock_nuevo,referencia,motivo
FROM gmx.movimientos_inventario_sucursales
WHERE id_producto=$1 OR sku=$2
ORDER BY row_id
`,[id,sku]);

console.log("=== MOVIMIENTOS ===");
console.table(mov.rows);

const fail=[];
if(p.rowCount!==1) fail.push("PRODUCT_NOT_FOUND");
if(inv.rows.length!==1) fail.push("INVENTORY_NOT_FOUND");

if(p.rowCount===1 && inv.rows.length===1 &&
   Number(p.rows[0].stock)!==Number(inv.rows[0].stock)){
  fail.push("GLOBAL_BRANCH_STOCK_MISMATCH");
}

console.log("=== CHECK ===");
console.log("PRODUCTO:",p.rowCount===1?"PASS":"FAIL");
console.log("INVENTARIO:",inv.rows.length===1?"PASS":"FAIL");
console.log("GLOBAL_VS_SUCURSAL:",!fail.includes("GLOBAL_BRANCH_STOCK_MISMATCH")?"PASS":"FAIL");
console.log("STOCK_ACTUAL:",p.rowCount===1?p.rows[0].stock:"N/A");

if(fail.length){
  console.log("FAILURES:",fail.join(","));
  process.exit(2);
}

console.log("PRODUCTOS-005 PRECHECK: PASS");
