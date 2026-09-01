import { brandText } from "../config/brand.js";import { pool, query } from '../db.js';

const n = (v) => Number(v || 0);
const round4 = (v) => Number(n(v).toFixed(4));

export async function listSuppliers(search = '') {
  const values = [];let where = `WHERE COALESCE(activo,true)=true`;
  if (search) {values.push(`%${search}%`);where += ` AND (
    COALESCE(nombre_comercial,'') ILIKE $1 OR COALESCE(razon_social,'') ILIKE $1
    OR COALESCE(rfc,'') ILIKE $1 OR COALESCE(id_proveedor,'') ILIKE $1
  )`;}
  return query(`
    SELECT row_id,id_proveedor,razon_social,nombre_comercial,rfc,contacto,
           telefono,email,terminos_pago,dias_credito,moneda,activo
    FROM gmx.proveedores ${where}
    ORDER BY COALESCE(NULLIF(nombre_comercial,''),razon_social,id_proveedor)
    LIMIT 100
  `, values);
}

export async function listPurchases({ search = '', status = '', fiscalStatus = '', limit = 200 } = {}) {
  const values = [];const filters = [];
  if (search) {values.push(`%${search}%`);filters.push(`(
    COALESCE(c.id_compra,'') ILIKE $${values.length} OR COALESCE(c.proveedor,'') ILIKE $${values.length}
    OR COALESCE(c.referencia_documento,'') ILIKE $${values.length} OR COALESCE(c.uuid_cfdi,'') ILIKE $${values.length}
  )`);}
  if (status) {values.push(status);filters.push(`c.estado=$${values.length}`);}
  if (fiscalStatus) {values.push(fiscalStatus);filters.push(`c.estatus_fiscal=$${values.length}`);}
  values.push(Math.min(Math.max(Number(limit) || 200, 1), 500));
  return query(`SELECT
      c.row_id,c.id_compra,c.fecha,c.id_proveedor,c.proveedor,c.moneda,c.terminos_pago,c.dias_credito,
      c.fecha_esperada,c.tipo_documento,c.referencia_documento,c.estado,c.lineas,
      c.unidades_solicitadas,c.unidades_recibidas,c.subtotal,c.impuestos,c.total,c.notas,
      c.id_admin,c.administrador,c.fecha_actualizacion,c.fecha_envio,c.fecha_cierre,c.motivo_cancelacion,
      c.id_sucursal_recepcion,c.sucursal_recepcion,c.estatus_fiscal,c.uuid_cfdi,c.fecha_documento,
      c.subtotal_documento,c.descuentos,c.iva,c.ieps,c.retenciones,c.otros_cargos,c.total_documento,
      c.diferencia_documento,c.metodo_pago,c.documento_nombre,c.documento_mime,c.xml_nombre
    FROM gmx.compras c ${filters.length ? 'WHERE ' + filters.join(' AND ') : ''}
    ORDER BY c.fecha DESC NULLS LAST,c.row_id DESC LIMIT $${values.length}`, values);
}

export async function getPurchase(rowId) {
  const h = await query(`SELECT * FROM gmx.compras WHERE row_id=$1`, [rowId]);
  if (!h.rowCount) return null;
  const d = await query(`SELECT * FROM gmx.compras_detalle WHERE id_compra=$1 ORDER BY linea,row_id`, [h.rows[0].id_compra]);
  return { ...h.rows[0], detalles: d.rows };
}

async function ensureProduct(client, raw) {
  const productId = String(raw.productId || '').trim();
  if (productId) {
    const r = await client.query(`SELECT id,sku,nombre,costo FROM gmx.productos WHERE id=$1 ORDER BY row_id LIMIT 1`, [productId]);
    if (!r.rowCount) throw new Error(`PRODUCT_NOT_FOUND:${productId}`);
    return { ...r.rows[0], isNew: false };
  }
  const x = raw.newProduct || {};
  const name = String(x.name || '').trim(),sku = String(x.sku || '').trim(),barcode = String(x.barcode || '').trim();
  if (!name) throw new Error('NEW_PRODUCT_NAME_REQUIRED');
  const r = await client.query(`
    INSERT INTO gmx.productos(sku,codigo_barras,nombre,descripcion,precio,costo,stock,stock_minimo,categoria,estado,fecha_creacion,fecha_actualizacion)
    VALUES(NULLIF($1,''),NULLIF($2,''),$3,NULLIF($4,''),$5,$6,0,$7,NULLIF($8,''),'Activo',NOW(),NOW())
    RETURNING id,sku,nombre,costo
  `, [sku, barcode, name, String(x.description || ''), n(x.price), n(raw.unitCost), n(x.minimumStock), String(x.category || '')]);
  return { ...r.rows[0], isNew: true };
}

