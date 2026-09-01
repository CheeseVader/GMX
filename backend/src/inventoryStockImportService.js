import * as XLSX from 'xlsx';
import { pool, query } from './db.js';

const text=(v)=>String(v??'').trim();
const number=(v)=>{
  const n=Number(v??0);
  return Number.isFinite(n)?n:0;
};

function decodeWorkbook(file={}){
  const raw=String(file?.data||'').replace(/^data:[^;]+;base64,/,'');
  if(!raw)throw new Error('INVENTORY_IMPORT_FILE_REQUIRED');
  const buffer=Buffer.from(raw,'base64');
  if(!buffer.length)throw new Error('INVENTORY_IMPORT_FILE_EMPTY');
  if(buffer.length>15*1024*1024)throw new Error('INVENTORY_IMPORT_FILE_TOO_LARGE');
  return XLSX.read(buffer,{type:'buffer',cellDates:true});
}

function rowsFromWorkbook(wb){
  const preferred=['Inventario','INVENTARIO','Stock','STOCK'];
  const name=preferred.find(x=>wb.SheetNames.includes(x))||wb.SheetNames[0];
  if(!name)throw new Error('INVENTORY_IMPORT_SHEET_NOT_FOUND');
  return XLSX.utils.sheet_to_json(wb.Sheets[name],{defval:'',raw:false});
}

function value(row,...keys){
  const entries=Object.entries(row||{});
  for(const wanted of keys){
    const normalized=String(wanted).trim().toLowerCase();
    const hit=entries.find(([k])=>String(k).trim().toLowerCase()===normalized);
    if(hit)return hit[1];
  }
  return '';
}

async function resolveBranch(client,requestedId,scope){
  const requested=text(requestedId);

  if(requested){
    if(scope && !scope.all){
      const allowed=Array.isArray(scope.allowed)?scope.allowed.map(String):[];
      if(!allowed.includes(requested))throw new Error('BRANCH_FORBIDDEN');
    }

    const r=await client.query(`
      SELECT id_sucursal,nombre_sucursal
      FROM gmx.sucursales
      WHERE id_sucursal=$1::text AND COALESCE(activa,true)=true
      ORDER BY row_id
      LIMIT 1
    `,[requested]);

    if(!r.rowCount)throw new Error('BRANCH_NOT_FOUND');
    return r.rows[0];
  }

  let sql=`
    SELECT id_sucursal,nombre_sucursal
    FROM gmx.sucursales
    WHERE COALESCE(activa,true)=true
  `;
  const values=[];

  if(scope && !scope.all){
    const allowed=Array.isArray(scope.allowed)?scope.allowed.map(String):[];
    if(!allowed.length)throw new Error('BRANCH_REQUIRED');
    values.push(allowed);
    sql+=` AND id_sucursal=ANY($1::text[])`;
  }

  sql+=` ORDER BY row_id`;

  const r=await client.query(sql,values);
  if(r.rowCount===1)return r.rows[0];
  throw new Error('BRANCH_REQUIRED');
}

async function productBySku(client,sku){
  const r=await client.query(`
    SELECT row_id,id,sku,nombre,categoria,precio,costo,stock_minimo,estado
    FROM gmx.productos
    WHERE UPPER(TRIM(COALESCE(sku,'')))=UPPER(TRIM($1::text))
    ORDER BY row_id
    LIMIT 1
  `,[sku]);
  return r.rows[0]||null;
}

async function inventoryRow(client,branchId,productId){
  const r=await client.query(`
    SELECT *
    FROM gmx.inventario_sucursales
    WHERE id_sucursal=$1::text AND id_producto=$2::text
    ORDER BY row_id
    LIMIT 1
    FOR UPDATE
  `,[branchId,productId]);
  return r.rows[0]||null;
}

