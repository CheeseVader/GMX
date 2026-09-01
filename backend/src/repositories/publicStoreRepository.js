import { brandText } from "../config/brand.js";import crypto from 'node:crypto';
import fs from 'node:fs';
import { pool, query } from '../db.js';
import { storefrontRuntime, getCmsMediaMeta, resolveCmsMediaPath } from './cmsRepository.js';
import { promotionQuoteTx } from './benefitsRepository.js';
import { queueAndSendEmail, orderConfirmationHtml } from '../emailService.js';
import { createStripeSessionForOrder, ensureTransferTransaction, stripeConfigured, transferSettings } from '../paymentService.js';
import { identityOwners, resolveExistingClient } from './clientIdentityRepository.js';

const uid = (p) => `${p}-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
const n = (v) => Number(v || 0);
const i = (v) => Math.trunc(Number(v || 0));
const txt = (v) => String(v ?? '').trim();
const round = (v) => Number(Number(v || 0).toFixed(4));

export async function getPublicStorefront() {
  const runtime = await storefrontRuntime({ preview: false });
  const extra = await query(`SELECT parametro,valor FROM gmx.configuracion
    WHERE parametro LIKE 'public.store.%' OR parametro LIKE 'loyalty.%'`);
  return {
    ...runtime,
    settings: {
      ...(runtime.settings || {}),
      ...Object.fromEntries(extra.rows.map((x) => [x.parametro, x.valor]))
    }
  };
}

export async function listPublicBranches() {
  return query(`SELECT id_sucursal,nombre_sucursal,ciudad,estado,direccion
    FROM gmx.sucursales
    WHERE COALESCE(activa,true)=true
    ORDER BY nombre_sucursal,row_id`);
}

export async function listPublicBranchesForItems(items=[]){
  const normalized=Array.isArray(items)?items:[];
  if(!normalized.length)return [];

  const client=await pool.connect();
  try{
    const br=await client.query(`SELECT id_sucursal,nombre_sucursal,ciudad,estado,direccion
      FROM gmx.sucursales
      WHERE COALESCE(activa,true)=true
      ORDER BY nombre_sucursal,row_id`);

    const eligible=[];

    for(const branch of br.rows){
      let ok=true;

      for(const raw of normalized){
        const type=String(raw?.type||'PRODUCT').toUpperCase();
        const id=txt(raw?.id);
        const qty=Number(raw?.quantity);

        if(!id || !Number.isInteger(qty) || qty<=0){ok=false;break;}

        if(type==='PRODUCT'){
          const r=await client.query(`SELECT COALESCE(i.stock,0)::bigint AS available
            FROM gmx.inventario_sucursales i
            JOIN gmx.productos p ON p.id=i.id_producto
            WHERE i.id_producto=$1
              AND i.id_sucursal=$2
              AND UPPER(COALESCE(p.estado,'ACTIVO')) IN ('ACTIVO','ACTIVE')
            ORDER BY i.row_id LIMIT 1`,[id,branch.id_sucursal]);
          if(!r.rowCount || Number(r.rows[0].available||0)<qty){ok=false;break;}
        }else if(type==='TCG'){
          const r=await client.query(`SELECT
              GREATEST(0,COALESCE(s.stock,0)-COALESCE(s.stock_reservado,0))::bigint AS available
            FROM gmx.tcg_inventario i
            JOIN gmx.tcg_inventario_sucursales s
              ON s.id_inventario=i.id_inventario
             AND s.id_sucursal=$2
            WHERE i.id_inventario=$1
              AND UPPER(COALESCE(i.estado_venta,'DISPONIBLE'))='DISPONIBLE'
            ORDER BY s.row_id LIMIT 1`,[id,branch.id_sucursal]);
          if(!r.rowCount || Number(r.rows[0].available||0)<qty){ok=false;break;}
        }else{
          ok=false;break;
        }
      }

      if(ok)eligible.push(branch);
    }

    return eligible;
  }finally{
    client.release();
  }
}


export async function listPublicProducts({ search = '', category = '', limit = 24, offset = 0 } = {}) {
  const vals = [],f = [`UPPER(COALESCE(p.estado,'ACTIVO')) IN ('ACTIVO','ACTIVE')`, `COALESCE(p.precio,0)>0`];
  if (search) {
    vals.push(`%${search}%`);
    f.push(`(COALESCE(p.nombre,'') ILIKE $${vals.length} OR COALESCE(p.sku,'') ILIKE $${vals.length} OR COALESCE(p.categoria,'') ILIKE $${vals.length})`);
  }
  if (category) {
    vals.push(category);
    f.push(`p.categoria=$${vals.length}`);
  }
  vals.push(Math.min(Math.max(i(limit) || 24, 1), 100), Math.max(i(offset), 0));
  const li = vals.length - 1,oi = vals.length;
  return query(`
    SELECT p.row_id,p.id,p.sku,p.nombre,p.descripcion,p.precio,p.stock,p.categoria,p.imagen,p.estado,
      GREATEST(
        COALESCE(SUM(CASE WHEN COALESCE(s.activa,true)=true THEN GREATEST(0,COALESCE(inv.stock,0)) ELSE 0 END),0),
        COALESCE(p.stock,0)
      )::bigint AS stock_disponible
    FROM gmx.productos p
    LEFT JOIN gmx.inventario_sucursales inv ON inv.id_producto=p.id
    LEFT JOIN gmx.sucursales s ON s.id_sucursal=inv.id_sucursal
    WHERE ${f.join(' AND ')}
    GROUP BY p.row_id,p.stock
    ORDER BY p.nombre,p.row_id
    LIMIT $${li} OFFSET $${oi}
  `, vals);
}

export async function getPublicProduct(rowId) {
  const r = await query(`
    SELECT p.row_id,p.id,p.sku,p.nombre,p.descripcion,p.precio,p.categoria,p.imagen,p.estado,
      GREATEST(COALESCE(SUM(GREATEST(0,COALESCE(inv.stock,0))),0),COALESCE(p.stock,0))::bigint AS stock_disponible
    FROM gmx.productos p
    LEFT JOIN gmx.inventario_sucursales inv ON inv.id_producto=p.id
    WHERE p.row_id=$1 AND UPPER(COALESCE(p.estado,'ACTIVO')) IN ('ACTIVO','ACTIVE') AND COALESCE(p.precio,0)>0
    GROUP BY p.row_id,p.stock
  `, [rowId]);
  return r.rows[0] || null;
}

export async function listPublicCategories() {
  return query(`SELECT categoria,COUNT(*)::bigint total
    FROM gmx.productos
    WHERE UPPER(COALESCE(estado,'ACTIVO')) IN ('ACTIVO','ACTIVE')
      AND NULLIF(TRIM(COALESCE(categoria,'')),'') IS NOT NULL
    GROUP BY categoria ORDER BY categoria`);
}

export async function listPublicTcgGames() {
  return query(`
    SELECT id_juego,nombre,codigo,catalogo_codigo,imagen,descripcion,orden
    FROM (
      SELECT DISTINCT ON (
        UPPER(COALESCE(
          NULLIF(TRIM(catalogo_codigo),''),
          NULLIF(TRIM(codigo),''),
          NULLIF(TRIM(id_juego),'')
        ))
      ) j.*
      FROM gmx.tcg_juegos j
      WHERE COALESCE(activo,true)=true
        AND COALESCE(visible_portal,true)=true
        AND LOWER(TRIM(COALESCE(nombre,'')))<>'conosmon'
        AND LOWER(TRIM(COALESCE(codigo,'')))<>'conosmon'
      ORDER BY
        UPPER(COALESCE(
          NULLIF(TRIM(catalogo_codigo),''),
          NULLIF(TRIM(codigo),''),
          NULLIF(TRIM(id_juego),'')
        )),
        CASE WHEN NULLIF(TRIM(catalogo_codigo),'') IS NOT NULL THEN 0 ELSE 1 END,
        row_id
    ) q
    ORDER BY COALESCE(orden,999999),nombre
  `);
}

export async function listPublicTcg({ gameId = '', setId = '', search = '', limit = 36, offset = 0 } = {}) {
  const vals = [],f = [`UPPER(COALESCE(i.estado_venta,'DISPONIBLE'))='DISPONIBLE'`, `COALESCE(NULLIF(i.precio_oferta,0),i.precio,0)>0`];
  if (gameId) {vals.push(gameId);f.push(`c.id_juego=$${vals.length}`);}
  if (setId) {vals.push(setId);f.push(`c.id_set=$${vals.length}`);}
  if (search) {
    vals.push(`%${search}%`);
    f.push(`(COALESCE(c.nombre,'') ILIKE $${vals.length} OR COALESCE(i.sku,'') ILIKE $${vals.length} OR COALESCE(c.numero_completo,'') ILIKE $${vals.length})`);
  }
  vals.push(Math.min(Math.max(i(limit) || 36, 1), 100), Math.max(i(offset), 0));
  const li = vals.length - 1,oi = vals.length;
  return query(`
    SELECT i.row_id,i.id_inventario,i.id_carta,i.sku,i.idioma,i.condicion,i.acabado,i.edicion,
      i.graded,i.empresa_grading,i.grado,i.certificado,
      COALESCE(NULLIF(i.precio_oferta,0),i.precio) AS precio,
      i.precio AS precio_regular,
      c.nombre AS carta,c.numero_completo,c.rareza,c.imagen_principal,
      c.id_juego,c.id_set,j.nombre AS juego,s.nombre AS set_nombre,
      COALESCE(SUM(GREATEST(0,COALESCE(si.stock,0)-COALESCE(si.stock_reservado,0))),0)::bigint AS stock_disponible
    FROM gmx.tcg_inventario i
    JOIN gmx.tcg_cartas c ON c.id_carta=i.id_carta
    LEFT JOIN gmx.tcg_juegos j ON j.id_juego=c.id_juego
    LEFT JOIN gmx.tcg_sets s ON s.id_set=c.id_set
    LEFT JOIN gmx.tcg_inventario_sucursales si ON si.id_inventario=i.id_inventario
    WHERE ${f.join(' AND ')}
    GROUP BY i.row_id,c.row_id,j.nombre,s.nombre
    HAVING COALESCE(SUM(GREATEST(0,COALESCE(si.stock,0)-COALESCE(si.stock_reservado,0))),0)>0
    ORDER BY c.nombre,i.condicion,i.idioma,i.row_id
    LIMIT $${li} OFFSET $${oi}
  `, vals);
}

export async function publicUnifiedSearch({ q = '', limit = 24 } = {}) {
  const search = txt(q);
  if (!search) return { products: [], tcg: [] };
  const take = Math.min(Math.max(i(limit) || 24, 1), 50);
  const [products, tcg] = await Promise.all([
  listPublicProducts({ search, limit: take, offset: 0 }),
  listPublicTcg({ search, limit: take, offset: 0 })]
  );
  return { products: products.rows, tcg: tcg.rows };
}

export async function getPublicTcgItem(rowId) {
  const r = await query(`
    SELECT i.row_id,i.id_inventario,i.id_carta,i.sku,i.idioma,i.condicion,i.acabado,i.edicion,
      i.graded,i.empresa_grading,i.grado,i.certificado,
      COALESCE(NULLIF(i.precio_oferta,0),i.precio) AS precio,i.precio AS precio_regular,
      c.nombre AS carta,c.numero_completo,c.rareza,c.imagen_principal,c.descripcion,
      c.id_juego,c.id_set,j.nombre AS juego,s.nombre AS set_nombre,
      COALESCE(SUM(GREATEST(0,COALESCE(si.stock,0)-COALESCE(si.stock_reservado,0))),0)::bigint AS stock_disponible
    FROM gmx.tcg_inventario i
    JOIN gmx.tcg_cartas c ON c.id_carta=i.id_carta
    LEFT JOIN gmx.tcg_juegos j ON j.id_juego=c.id_juego
    LEFT JOIN gmx.tcg_sets s ON s.id_set=c.id_set
    LEFT JOIN gmx.tcg_inventario_sucursales si ON si.id_inventario=i.id_inventario
    WHERE i.row_id=$1
      AND UPPER(COALESCE(i.estado_venta,'DISPONIBLE'))='DISPONIBLE'
      AND COALESCE(NULLIF(i.precio_oferta,0),i.precio,0)>0
    GROUP BY i.row_id,c.row_id,j.nombre,s.nombre
    HAVING COALESCE(SUM(GREATEST(0,COALESCE(si.stock,0)-COALESCE(si.stock_reservado,0))),0)>0
  `, [Number(rowId)]);
  return r.rows[0] || null;
}

export async function publicBenefitQuote({ subtotal = 0, promoCode = '', branchId = '', items = [], clientUser = null }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let effectiveSubtotal = round(subtotal);
    let scopeSubtotals = null;

    if (branchId && Array.isArray(items) && items.length) {
      const prepared = await preparePublicItems(client, branchId, items);
      effectiveSubtotal = prepared.subtotal;
      scopeSubtotals = prepared.scopeSubtotals;
    }

    const result = await promotionQuoteTx(client, {
      code: promoCode,
      subtotal: effectiveSubtotal,
      channel: 'PUBLIC',
      branchId,
      clientId: clientUser?.id_cliente || '',
      scopeSubtotals
    });

    await client.query('ROLLBACK');
    return {
      subtotal: effectiveSubtotal,
      promotion: result.promotion ? {
        id: result.promotion.id,
        nombre: result.promotion.nombre,
        codigo: result.promotion.codigo,
        tipo: result.promotion.tipo,
        valor: result.promotion.valor,
        ambito: result.promotion.ambito
      } : null,
      discountPromo: result.discount,
      total: round(Math.max(0, effectiveSubtotal - n(result.discount)))
    };
  } catch (e) {
    try {await client.query('ROLLBACK');} catch {}
    throw e;
  } finally {client.release();}
}

async function findOrCreateCustomer(client, input) {
  const email = txt(input.email).toLowerCase();
  const phone = txt(input.phone);
  const name = txt(input.name);
  if (!name) throw new Error('CUSTOMER_NAME_REQUIRED');
  if (!email && !phone) throw new Error('CUSTOMER_CONTACT_REQUIRED');

  const owners = await identityOwners({ email, phone });
  const existingId = resolveExistingClient(owners);

  if (existingId) {
    const r = await client.query(`SELECT * FROM gmx.clientes WHERE id_cliente=$1 ORDER BY row_id LIMIT 1 FOR UPDATE`, [existingId]);
    if (!r.rowCount) throw new Error('CUSTOMER_IDENTITY_INCONSISTENT');

    const existing = r.rows[0];

    // Checkout invitado nunca cambia email/teléfono de un cliente ya identificado.
    // Solo utiliza el id_cliente existente para pedidos, promociones y fidelidad.
    return {
      ...existing,
      _identityMatched: true,
      _matchedBy: owners.emailOwner && owners.phoneOwner ? 'EMAIL_PHONE' : owners.emailOwner ? 'EMAIL' : 'PHONE'
    };
  }

  const id = `CLI-WEB-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const r = await client.query(`INSERT INTO gmx.clientes(
    id_cliente,nombre,telefono,email,direccion,ciudad,estado,cp,pais,fecha_registro,fecha_actualizacion)
    VALUES($1,$2,NULLIF($3,''),NULLIF($4,''),NULLIF($5,''),NULLIF($6,''),NULLIF($7,''),NULLIF($8,''),'México',NOW(),NOW())
    RETURNING *`, [
  id, name, phone, email, txt(input.address), txt(input.city), txt(input.state), txt(input.zip)]
  );
  return r.rows[0];
}