export async function createPurchase(input = {}, actor = {}) {
  const supplierId = String(input.supplierId || '').trim();
  const branchId = String(input.branchId || '').trim();
  const items = Array.isArray(input.items) ? input.items : [];
  if (!supplierId) throw new Error('SUPPLIER_REQUIRED');
  if (!branchId) throw new Error('BRANCH_REQUIRED');
  if (!items.length) throw new Error('EMPTY_PURCHASE');

  let fiscal = String(input.fiscalStatus || 'SIN_COMPROBANTE').toUpperCase();
  if (!['FACTURADA', 'PENDIENTE_FACTURA', 'NO_FACTURADA', 'SIN_COMPROBANTE'].includes(fiscal)) throw new Error('INVALID_FISCAL_STATUS');

  const xmlText = String(input.xmlText || '').trim();
  const documentBase64 = String(input.documentBase64 || '').trim();
  const parsedCfdi = parseCfdiXml(xmlText);
  if (parsedCfdi?.stamped) fiscal = 'FACTURADA';
  if (fiscal === 'FACTURADA' && !xmlText && !documentBase64) throw new Error('FISCAL_DOCUMENT_REQUIRED');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const supplier = await client.query(`SELECT * FROM gmx.proveedores WHERE id_proveedor=$1 AND COALESCE(activo,true)=true ORDER BY row_id LIMIT 1`, [supplierId]);
    if (!supplier.rowCount) throw new Error('SUPPLIER_NOT_FOUND');
    const branch = await client.query(`SELECT id_sucursal,nombre_sucursal FROM gmx.sucursales WHERE id_sucursal=$1 AND COALESCE(activa,true)=true ORDER BY row_id LIMIT 1`, [branchId]);
    if (!branch.rowCount) throw new Error('BRANCH_NOT_FOUND');
    const sp = supplier.rows[0],br = branch.rows[0];

    let subtotal = 0,discounts = 0,taxes = 0,units = 0;
    const prepared = [];
    for (const raw of items) {
      const quantity = Math.trunc(n(raw.quantity)),cost = n(raw.unitCost),discount = Math.max(0, n(raw.discount));
      if (quantity <= 0 || cost < 0) throw new Error('INVALID_PURCHASE_ITEM');
      const itemType = String(raw.itemType || 'PRODUCT').toUpperCase() === 'TCG' ? 'TCG' : 'PRODUCT';
      let product;
      if (itemType === 'TCG') {
        const inventoryId = String(raw.inventoryId || '').trim();
        if (!inventoryId) throw new Error('TCG_INVENTORY_REQUIRED');
        const r = await client.query(`
          SELECT i.id_inventario,i.id_carta,i.sku,i.costo,c.nombre AS nombre,
                 COALESCE(i.rareza,c.rareza) AS rareza,i.idioma,i.condicion,i.acabado,i.edicion
          FROM gmx.tcg_inventario i
          JOIN gmx.tcg_cartas c ON c.id_carta=i.id_carta
          WHERE i.id_inventario=$1
          ORDER BY i.row_id LIMIT 1
        `, [inventoryId]);
        if (!r.rowCount) throw new Error(`TCG_INVENTORY_NOT_FOUND:${inventoryId}`);
        product = { ...r.rows[0], id: r.rows[0].id_inventario, isNew: false, itemType: 'TCG' };
      } else {
        product = await ensureProduct(client, raw);
        product.itemType = 'PRODUCT';
      }
      const gross = round4(quantity * cost);
      if (discount > gross) throw new Error('INVALID_LINE_DISCOUNT');
      const taxable = round4(gross - discount);
      const taxType = String(raw.taxType || 'IVA16').toUpperCase();
      let rate = 0;
      if (taxType === 'IVA16') rate = .16;else
      if (taxType === 'IVA8') rate = .08;else
      if (['IVA0', 'EXENTO', 'NO_OBJETO', 'SIN_COMPROBANTE'].includes(taxType)) rate = 0;else
      throw new Error('INVALID_TAX_TYPE');
      if (fiscal !== 'FACTURADA' && taxType === 'SIN_COMPROBANTE') rate = 0;
      const tax = round4(taxable * rate);
      subtotal += gross;discounts += discount;taxes += tax;units += quantity;
      prepared.push({ product, itemType: product.itemType || 'PRODUCT', quantity, cost, gross, discount, taxType, rate, tax, total: round4(taxable + tax) });
    }
    subtotal = round4(subtotal);discounts = round4(discounts);taxes = round4(taxes);
    const ieps = round4(input.ieps),retentions = round4(input.retentions),other = round4(input.otherCharges);
    const calculated = round4(subtotal - discounts + taxes + ieps - retentions + other);
    const documentTotal = parsedCfdi?.total != null ?
    round4(parsedCfdi.total) :
    input.documentTotal === '' || input.documentTotal == null ? null : round4(input.documentTotal);
    const difference = documentTotal == null ? null : round4(calculated - documentTotal);
    const documentReference = parsedCfdi?.reference || String(input.reference || '').trim();
    const documentUuid = parsedCfdi?.uuid || String(input.uuid || '').trim();
    const documentDate = parsedCfdi?.date || input.documentDate || null;
    const documentSubtotal = parsedCfdi?.subtotal != null ?
    round4(parsedCfdi.subtotal) :
    input.documentSubtotal === '' || input.documentSubtotal == null ? null : n(input.documentSubtotal);
    const id = `COMP-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
    const providerName = sp.nombre_comercial || sp.razon_social || sp.id_proveedor;

    const h = await client.query(`
      INSERT INTO gmx.compras(
        id_compra,fecha,id_proveedor,proveedor,moneda,terminos_pago,dias_credito,tipo_documento,
        referencia_documento,estado,lineas,unidades_solicitadas,unidades_recibidas,subtotal,impuestos,total,
        notas,id_admin,administrador,fecha_actualizacion,id_sucursal_recepcion,sucursal_recepcion,
        estatus_fiscal,uuid_cfdi,fecha_documento,subtotal_documento,descuentos,iva,ieps,retenciones,
        otros_cargos,total_documento,diferencia_documento,metodo_pago,documento_nombre,documento_mime,
        documento_base64,xml_nombre,xml_cfdi
      ) VALUES(
        $1,NOW(),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,$12,$13,$14,$15,'LOCAL','APP Local',NOW(),$16,$17,
        $18,NULLIF($19,''),$20,$21,$22,$13,$23,$24,$25,$26,$27,NULLIF($28,''),NULLIF($29,''),NULLIF($30,''),
        NULLIF($31,''),NULLIF($32,''),NULLIF($33,'')
      ) RETURNING row_id
    `, [id, sp.id_proveedor, providerName, input.currency || sp.moneda || 'MXN', sp.terminos_pago || null, sp.dias_credito || 0,
    input.documentType || 'SIN_DOCUMENTO', documentReference || null, 'BORRADOR',
    prepared.length, units, subtotal, taxes, calculated, input.notes || null, br.id_sucursal, br.nombre_sucursal,
    fiscal, documentUuid, documentDate, documentSubtotal,
    discounts, ieps, retentions, other, documentTotal, difference, input.paymentMethod || '',
    input.documentName || '', input.documentMime || '', documentBase64, input.xmlName || '', xmlText]);

    // Finanzas se originan una sola vez desde la compra.
    const purchasePayment = String(input.paymentMethod || sp.terminos_pago || 'CONTADO').toUpperCase();
    if (purchasePayment === 'CREDITO' || String(sp.terminos_pago || '').toUpperCase() === 'CREDITO') {
      const due = new Date();
      due.setDate(due.getDate() + Math.max(0, Number(sp.dias_credito || 0)));
      await client.query(`INSERT INTO gmx.cuentas_por_pagar(
        id,fecha,id_proveedor,proveedor,documento,id_compra,origen,moneda,id_sucursal,
        vencimiento,total,pagado,saldo,estado,sucursal,notas,actualizacion)
        VALUES(
          'CXP-COMP-'||floor(extract(epoch from clock_timestamp())*1000)::text||'-'||substr(md5(random()::text),1,5),
          NOW(),$1,$2,$3,$3,'COMPRA',$4,$5,$6,$7,0,$7,'PENDIENTE',$8,$9,NOW()
        )
        ON CONFLICT DO NOTHING`, [
      sp.id_proveedor, providerName, id, input.currency || sp.moneda || 'MXN', br.id_sucursal,
      due.toISOString().slice(0, 10), calculated, br.nombre_sucursal, `Generada automÃ¡ticamente desde ${id}`]
      );
    } else {
      await client.query(`INSERT INTO gmx.gastos(
        id_gasto,fecha_creacion,fecha_gasto,id_sucursal,sucursal,categoria,subcategoria,concepto,
        id_proveedor,proveedor,moneda,subtotal,impuestos,total,metodo_pago,referencia,estado,
        caja_registrada,caja_reversada,id_admin_creador,admin_creador,id_admin_actualiza,admin_actualiza,
        notas,fecha_actualizacion,origen_modulo,id_origen)
        VALUES(
          'GASTO-COMP-'||floor(extract(epoch from clock_timestamp())*1000)::text||'-'||substr(md5(random()::text),1,5),
          NOW(),NOW(),$1,$2,'COMPRA','PROVEEDOR',$3,$4,$5,$6,$7,$8,$9,$10,$11,'PENDIENTE',
          false,false,'LOCAL','APP Local','LOCAL','APP Local',$12,NOW(),'COMPRA',$13
        )`, [
      br.id_sucursal, br.nombre_sucursal, `Compra ${id}`, sp.id_proveedor, providerName,
      input.currency || sp.moneda || 'MXN', subtotal, taxes, calculated, purchasePayment, input.reference || id,
      `Egreso generado automÃ¡ticamente desde compra ${id}`, id]
      );
    }

    for (let i = 0; i < prepared.length; i++) {
      const x = prepared[i];
      await client.query(`
        INSERT INTO gmx.compras_detalle(
          id_compra,linea,id_producto,id_inventario,id_carta,sku,producto,
          cantidad_solicitada,cantidad_recibida,cantidad_pendiente,
          costo_unitario,subtotal_linea,estado_linea,tipo_item,descuento_linea,impuesto_tipo,impuesto_tasa,
          impuesto_importe,total_linea,producto_nuevo
        ) VALUES(
          $1,$2,$3,$4,$5,$6,$7,$8,0,$8,$9,$10,'PENDIENTE',$11,$12,$13,$14,$15,$16,$17
        )
      `, [
      id, i + 1,
      x.itemType === 'TCG' ? null : x.product.id,
      x.itemType === 'TCG' ? x.product.id_inventario : null,
      x.itemType === 'TCG' ? x.product.id_carta : null,
      x.product.sku, x.product.nombre, x.quantity, x.cost, x.gross,
      x.itemType, x.discount, x.taxType, x.rate, x.tax, x.total, x.product.isNew]
      );
    }
    /*
     * IMPORTANTE:
     * La compra se crea como BORRADOR incluso cuando receiveNow=true.
     * Sólo receivePurchase() puede cambiarla a RECIBIDA después de aplicar
     * físicamente el inventario. Esto evita el falso bloqueo
     * PURCHASE_NOT_RECEIVABLE que ocurría al marcarla RECIBIDA antes de recibir.
     */
    await client.query('COMMIT');
    if (input.receiveNow) return receivePurchase(h.rows[0].row_id, { branchId, actor });
    return getPurchase(h.rows[0].row_id);
  } catch (e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}

export async function receivePurchase(rowId, { branchId, actor = {} } = {}) {
  const actorId = String(actor.id_admin || actor.id || 'LOCAL').trim() || 'LOCAL';
  const actorName = String(actor.nombre || actor.name || actor.administrador || actor.email || brandText("GMX Local")).trim() || brandText("GMX Local");
  const actorUser = String(actor.email || actor.usuario || actor.username || actorName).trim() || 'gmx_app';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const h = await client.query(`SELECT * FROM gmx.compras WHERE row_id=$1 FOR UPDATE`, [rowId]);
    if (!h.rowCount) throw new Error('PURCHASE_NOT_FOUND');
    const purchase = h.rows[0];
    if (['RECIBIDA', 'CANCELADA'].includes(String(purchase.estado || '').toUpperCase())) throw new Error('PURCHASE_NOT_RECEIVABLE');
    const target = branchId || purchase.id_sucursal_recepcion;
    const br = await client.query(`SELECT id_sucursal,nombre_sucursal FROM gmx.sucursales WHERE id_sucursal=$1 AND COALESCE(activa,true)=true ORDER BY row_id LIMIT 1`, [target]);
    if (!br.rowCount) throw new Error('BRANCH_NOT_FOUND');
    const branch = br.rows[0];
    const details = await client.query(`SELECT * FROM gmx.compras_detalle WHERE id_compra=$1 ORDER BY linea FOR UPDATE`, [purchase.id_compra]);
    const receptionId = `REC-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
    let received = 0;
    for (const d of details.rows) {
      const pending = Math.max(n(d.cantidad_pendiente), 0);if (!pending) continue;
      const itemType = String(d.tipo_item || 'PRODUCTO').toUpperCase();

      if (itemType === 'TCG') {
        const variant = await client.query(`
          SELECT i.*,c.nombre AS carta
          FROM gmx.tcg_inventario i
          JOIN gmx.tcg_cartas c ON c.id_carta=i.id_carta
          WHERE i.id_inventario=$1
          ORDER BY i.row_id LIMIT 1
          FOR UPDATE OF i
        `, [d.id_inventario]);
        if (!variant.rowCount) throw new Error(`TCG_INVENTORY_NOT_FOUND:${d.id_inventario}`);
        const v = variant.rows[0];

        let branchInv = await client.query(`
          SELECT * FROM gmx.tcg_inventario_sucursales
          WHERE id_sucursal=$1 AND id_inventario=$2
          ORDER BY row_id LIMIT 1 FOR UPDATE
        `, [target, v.id_inventario]);

        if (!branchInv.rowCount) {
          await client.query(`
            INSERT INTO gmx.tcg_inventario_sucursales(
              id_registro,id_inventario,id_carta,sku,id_sucursal,sucursal,stock,stock_reservado,ultima_actualizacion
            ) VALUES(
              'TCGINV-COMP-'||floor(extract(epoch from clock_timestamp())*1000)::text||'-'||substr(md5(random()::text),1,5),
              $1,$2,$3,$4,$5,0,0,NOW()
            )
          `, [v.id_inventario, v.id_carta, v.sku, target, branch.nombre_sucursal]);
          branchInv = await client.query(`
            SELECT * FROM gmx.tcg_inventario_sucursales
            WHERE id_sucursal=$1 AND id_inventario=$2
            ORDER BY row_id LIMIT 1 FOR UPDATE
          `, [target, v.id_inventario]);
        }

        const branchBefore = n(branchInv.rows[0].stock),branchAfter = branchBefore + pending;
        const globalBefore = n(v.stock),globalAfter = globalBefore + pending;

        await client.query(`UPDATE gmx.tcg_inventario_sucursales SET stock=$1,ultima_actualizacion=NOW() WHERE row_id=$2`,
        [branchAfter, branchInv.rows[0].row_id]);
        await client.query(`UPDATE gmx.tcg_inventario SET stock=$1,costo=$2,ultima_actualizacion=NOW() WHERE row_id=$3`,
        [globalAfter, n(d.costo_unitario), v.row_id]);

        await client.query(`
          INSERT INTO gmx.tcg_movimientos_sucursales(
            id_movimiento,fecha,tipo,id_inventario,id_carta,sku,
            id_sucursal_destino,sucursal_destino,cantidad,
            stock_destino_anterior,stock_destino_nuevo,
            stock_global_anterior,stock_global_nuevo,
            referencia,motivo,id_admin,administrador
          ) VALUES(
            'TCGMOV-COMP-'||floor(extract(epoch from clock_timestamp())*1000)::text||'-'||substr(md5(random()::text),1,5),
            NOW(),'COMPRA_RECEPCION',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
            'Recepción de compra proveedor',$12,$13
          )
        `, [v.id_inventario, v.id_carta, v.sku, target, branch.nombre_sucursal, pending,
        branchBefore, branchAfter, globalBefore, globalAfter, purchase.id_compra, actorId, actorName]);
      } else {
        const product = await client.query(`SELECT id,sku,nombre FROM gmx.productos WHERE id=$1 ORDER BY row_id LIMIT 1`, [d.id_producto]);
        if (!product.rowCount) throw new Error(`PRODUCT_NOT_FOUND:${d.id_producto}`);
        let inv = await client.query(`SELECT * FROM gmx.inventario_sucursales WHERE id_sucursal=$1 AND id_producto=$2 ORDER BY row_id LIMIT 1 FOR UPDATE`, [target, d.id_producto]);
        if (!inv.rowCount) {
          await client.query(`INSERT INTO gmx.inventario_sucursales(id_registro,id_sucursal,sucursal,id_producto,sku,producto,stock,stock_minimo,fecha_actualizacion)
            VALUES('INV-COMP-'||floor(extract(epoch from clock_timestamp())*1000)::text||'-'||substr(md5(random()::text),1,5),$1,$2,$3,$4,$5,0,0,NOW())`,
          [target, branch.nombre_sucursal, product.rows[0].id, product.rows[0].sku, product.rows[0].nombre]);
          inv = await client.query(`SELECT * FROM gmx.inventario_sucursales WHERE id_sucursal=$1 AND id_producto=$2 ORDER BY row_id LIMIT 1 FOR UPDATE`, [target, d.id_producto]);
        }
        const before = n(inv.rows[0].stock),after = before + pending;
        await client.query(`UPDATE gmx.inventario_sucursales SET stock=$1,fecha_actualizacion=NOW() WHERE row_id=$2`, [after, inv.rows[0].row_id]);
        await client.query(`INSERT INTO gmx.movimientos_inventario_sucursales(
          id_movimiento,fecha,id_sucursal,sucursal,id_producto,sku,producto,tipo,cantidad,stock_anterior,stock_nuevo,motivo,id_admin,nombre_usuario,usuario,referencia
        ) VALUES('MOV-COMP-'||floor(extract(epoch from clock_timestamp())*1000)::text||'-'||substr(md5(random()::text),1,5),NOW(),$1,$2,$3,$4,$5,'COMPRA_RECEPCION',$6,$7,$8,'Recepción de compra',$9,$10,$11,$12)`,
        [target, branch.nombre_sucursal, product.rows[0].id, product.rows[0].sku, product.rows[0].nombre, pending, before, after, actorId, actorName, actorUser, purchase.id_compra]);
      }

      await client.query(`UPDATE gmx.compras_detalle SET cantidad_recibida=COALESCE(cantidad_recibida,0)+$1,cantidad_pendiente=0,
        estado_linea='RECIBIDA',ultima_recepcion=NOW(),id_transferencia_recepcion=$2 WHERE row_id=$3`,
      [pending, receptionId, d.row_id]);
      received += pending;
    }
    await client.query(`UPDATE gmx.compras SET unidades_recibidas=COALESCE(unidades_recibidas,0)+$1,estado='RECIBIDA',
      id_sucursal_recepcion=$2,sucursal_recepcion=$3,fecha_cierre=NOW(),fecha_actualizacion=NOW() WHERE row_id=$4`,
    [received, target, branch.nombre_sucursal, rowId]);
    await client.query('COMMIT');
    return getPurchase(rowId);
  } catch (e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}