async function movement(client,{branch,product,qty,before,after,motive,reference,user}){
  const actorEmail=text(user?.email||user?.usuario);
  const actorName=text(user?.nombre||user?.name||actorEmail||'GMX Local');
  const actorId=text(user?.id_admin||user?.id);

  await client.query(`
    INSERT INTO gmx.movimientos_inventario_sucursales(
      id_movimiento,fecha,id_sucursal,sucursal,id_producto,sku,producto,
      tipo,cantidad,stock_anterior,stock_nuevo,motivo,
      id_admin,nombre_usuario,usuario,referencia
    )
    VALUES(
      'MOV-IMPORT-'||floor(extract(epoch from clock_timestamp())*1000)::text||'-'||substr(md5(random()::text),1,6),
      NOW(),$1,$2,$3,$4,$5,
      'ENTRADA_IMPORTACION',$6,$7,$8,$9,
      NULLIF($10,''),$11,NULLIF($12,''),NULLIF($13,'')
    )
  `,[
    branch.id_sucursal,branch.nombre_sucursal,
    product.id,product.sku,product.nombre,
    qty,before,after,motive,
    actorId,actorName,actorEmail,reference
  ]);
}

export async function importInventoryStockWorkbook(file,user={},scope=null){
  const wb=decodeWorkbook(file);
  const rows=rowsFromWorkbook(wb);

  if(!rows.length)throw new Error('INVENTORY_IMPORT_NO_ROWS');

  const result={
    rows:rows.length,
    processed:0,
    inventoryRowsCreated:0,
    inventoryRowsUpdated:0,
    unitsAdded:0,
    errors:[]
  };

  const client=await pool.connect();

  try{
    await client.query('BEGIN');

    for(let i=0;i<rows.length;i++){
      const row=rows[i];
      const line=i+2;
      const savepoint=`inventory_import_${i}`;

      await client.query(`SAVEPOINT ${savepoint}`);

      try{
        const sku=text(value(row,'sku','SKU','producto_sku','Producto / SKU'));
        const qty=Math.trunc(number(value(row,'cantidad','Cantidad','stock','Stock','unidades','Unidades')));
        const branchRequested=text(value(row,'id_sucursal','ID Sucursal','Sucursal ID','sucursal'));
        const minRaw=value(row,'stock_minimo','Stock minimo','Stock mínimo','minimo','Mínimo');
        const motive=text(value(row,'motivo','Motivo'))||'Importacion masiva de inventario';
        const reference=text(value(row,'referencia','Referencia'))||`EXCEL-FILA-${line}`;

        if(!sku)throw new Error('SKU_REQUIRED');
        if(!Number.isFinite(qty)||qty<=0)throw new Error('QUANTITY_MUST_BE_POSITIVE');

        const product=await productBySku(client,sku);
        if(!product)throw new Error('SKU_NOT_FOUND');

        const branch=await resolveBranch(client,branchRequested,scope);
        let inv=await inventoryRow(client,branch.id_sucursal,product.id);
        const before=Number(inv?.stock||0);
        const after=before+qty;
        const hasMin=text(minRaw)!=='';
        const min=hasMin?Math.max(0,Math.trunc(number(minRaw))):Number(inv?.stock_minimo??product.stock_minimo??0);

        if(inv){
          await client.query(`
            UPDATE gmx.inventario_sucursales
            SET stock=$1,stock_minimo=$2,sku=$3,producto=$4,sucursal=$5,fecha_actualizacion=NOW()
            WHERE row_id=$6
          `,[after,min,product.sku,product.nombre,branch.nombre_sucursal,inv.row_id]);
          result.inventoryRowsUpdated++;
        }else{
          await client.query(`
            INSERT INTO gmx.inventario_sucursales(
              id_registro,id_sucursal,sucursal,id_producto,sku,producto,
              stock,stock_minimo,fecha_actualizacion
            )
            VALUES(
              'INV-IMPORT-'||floor(extract(epoch from clock_timestamp())*1000)::text||'-'||substr(md5(random()::text),1,6),
              $1,$2,$3,$4,$5,$6,$7,NOW()
            )
          `,[branch.id_sucursal,branch.nombre_sucursal,product.id,product.sku,product.nombre,after,min]);
          result.inventoryRowsCreated++;
        }

        await movement(client,{
          branch,product,qty,before,after,motive,reference,user
        });

        result.processed++;
        result.unitsAdded+=qty;
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
      }catch(error){
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        result.errors.push({
          row:line,
          sku:text(value(row,'sku','SKU','producto_sku','Producto / SKU')),
          error:error.message
        });
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
      }
    }

    await client.query('COMMIT');
    return result;
  }catch(error){
    await client.query('ROLLBACK');
    throw error;
  }finally{
    client.release();
  }
}