async function branchInfo(client, branchId) {
  const r = await client.query(`SELECT id_sucursal,nombre_sucursal FROM gmx.sucursales
    WHERE id_sucursal=$1 AND COALESCE(activa,true)=true ORDER BY row_id LIMIT 1`, [branchId]);
  return r.rows[0] || null;
}

async function preparePublicItems(client, branchId, items) {
  if (!Array.isArray(items) || !items.length) throw new Error('EMPTY_CART');
  const out = [];let subtotal = 0,productSubtotal = 0,tcgSubtotal = 0;
  for (const raw of items) {
    const type = String(raw.type || 'PRODUCT').toUpperCase();
    const rawQty = Number(raw.quantity);
    if (!Number.isFinite(rawQty) || !Number.isInteger(rawQty) || rawQty <= 0) {
      throw new Error('INVALID_QUANTITY');
    }
    const qty = rawQty;
    if (type === 'PRODUCT') {
      const r = await client.query(`SELECT p.id,p.sku,p.nombre,p.precio,p.estado,
          COALESCE(inv.stock,0) disponible,
          inv.id_registro,
          inv.row_id AS branch_inventory_row
        FROM gmx.productos p
        JOIN gmx.inventario_sucursales inv
          ON inv.id_producto=p.id
         AND inv.id_sucursal=$2
        WHERE p.id=$1
          AND UPPER(COALESCE(p.estado,'ACTIVO')) IN ('ACTIVO','ACTIVE')
        ORDER BY inv.row_id
        LIMIT 1`, [txt(raw.id), branchId]);
      if (!r.rowCount) throw new Error(`PRODUCT_NOT_AVAILABLE:${txt(raw.id)}`);
      const p = r.rows[0], available = n(p.disponible);
      if (available < qty) throw new Error(`INSUFFICIENT_STOCK:${p.id}`);
      const price = n(p.precio);
      if (!Number.isFinite(price) || price <= 0) throw new Error(`PRICE_NOT_CONFIGURED:${p.id}`);
      const line = round(price * qty); subtotal += line; productSubtotal += line;
      out.push({type:'PRODUCT',id:p.id,inventoryId:p.id_registro||null,branchInventoryRow:p.branch_inventory_row||null,sku:p.sku,name:p.nombre,quantity:qty,price,subtotal:line});
    } else if (type === 'TCG') {
      const r = await client.query(`SELECT i.id_inventario,i.sku,COALESCE(NULLIF(i.precio_oferta,0),i.precio) precio,
          c.nombre carta,c.numero_completo,c.rareza,
          COALESCE(si.stock,0)-COALESCE(si.stock_reservado,0) disponible
        FROM gmx.tcg_inventario i
        JOIN gmx.tcg_cartas c ON c.id_carta=i.id_carta
        LEFT JOIN gmx.tcg_inventario_sucursales si ON si.id_inventario=i.id_inventario AND si.id_sucursal=$2
        WHERE i.id_inventario=$1 AND UPPER(COALESCE(i.estado_venta,'DISPONIBLE'))='DISPONIBLE'
        ORDER BY si.row_id LIMIT 1`, [txt(raw.id), branchId]);
      if (!r.rowCount) throw new Error(`TCG_NOT_AVAILABLE:${txt(raw.id)}`);
      const p = r.rows[0],available = n(p.disponible);
      if (available < qty) throw new Error(`INSUFFICIENT_STOCK:${p.id_inventario}`);
      const price = n(p.precio);
      if (!Number.isFinite(price) || price <= 0) throw new Error(`PRICE_NOT_CONFIGURED:${p.id_inventario}`);
      const line = round(price * qty);subtotal += line;tcgSubtotal += line;
      out.push({ type: 'TCG', id: p.id_inventario, inventoryId: p.id_inventario, sku: p.sku, name: p.carta, quantity: qty, price, subtotal: line, detail: [p.numero_completo, p.rareza].filter(Boolean).join(' · ') });
    } else throw new Error('INVALID_ITEM_TYPE');
  }
  return { items: out, subtotal: round(subtotal), scopeSubtotals: { PRODUCTOS: round(productSubtotal), TCG: round(tcgSubtotal) } };
}