function xmlTag(text, localName) {
  const re = new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${localName}\\b[^>]*>`, 'i');
  return String(text || '').match(re)?.[0] || '';
}
function xmlAttr(tag, name) {
  if (!tag) return '';
  const escaped = String(name).replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
  const m = tag.match(new RegExp(`\\b${escaped}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return String(m?.[1] || '').trim();
}
function parseCfdiXml(xmlText) {
  const xml = String(xmlText || '').trim();
  if (!xml) return null;
  const comprobante = xmlTag(xml, 'Comprobante');
  if (!comprobante) throw new Error('CFDI_XML_INVALID');
  const timbre = xmlTag(xml, 'TimbreFiscalDigital');
  const emisor = xmlTag(xml, 'Emisor');
  const uuid = xmlAttr(timbre, 'UUID');
  if (uuid && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)) {
    throw new Error('CFDI_UUID_INVALID');
  }
  const serie = xmlAttr(comprobante, 'Serie');
  const folio = xmlAttr(comprobante, 'Folio');
  const totalRaw = xmlAttr(comprobante, 'Total');
  const subtotalRaw = xmlAttr(comprobante, 'SubTotal') || xmlAttr(comprobante, 'Subtotal');
  const total = totalRaw !== '' && Number.isFinite(Number(totalRaw)) ? round4(Number(totalRaw)) : null;
  const subtotal = subtotalRaw !== '' && Number.isFinite(Number(subtotalRaw)) ? round4(Number(subtotalRaw)) : null;
  return {
    version: xmlAttr(comprobante, 'Version'),
    uuid,
    serie,
    folio,
    reference: [serie, folio].filter(Boolean).join('-'),
    date: xmlAttr(comprobante, 'Fecha'),
    subtotal,
    total,
    issuerRfc: xmlAttr(emisor, 'Rfc') || xmlAttr(emisor, 'RFC'),
    issuerName: xmlAttr(emisor, 'Nombre'),
    stamped: Boolean(uuid)
  };
}