export async function buildInventoryStockTemplate(){
  const branches=await query(`
    SELECT id_sucursal,nombre_sucursal
    FROM gmx.sucursales
    WHERE COALESCE(activa,true)=true
    ORDER BY nombre_sucursal,id_sucursal
  `);

  const products=await query(`
    SELECT sku,nombre,categoria,stock_minimo
    FROM gmx.productos
    WHERE COALESCE(estado,'Activo')<>'Inactivo'
    ORDER BY nombre,sku
    LIMIT 5000
  `);

  const wb=XLSX.utils.book_new();

  const inventoryRows=[
    ['id_sucursal','sku','cantidad','stock_minimo','motivo','referencia'],
    [
      branches.rows[0]?.id_sucursal||'SUC-000001',
      products.rows[0]?.sku||'SHINY-SKU-0001',
      10,
      products.rows[0]?.stock_minimo??0,
      'Recepcion masiva',
      'FAC-12345'
    ]
  ];

  const ws=XLSX.utils.aoa_to_sheet(inventoryRows);
  ws['!cols']=[
    {wch:20},{wch:28},{wch:12},{wch:15},{wch:34},{wch:24}
  ];
  XLSX.utils.book_append_sheet(wb,ws,'Inventario');

  const dbaRows=[
    ['Campo Excel','Destino DBA','Regla'],
    ['id_sucursal','gmx.inventario_sucursales.id_sucursal','Obligatorio cuando existe mas de una sucursal activa.'],
    ['sku','gmx.productos.sku / gmx.inventario_sucursales.sku','Debe existir en Catalogo de Productos.'],
    ['cantidad','gmx.inventario_sucursales.stock','SE SUMA al stock actual. Nunca reemplaza existencia.'],
    ['stock_minimo','gmx.inventario_sucursales.stock_minimo','Opcional. Si viene vacio conserva el minimo actual.'],
    ['motivo','gmx.movimientos_inventario_sucursales.motivo','Opcional.'],
    ['referencia','gmx.movimientos_inventario_sucursales.referencia','Opcional.'],
    ['SKU repetido','stock = stock actual + cantidad','Cada fila repetida suma unidades, incluso dentro del mismo archivo.'],
    ['SKU inexistente','Sin cambio','La fila se reporta como SKU_NOT_FOUND; no crea productos desde Inventario.']
  ];
  const wd=XLSX.utils.aoa_to_sheet(dbaRows);
  wd['!cols']=[{wch:22},{wch:48},{wch:72}];
  XLSX.utils.book_append_sheet(wb,wd,'Estructura_DBA');

  const branchRows=[['id_sucursal','nombre_sucursal'],...branches.rows.map(x=>[x.id_sucursal,x.nombre_sucursal])];
  const wbBranches=XLSX.utils.aoa_to_sheet(branchRows);
  wbBranches['!cols']=[{wch:22},{wch:36}];
  XLSX.utils.book_append_sheet(wb,wbBranches,'Sucursales');

  const productRows=[['sku','producto','categoria','stock_minimo'],...products.rows.map(x=>[x.sku,x.nombre,x.categoria,x.stock_minimo])];
  const wp=XLSX.utils.aoa_to_sheet(productRows);
  wp['!cols']=[{wch:30},{wch:44},{wch:28},{wch:15}];
  XLSX.utils.book_append_sheet(wb,wp,'Catalogo_SKU');

  return XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
}