function normalizePublicPayment(method){
  const m=String(method||'').toUpperCase();
  if(['TRANSFER','CASH_STORE'].includes(m))return m;
  return 'TRANSFER';
}

function paymentStatus(method) {
  return method === 'CASH_STORE' ? 'PENDIENTE_EN_SUCURSAL' : 'PENDIENTE';
}
function normalizeFulfillment(value, payment) {
  if (payment === 'CASH_STORE') return 'PICKUP';
  return String(value || 'DELIVERY').toUpperCase() === 'PICKUP' ? 'PICKUP' : 'DELIVERY';
}

export async function createPublicOrder(input) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const branch = await branchInfo(client, txt(input.branchId));
    if (!branch) throw new Error('BRANCH_REQUIRED');

    let customer;
    if (input.clientUser?.id_cliente) {
      const known = await client.query(`SELECT * FROM gmx.clientes
        WHERE id_cliente=$1 ORDER BY row_id LIMIT 1 FOR UPDATE`, [input.clientUser.id_cliente]);
      if (!known.rowCount) throw new Error('CLIENT_ACCOUNT_CUSTOMER_NOT_FOUND');

      // El Portal Público consume el maestro de Clientes; nunca lo modifica.
      // La dirección usada en el pedido es una fotografía de la entrega,
      // proveniente de cliente_direcciones o de la captura del checkout.
      customer = known.rows[0];
    } else {
      customer = await findOrCreateCustomer(client, input.customer || {});
    }

    const prepared = await preparePublicItems(client, branch.id_sucursal, input.items);
    const promo = await promotionQuoteTx(client, {
      code: txt(input.promoCode),
      subtotal: prepared.subtotal,
      channel: 'PUBLIC',
      branchId: branch.id_sucursal,
      clientId: customer.id_cliente,
      scopeSubtotals: prepared.scopeSubtotals
    });
    const discount = round(promo.discount || 0);
    const shipping = 0;
    const total = round(Math.max(0, prepared.subtotal - discount + shipping));
    const orderId = uid('PED-WEB');
    const token = crypto.randomBytes(24).toString('hex');
    const receipt = `CB-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const payment = normalizePublicPayment(input.paymentMethod);
if (payment === 'TRANSFER') {
      const bankCheck = await transferSettings();
      if (!bankCheck.bank_name || !bankCheck.account_number && !bankCheck.clabe) throw new Error('TRANSFER_ACCOUNT_NOT_CONFIGURED');
    }
    const fulfillment = normalizeFulfillment(input.fulfillmentMethod, payment);
    if (fulfillment === 'DELIVERY' && !txt(input.customer?.address) && !txt(customer.direccion)) throw new Error('DELIVERY_ADDRESS_REQUIRED');
    const accountId = txt(input.clientUser?.id_cuenta) || null;

    const cfg = await client.query(`SELECT valor FROM gmx.configuracion WHERE parametro='public.store.order_expiration_hours'`);
    const hours = Math.max(1, i(cfg.rows[0]?.valor || 48));

    const ins = await client.query(`INSERT INTO gmx.pedidos(
      id_pedido,fecha,id_cliente,nombre_cliente,telefono,email,direccion,ciudad,estado,cp,
      metodo_pago,subtotal,envio,total,estado_pedido,notas,fecha_actualizacion,
      inventario_liberado,id_admin_venta,vendedor,id_sucursal,sucursal,canal_venta,venta_confirmada,
      id_promocion,codigo_promocional,descuento_promocion,puntos_redimidos,descuento_puntos,puntos_generados,total_antes_beneficios,
      public_token,public_expires_at,origen_publico,numero_comprobante,metodo_pago_publico,estado_pago,id_cuenta_cliente,tipo_entrega)
      VALUES($1,NOW(),$2,$3,$4,$5,$6,$7,$8,$9,
        $10,$11,$12,$13,'PENDIENTE',$14,NOW(),
        false,'PUBLIC','Portal público',$15,$16,'WEB_PUBLIC',false,
        $17,$18,$19,0,0,0,$11,
        $20,NOW()+($21||' hours')::interval,'PORTAL_REACT',$22,$23,$24,$25,$26)
      RETURNING row_id,id_pedido,public_token,public_expires_at,numero_comprobante,metodo_pago_publico,estado_pago`, [
    orderId, customer.id_cliente, customer.nombre, customer.telefono, customer.email,
    txt(input.customer?.address), txt(input.customer?.city), txt(input.customer?.state), txt(input.customer?.zip),
    payment, prepared.subtotal, shipping, total,
    txt(input.notes) || 'Pedido generado desde Portal Público',
    branch.id_sucursal, branch.nombre_sucursal,
    promo.promotion?.id || null, promo.promotion?.codigo || null, discount,
    token, String(hours), receipt, payment, paymentStatus(payment), accountId, fulfillment]
    );

    // GMX_WEB_PRODUCT_RESERVATION_R17
    // Producto normal: el stock de sucursal se decrementa al crear
    // el pedido WEB. Esto funciona como apartado y evita sobreventa.
    // La cancelaciÃ³n/rechazo lo devuelve; la aprobaciÃ³n no lo vuelve
    // a descontar.
    for(const x of prepared.items){
      if(x.type!=='PRODUCT')continue;

      const productId=String(x.id||'');
      const qty=Number(x.quantity||0);
      if(!productId || !Number.isInteger(qty) || qty<=0){
        throw new Error(`INVALID_PRODUCT_RESERVATION:${productId||'UNKNOWN'}`);
      }

      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
        [`PRODUCT:${branch.id_sucursal}:${productId}`]
      );

      const lock=await client.query(`
        SELECT i.row_id,COALESCE(i.stock,0)::bigint AS stock
        FROM gmx.inventario_sucursales i
        WHERE i.id_producto=$1 AND i.id_sucursal=$2
        ORDER BY i.row_id LIMIT 1
        FOR UPDATE
      `,[productId,branch.id_sucursal]);

      if(!lock.rowCount){
        throw new Error(`INVENTORY_NOT_FOUND:${productId}`);
      }

      const before=Number(lock.rows[0].stock||0);
      if(before<qty)throw new Error(`INSUFFICIENT_STOCK:${productId}`);
      const after=before-qty;

      await client.query(`
        UPDATE gmx.inventario_sucursales
        SET stock=$2,fecha_actualizacion=NOW()
        WHERE row_id=$1
      `,[lock.rows[0].row_id,after]);

      await client.query(`
        INSERT INTO gmx.auditoria(fecha,modulo,accion,referencia,detalle,usuario)
        VALUES(NOW(),'INVENTARIO','RESERVAR_STOCK_PRODUCTO_WEB',$1,$2,'PUBLIC')
      `,[
        orderId,
        `producto=${productId}; sucursal=${branch.id_sucursal}; cantidad=${qty}; stock=${before}->${after}`
      ]);
    }

    // ========================================================
    // TCG-005F-A — RESERVA TRANSACCIONAL DE STOCK TCG
    // Pedido WEB pendiente: stock físico NO cambia.
    // stock_reservado aumenta en global y sucursal.
    // ========================================================
    for (const x of prepared.items) {
      if (x.type !== 'TCG') continue;

      const inventoryId = x.inventoryId || x.id;
      const qty = Number(x.quantity || 0);

      if (!inventoryId || !Number.isInteger(qty) || qty <= 0) {
        throw new Error(`INVALID_TCG_RESERVATION:${inventoryId || 'UNKNOWN'}`);
      }

      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
        [`TCG:${branch.id_sucursal}:${inventoryId}`]
      );

      const lock = await client.query(`
        SELECT
          g.row_id AS global_row_id,
          g.id_inventario,
          COALESCE(g.stock,0)::bigint AS global_stock,
          COALESCE(g.stock_reservado,0)::bigint AS global_reserved,
          s.row_id AS branch_row_id,
          s.id_sucursal,
          COALESCE(s.stock,0)::bigint AS branch_stock,
          COALESCE(s.stock_reservado,0)::bigint AS branch_reserved
        FROM gmx.tcg_inventario g
        JOIN gmx.tcg_inventario_sucursales s
          ON s.id_inventario=g.id_inventario
         AND s.id_sucursal=$2
        WHERE g.id_inventario=$1
        ORDER BY s.row_id
        LIMIT 1
        FOR UPDATE OF g,s
      `, [inventoryId, branch.id_sucursal]);

      if (!lock.rowCount) {
        throw new Error(`TCG_INVENTORY_NOT_FOUND:${inventoryId}`);
      }

      const inv = lock.rows[0];

      const globalStock = Number(inv.global_stock || 0);
      const globalReserved = Number(inv.global_reserved || 0);
      const branchStock = Number(inv.branch_stock || 0);
      const branchReserved = Number(inv.branch_reserved || 0);

      const globalAvailable = globalStock - globalReserved;
      const branchAvailable = branchStock - branchReserved;

      if (globalAvailable < qty) {
        throw new Error(`INSUFFICIENT_TCG_GLOBAL_STOCK:${inventoryId}`);
      }

      if (branchAvailable < qty) {
        throw new Error(`INSUFFICIENT_TCG_STOCK:${inventoryId}`);
      }

      const globalReservedNew = globalReserved + qty;
      const branchReservedNew = branchReserved + qty;

      await client.query(`
        UPDATE gmx.tcg_inventario_sucursales
        SET
          stock_reservado=$1,
          ultima_actualizacion=NOW()
        WHERE row_id=$2
      `, [branchReservedNew, inv.branch_row_id]);

      await client.query(`
        UPDATE gmx.tcg_inventario
        SET
          stock_reservado=$1,
          ultima_actualizacion=NOW()
        WHERE row_id=$2
      `, [globalReservedNew, inv.global_row_id]);

      await client.query(`
        INSERT INTO gmx.auditoria(
          fecha,
          modulo,
          accion,
          referencia,
          detalle,
          usuario
        )
        VALUES(
          NOW(),
          'TCG',
          'RESERVAR_STOCK',
          $1,
          $2,
          'PUBLIC'
        )
      `, [
      orderId,
      `inventario=${inventoryId}; sucursal=${branch.id_sucursal}; cantidad=${qty}; reservado_sucursal=${branchReservedNew}; reservado_global=${globalReservedNew}`]
      );
    }

    let line = 0;
    for (const x of prepared.items) {
      line++;
      await client.query(`INSERT INTO gmx.detalle_pedidos(
        id_pedido,id_producto,producto,cantidad,precio,subtotal,id_detalle,sku,precio_unitario,tipo,id_inventario,detalle)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$5,$9,$10,$11)`, [
      orderId, x.type === 'PRODUCT' ? x.id : null, x.name, x.quantity, x.price, x.subtotal,
      `${orderId}-${line}`, x.sku, x.type, x.inventoryId, x.detail || null]
      );
    }

    await client.query(`INSERT INTO gmx.auditoria(fecha,modulo,accion,referencia,detalle,usuario)
      VALUES(NOW(),'PORTAL_PUBLICO','CREAR_PEDIDO',$1,$2,'PUBLIC')`, [
    orderId, `Total ${total} · ${customer.email || customer.telefono || customer.nombre}`]
    );
    await client.query('COMMIT');

    const baseUrl = String(process.env.SHINY_PUBLIC_BASE_URL || input.baseUrl || 'http://127.0.0.1:5173').replace(/\/$/, '');
    const receiptUrl = `${baseUrl}/tienda/comprobante/${ins.rows[0].public_token}`;
    const orderForPayment = {
      id_pedido: ins.rows[0].id_pedido,
      public_token: ins.rows[0].public_token,
      numero_comprobante: ins.rows[0].numero_comprobante,
      nombre_cliente: customer.nombre,
      email: customer.email,
      total,
      estado_pedido: 'PENDIENTE',
      metodo_pago_publico: payment
    };

    let email = { queued: false, sent: false, reason: 'DEFERRED' };
    let paymentUrl = null;
    let paymentProvider = null;
    let transfer = null;

    if (payment === 'CARD') {
      const stripe = await createStripeSessionForOrder(orderForPayment, ins.rows[0].public_token, baseUrl);
      paymentUrl = stripe.url;
      paymentProvider = stripe.provider;
    } else if (payment === 'TRANSFER') {
      transfer = await ensureTransferTransaction(orderForPayment, ins.rows[0].public_token, baseUrl);
      paymentProvider = 'MANUAL_BANK';
    } else if (String(process.env.SHINY_EMAIL_CONFIRMATION_ENABLED || 'true').toLowerCase() !== 'false' && customer.email) {
      email = await queueAndSendEmail({
        to: customer.email,
        subject: brandText(`Shiny · Pedido ${ins.rows[0].id_pedido}`),
        html: orderConfirmationHtml({
          order: { ...orderForPayment, metodo_pago_publico: 'Pago en sucursal' },
          receiptUrl
        }),
        reference: ins.rows[0].id_pedido
      });
      await query(`UPDATE gmx.pedidos SET email_confirmacion_estado=$2 WHERE id_pedido=$1`, [
      ins.rows[0].id_pedido, email.sent ? 'SENT' : email.queued ? 'QUEUED' : 'NOT_SENT']
      );
    }

    return {
      id_pedido: ins.rows[0].id_pedido,
      public_token: ins.rows[0].public_token,
      numero_comprobante: ins.rows[0].numero_comprobante,
      expires_at: ins.rows[0].public_expires_at,
      subtotal: prepared.subtotal,
      discountPromo: discount,
      total,
      status: 'PENDIENTE',
      paymentMethod: payment,
      paymentStatus: paymentStatus(payment),
      paymentProvider,
      paymentUrl,
      transfer,
      fulfillmentMethod: fulfillment,
      receiptUrl,
      email
    };
  } catch (e) {
    try {await client.query('ROLLBACK');} catch {}
    throw e;
  } finally {client.release();}
}

export async function getPublicOrder(token) {
  const h = await query(`SELECT row_id,id_pedido,fecha,nombre_cliente,email,telefono,subtotal,envio,total,
      estado_pedido,estado_pago,metodo_pago_publico,numero_comprobante,email_confirmacion_estado,
      codigo_promocional,descuento_promocion,id_sucursal,sucursal,public_expires_at,tipo_entrega,
      payment_provider,payment_provider_session,payment_confirmed_at,transfer_proof_status
    FROM gmx.pedidos WHERE public_token=$1 ORDER BY row_id LIMIT 1`, [token]);
  if (!h.rowCount) return null;
  const order = h.rows[0];
  const d = await query(`SELECT producto,cantidad,precio_unitario,subtotal,sku,tipo,detalle
    FROM gmx.detalle_pedidos WHERE id_pedido=$1 ORDER BY row_id`, [order.id_pedido]);
  return { ...order, detalles: d.rows };
}

export async function getPublicMedia(id) {
  const meta = await getCmsMediaMeta(id);
  if (!meta) return null;
  const filepath = resolveCmsMediaPath(meta);
  if (!filepath || !fs.existsSync(filepath)) return null;
  return { meta, filepath };
}