export async function attachFiscalDocument(rowId, input = {}) {
  const xmlText = String(input.xmlText || '').trim();
  const parsed = parseCfdiXml(xmlText);
  let status = String(input.fiscalStatus || 'PENDIENTE_FACTURA').toUpperCase();
  if (parsed?.stamped) status = 'FACTURADA';
  if (!['FACTURADA', 'PENDIENTE_FACTURA', 'NO_FACTURADA', 'SIN_COMPROBANTE'].includes(status)) throw new Error('INVALID_FISCAL_STATUS');

  const uuid = parsed?.uuid || String(input.uuid || '').trim();
  const reference = parsed?.reference || String(input.reference || '').trim();
  const documentTotal = parsed?.total != null ? parsed.total : input.documentTotal == null ? null : n(input.documentTotal);
  const documentSubtotal = parsed?.subtotal == null ? null : parsed.subtotal;
  const documentDate = parsed?.date || null;

  const r = await query(`UPDATE gmx.compras SET
    estatus_fiscal=$2,
    uuid_cfdi=COALESCE(NULLIF($3,''),uuid_cfdi),
    referencia_documento=COALESCE(NULLIF($4,''),referencia_documento),
    total_documento=COALESCE($5,total_documento),
    subtotal_documento=COALESCE($6,subtotal_documento),
    fecha_documento=COALESCE($7::timestamp,fecha_documento),
    documento_nombre=COALESCE(NULLIF($8,''),documento_nombre),
    documento_mime=COALESCE(NULLIF($9,''),documento_mime),
    documento_base64=COALESCE(NULLIF($10,''),documento_base64),
    xml_nombre=COALESCE(NULLIF($11,''),xml_nombre),
    xml_cfdi=COALESCE(NULLIF($12,''),xml_cfdi),
    fecha_actualizacion=NOW()
    WHERE row_id=$1 RETURNING row_id`, [
  rowId, status, uuid, reference, documentTotal, documentSubtotal, documentDate,
  input.documentName || '', input.documentMime || '', input.documentBase64 || '', input.xmlName || '', xmlText]
  );
  if (!r.rowCount) throw new Error('PURCHASE_NOT_FOUND');
  return getPurchase(rowId);
}

