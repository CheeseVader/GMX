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

console.log("=== CHECK ===");
console.log("PRODUCTO:",p.rowCount===1?"PASS":"FAIL");
console.log("INVENTARIO:",inv.rows.length===1 && Number(inv.rows[0].stock)===3?"PASS":"FAIL");
console.log("STOCK_INICIAL:",mov.rows.some(x=>x.tipo==="STOCK_INICIAL" && Number(x.cantidad)===3)?"PASS":"FAIL");
console.log("INTEGRIDAD:",p.rowCount===1 && inv.rows.length===1 && Number(inv.rows[0].stock)===Number(p.rows[0].stock)?"PASS":"FAIL");

if(p.rowCount!==1 || inv.rows.length!==1) process.exit(2);
