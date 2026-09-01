import PDFDocument from 'pdfkit';
import { brandText } from '../config/brand.js';

const money = (value) => Number(value || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const text = (value, fallback = '') => String(value ?? fallback).trim();

export async function createOrderReceiptPdf(order) {
  if (!order) throw new Error('ORDER_NOT_FOUND');
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 46, info: {
      Title: `Comprobante ${text(order.id_pedido)}`,
      Author: brandText('GMX'),
      Subject: 'Comprobante comercial de compra'
    }});
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - 92;
    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(22).text(brandText('GMX'), 46, 44);
    doc.font('Helvetica').fontSize(10).fillColor('#667085').text('COMPROBANTE COMERCIAL DE COMPRA', 46, 72);
    doc.moveTo(46, 94).lineTo(46 + pageWidth, 94).strokeColor('#d0d5dd').stroke();

    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(11).text('Folio', 46, 112);
    doc.font('Helvetica').text(text(order.id_pedido, '—'), 135, 112);
    doc.font('Helvetica-Bold').text('Fecha', 330, 112);
    doc.font('Helvetica').text(new Date(order.fecha || Date.now()).toLocaleString('es-MX'), 390, 112);
    doc.font('Helvetica-Bold').text('Sucursal', 46, 132);
    doc.font('Helvetica').text(text(order.sucursal || order.id_sucursal, 'Caja local'), 135, 132);
    doc.font('Helvetica-Bold').text('Cliente', 330, 132);
    doc.font('Helvetica').text(text(order.nombre_cliente, 'Público general'), 390, 132, { width: 160 });

    let y = 172;
    doc.rect(46, y, pageWidth, 26).fill('#111827');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
    doc.text('ARTÍCULO', 56, y + 9, { width: 260 });
    doc.text('CANT.', 330, y + 9, { width: 45, align: 'right' });
    doc.text('PRECIO', 390, y + 9, { width: 72, align: 'right' });
    doc.text('IMPORTE', 474, y + 9, { width: 72, align: 'right' });
    y += 31;

    doc.font('Helvetica').fontSize(9).fillColor('#111827');
    for (const item of order.detalles || []) {
      if (y > 650) { doc.addPage(); y = 54; }
      const qty = Number(item.cantidad || 0);
      const unit = Number(item.precio_unitario ?? item.precio ?? 0);
      const amount = Number(item.subtotal ?? qty * unit);
      doc.text(text(item.producto || item.detalle || item.sku, 'Artículo'), 56, y, { width: 260 });
      doc.text(String(qty), 330, y, { width: 45, align: 'right' });
      doc.text(money(unit), 390, y, { width: 72, align: 'right' });
      doc.text(money(amount), 474, y, { width: 72, align: 'right' });
      y += Math.max(23, doc.heightOfString(text(item.producto || item.detalle || item.sku), { width: 260 }) + 10);
      doc.moveTo(46, y - 5).lineTo(46 + pageWidth, y - 5).strokeColor('#eaecf0').stroke();
    }

    y += 8;
    const summaryX = 350;
    doc.font('Helvetica').fontSize(10).fillColor('#344054').text('Subtotal', summaryX, y, { width: 100 });
    doc.text(money(order.subtotal), 458, y, { width: 88, align: 'right' });
    y += 20;
    const discount = Number(order.descuento_total || order.descuento || 0);
    if (discount) {
      doc.text('Descuento', summaryX, y, { width: 100 });
      doc.text(`-${money(discount)}`, 458, y, { width: 88, align: 'right' });
      y += 20;
    }
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#111827').text('TOTAL', summaryX, y, { width: 100 });
    doc.text(money(order.total), 446, y, { width: 100, align: 'right' });
    y += 38;

    const methods = (order.pagos || []).map((p) => p.metodo).filter(Boolean).join(', ') || order.metodo_pago || 'No especificado';
    doc.font('Helvetica-Bold').fontSize(10).text('Forma de pago: ', 46, y, { continued: true });
    doc.font('Helvetica').text(text(methods));
    y += 34;
    doc.moveTo(46, y).lineTo(46 + pageWidth, y).strokeColor('#d0d5dd').stroke();
    doc.font('Helvetica').fontSize(9).fillColor('#667085').text(brandText('Gracias por tu compra. Conserva este comprobante para cualquier aclaración.'), 46, y + 14, { width: pageWidth, align: 'center' });
    doc.text('Este documento es un comprobante comercial y no sustituye un CFDI.', 46, y + 30, { width: pageWidth, align: 'center' });
    doc.end();
  });
}