export async function cancelPurchase(rowId, reason = '') {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const p = await client.query(`SELECT * FROM gmx.compras WHERE row_id=$1 FOR UPDATE`, [rowId]);
    if (!p.rowCount) throw new Error('PURCHASE_NOT_FOUND');
    const x = p.rows[0];
    if (['RECIBIDA', 'CANCELADA'].includes(String(x.estado || '').toUpperCase())) throw new Error('PURCHASE_NOT_CANCELLABLE');

    await client.query(`UPDATE gmx.compras
      SET estado='CANCELADA',motivo_cancelacion=$2,fecha_cierre=NOW(),fecha_actualizacion=NOW()
      WHERE row_id=$1`, [rowId, reason || null]);

    await client.query(`UPDATE gmx.cuentas_por_pagar
      SET estado='CANCELADA',saldo=0,actualizacion=NOW(),
          notas=CONCAT_WS(' | ',NULLIF(notas,''),'Cancelada por cancelaciÃ³n de compra')
      WHERE id_compra=$1 AND UPPER(COALESCE(estado,''))='PENDIENTE'`, [x.id_compra]);

    await client.query(`UPDATE gmx.gastos
      SET estado='CANCELADO',fecha_cancelacion=NOW(),motivo_cancelacion='Compra cancelada',fecha_actualizacion=NOW()
      WHERE origen_modulo='COMPRA' AND id_origen=$1
        AND UPPER(COALESCE(estado,''))='PENDIENTE'`, [x.id_compra]);

    await client.query('COMMIT');
    return getPurchase(rowId);
  } catch (e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}
