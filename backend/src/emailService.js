import { brandText } from "./config/brand.js";import nodemailer from 'nodemailer';
import crypto from 'node:crypto';
import { query } from './db.js';

const uid = () => `EML-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

const txt = (v) => String(v ?? '').trim();
const bool = (v, def = false) => {
  if (v == null || v === '') return def;
  return ['1', 'true', 'yes', 'si', 'sí', 'on'].includes(String(v).toLowerCase());
};

async function smtpSettings() {
  const r = await query(`SELECT parametro,valor FROM gmx.configuracion
    WHERE parametro LIKE 'email.smtp.%'`);
  const m = Object.fromEntries(r.rows.map((x) => [x.parametro, x.valor]));

  const provider = txt(m['email.smtp.provider']) || 'CUSTOM';
  const host = txt(m['email.smtp.host']) || txt(process.env.SHINY_SMTP_HOST);
  const user = txt(m['email.smtp.user']) || txt(process.env.SHINY_SMTP_USER);
  const pass = String(m['email.smtp.password'] ?? process.env.SHINY_SMTP_PASS ?? '');
  const fromEmail = txt(m['email.smtp.from_email']) || txt(process.env.SHINY_SMTP_FROM) || user;
  const fromName = txt(m['email.smtp.from_name']) || txt(process.env.SHINY_SMTP_FROM_NAME) || brandText("GMX");
  const port = Number(m['email.smtp.port'] || process.env.SHINY_SMTP_PORT || 587);
  const secure = bool(m['email.smtp.secure'] ?? process.env.SHINY_SMTP_SECURE, false);
  const enabled = bool(m['email.smtp.enabled'], true);

  return {
    enabled, provider, host, user, pass, fromEmail, fromName,
    port: Number.isFinite(port) && port > 0 ? port : 587,
    secure,
    configured: !!(enabled && host && user && pass && fromEmail),
    source: m['email.smtp.host'] || m['email.smtp.user'] || m['email.smtp.password'] ? 'DATABASE' : 'ENV'
  };
}

export async function getSmtpStatus() {
  const s = await smtpSettings();
  return {
    enabled: s.enabled,
    configured: s.configured,
    provider: s.provider || 'CUSTOM',
    host: s.host || '',
    port: s.port,
    secure: s.secure,
    user: s.user || '',
    fromEmail: s.fromEmail || '',
    fromName: s.fromName || brandText("GMX"),
    passwordConfigured: !!s.pass,
    source: s.source
  };
}

async function smtpConfig() {
  const s = await smtpSettings();
  if (!s.configured) return null;
  return {
    transport: {
      host: s.host,
      port: s.port,
      secure: s.secure,
      auth: { user: s.user, pass: s.pass }
    },
    from: s.fromName ? `${s.fromName.replace(/[<>]/g, '')} <${s.fromEmail}>` : s.fromEmail
  };
}

export async function queueAndSendEmail({ to, subject, html, attachments = [], reference = '' }) {
  if (!to) return { queued: false, sent: false, reason: 'NO_RECIPIENT' };
  const id = uid();
  await query(`INSERT INTO gmx.email_outbox(id_email,destinatario,asunto,html,estado,referencia)
    VALUES($1,$2,$3,$4,'PENDING',$5)`, [id, to, subject, html, reference || null]);

  const cfg = await smtpConfig();
  if (!cfg) return { queued: true, sent: false, id, reason: 'SMTP_NOT_CONFIGURED' };

  try {
    const transport = nodemailer.createTransport(cfg.transport);
    await transport.sendMail({
      from: cfg.from,
      to, subject, html, attachments
    });
    await query(`UPDATE gmx.email_outbox SET estado='SENT',intentos=intentos+1,enviado_at=NOW(),ultimo_error=NULL WHERE id_email=$1`, [id]);
    return { queued: true, sent: true, id };
  } catch (e) {
    const diagnostic = {
      code: String(e?.code || 'SMTP_ERROR').slice(0, 80),
      responseCode: Number.isFinite(Number(e?.responseCode)) ? Number(e.responseCode) : null,
      command: String(e?.command || '').slice(0, 80) || null,
      response: String(e?.response || '').replace(/[\r\n]+/g, ' ').slice(0, 500) || null,
      message: String(e?.message || e || 'Error SMTP').replace(/[\r\n]+/g, ' ').slice(0, 500)
    };
    // Never return/store credentials. Nodemailer diagnostics above contain protocol/server data only.
    await query(`UPDATE gmx.email_outbox SET estado='ERROR',intentos=intentos+1,ultimo_error=$2 WHERE id_email=$1`, [
    id,
    JSON.stringify(diagnostic).slice(0, 1000)]
    );
    return { queued: true, sent: false, id, reason: 'SMTP_ERROR', diagnostic };
  }
}

export function orderConfirmationHtml({ order, receiptUrl, brand = brandText("GMX") }) {
  const total = Number(order.total || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:24px">
    <div style="max-width:640px;margin:auto;background:#fff;border-radius:14px;padding:28px">
      <h1 style="margin-top:0">${brand}</h1>
      <h2>Recibimos tu pedido</h2>
      <p>Hola ${escapeHtml(order.nombre_cliente || '')}, tu pedido <b>${escapeHtml(order.id_pedido || '')}</b> fue recibido.</p>
      <p><b>Total:</b> ${total}<br><b>Estado:</b> ${escapeHtml(order.estado_pedido || 'PENDIENTE')}<br><b>Pago:</b> ${escapeHtml(order.metodo_pago_publico || order.metodo_pago || 'POR DEFINIR')}</p>
      <p><a href="${receiptUrl}" style="display:inline-block;padding:12px 18px;background:#111827;color:#fff;text-decoration:none;border-radius:9px">Ver comprobante</a></p>
      <p style="color:#667085;font-size:12px">Conserva este correo para consultar tu pedido.</p>
    </div></body></html>`;
}
function escapeHtml(v) {return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);}


export function verificationEmailHtml({ name = '', verificationUrl, brand = brandText("GMX") }) {
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:24px">
    <div style="max-width:640px;margin:auto;background:#fff;border-radius:14px;padding:28px">
      <h1 style="margin-top:0">${escapeHtml(brand)}</h1>
      <h2>Confirma tu correo electrónico</h2>
      <p>Hola ${escapeHtml(name)}, gracias por crear tu cuenta.</p>
      <p>Para activar tu cuenta de cliente, confirma tu correo:</p>
      <p><a href="${verificationUrl}" style="display:inline-block;padding:12px 18px;background:#111827;color:#fff;text-decoration:none;border-radius:9px">Confirmar mi correo</a></p>
      <p style="color:#667085;font-size:12px">Este enlace caduca automáticamente. Si no creaste esta cuenta, puedes ignorar el mensaje.</p>
    </div></body></html>`;
}

export function paymentReceiptHtml({ order, receiptUrl, brand = brandText("GMX"), paymentLabel = 'Pago confirmado' }) {
  const total = Number(order.total || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:24px">
    <div style="max-width:640px;margin:auto;background:#fff;border-radius:14px;padding:28px">
      <h1 style="margin-top:0">${escapeHtml(brand)}</h1>
      <h2>${escapeHtml(paymentLabel)}</h2>
      <p>Pedido <b>${escapeHtml(order.id_pedido || '')}</b></p>
      <p><b>Total:</b> ${total}<br><b>Estado de pago:</b> ${escapeHtml(order.estado_pago || 'PAGADO')}</p>
      <p><a href="${receiptUrl}" style="display:inline-block;padding:12px 18px;background:#111827;color:#fff;text-decoration:none;border-radius:9px">Abrir comprobante</a></p>
    </div></body></html>`;
}

export function transferInstructionsHtml({ order, receiptUrl, bank, brand = brandText("GMX") }) {
  const total = Number(order.total || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:24px">
    <div style="max-width:640px;margin:auto;background:#fff;border-radius:14px;padding:28px">
      <h1 style="margin-top:0">${escapeHtml(brand)}</h1>
      <h2>Instrucciones para transferencia</h2>
      <p>Pedido <b>${escapeHtml(order.id_pedido || '')}</b> · Total <b>${total}</b></p>
      <p><b>Banco:</b> ${escapeHtml(bank.bank_name || 'Por configurar')}<br>
      <b>Titular:</b> ${escapeHtml(bank.account_holder || 'Por configurar')}<br>
      <b>Cuenta:</b> ${escapeHtml(bank.account_number || '—')}<br>
      <b>CLABE:</b> ${escapeHtml(bank.clabe || '—')}<br>
      <b>Referencia:</b> ${escapeHtml(order.numero_comprobante || order.id_pedido || '')}</p>
      <p>${escapeHtml(bank.instructions || '')}</p>
      <p><a href="${receiptUrl}" style="display:inline-block;padding:12px 18px;background:#111827;color:#fff;text-decoration:none;border-radius:9px">Ver pedido / subir comprobante</a></p>
    </div></body></html>`;
}


export function passwordResetEmailHtml({ name = '', resetUrl, brand = brandText("GMX") }) {
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:24px">
    <div style="max-width:640px;margin:auto;background:#fff;border-radius:14px;padding:28px">
      <h1 style="margin-top:0">${escapeHtml(brand)}</h1>
      <h2>Recupera tu cuenta</h2>
      <p>Hola ${escapeHtml(name || '')}, recibimos una solicitud para cambiar la contraseña de tu cuenta.</p>
      <p><a href="${resetUrl}" style="display:inline-block;padding:12px 18px;background:#111827;color:#fff;text-decoration:none;border-radius:9px">Cambiar mi contraseña</a></p>
      <p style="color:#667085;font-size:12px">El enlace es temporal y solo puede utilizarse una vez. Si no solicitaste este cambio, ignora el correo; tu contraseña actual seguirá funcionando.</p>
    </div></body></html>`;
}

export function passwordChangedEmailHtml({ name = '', brand = brandText("GMX") }) {
  return brandText(`<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:24px">
    <div style="max-width:640px;margin:auto;background:#fff;border-radius:14px;padding:28px">
      <h1 style="margin-top:0">${escapeHtml(brand)}</h1>
      <h2>Tu contraseña fue actualizada</h2>
      <p>Hola ${escapeHtml(name || '')}, la contraseña de tu cuenta GMX se modificó correctamente.</p>
      <p>Por seguridad cerramos todas las sesiones anteriores de tu cuenta.</p>
      <p style="color:#667085;font-size:12px">Si tú no realizaste este cambio, contacta a soporte inmediatamente.</p>
    </div></body></html>`);
}


export function adminPasswordResetEmailHtml({ name = '', resetUrl, brand = brandText("GMX") }) {
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:24px">
    <div style="max-width:640px;margin:auto;background:#fff;border-radius:14px;padding:28px">
      <h1 style="margin-top:0">${escapeHtml(brand)}</h1>
      <h2>Recuperación de acceso administrativo</h2>
      <p>Hola ${escapeHtml(name || 'Administrador')}, recibimos una solicitud para restablecer la contraseña de tu cuenta administrativa.</p>
      <p><a href="${resetUrl}" style="display:inline-block;padding:12px 18px;background:#111827;color:#fff;text-decoration:none;border-radius:9px">Restablecer acceso Admin</a></p>
      <p style="color:#667085;font-size:12px">El enlace es temporal, de un solo uso y solo sirve para una cuenta administrativa. Si no solicitaste este cambio, ignora el mensaje.</p>
    </div></body></html>`;
}

export function adminPasswordChangedEmailHtml({ name = '', brand = brandText("GMX") }) {
  return brandText(`<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:24px">
    <div style="max-width:640px;margin:auto;background:#fff;border-radius:14px;padding:28px">
      <h1 style="margin-top:0">${escapeHtml(brand)}</h1>
      <h2>Contraseña administrativa actualizada</h2>
      <p>Hola ${escapeHtml(name || 'Administrador')}, la contraseña de tu cuenta administrativa fue modificada.</p>
      <p>Por seguridad, GMX cerró todas las sesiones administrativas anteriores de esa cuenta.</p>
      <p style="color:#667085;font-size:12px">Si tú no realizaste este cambio, contacta de inmediato al responsable SUPERADMIN.</p>
    </div></body></html>`);
}



export async function saveSmtpConfiguration(input = {}, user = null) {
  const provider = txt(input.provider || 'CUSTOM').toUpperCase();
  let host = txt(input.host),port = Number(input.port || 587),secure = input.secure === true;
  if (provider === 'GMAIL') {
    host = 'smtp.gmail.com';port = 587;secure = false;
  } else if (provider === 'MICROSOFT365') {
    host = 'smtp.office365.com';port = 587;secure = false;
  }

  const smtpUser = txt(input.user).toLowerCase();
  const fromEmail = txt(input.fromEmail || smtpUser).toLowerCase();
  const fromName = txt(input.fromName || brandText("GMX"));
  if (input.enabled !== false) {
    if (!host) throw new Error('SMTP_HOST_REQUIRED');
    if (!smtpUser) throw new Error('SMTP_USER_REQUIRED');
    if (!fromEmail) throw new Error('SMTP_FROM_REQUIRED');
    if (!Number.isFinite(port) || port < 1 || port > 65535) throw new Error('SMTP_PORT_INVALID');
  }

  const entries = [
  ['email.smtp.enabled', String(input.enabled !== false)],
  ['email.smtp.provider', provider],
  ['email.smtp.host', host],
  ['email.smtp.port', String(port)],
  ['email.smtp.secure', String(secure)],
  ['email.smtp.user', smtpUser],
  ['email.smtp.from_email', fromEmail],
  ['email.smtp.from_name', fromName]];

  const password = String(input.password || '');
  if (password) entries.push(['email.smtp.password', password]);else
  if (input.clearPassword === true) entries.push(['email.smtp.password', '']);

  for (const [key, value] of entries) {
    await query(`INSERT INTO gmx.configuracion(parametro,valor)
      VALUES($1,$2)
      ON CONFLICT(parametro) DO UPDATE SET valor=EXCLUDED.valor`, [key, value]);
  }

  await query(`INSERT INTO gmx.auditoria(fecha,modulo,accion,referencia,detalle,usuario)
    VALUES(NOW(),'SISTEMA','SMTP_CONFIG','CORREO',$1,$2)`, [
  `${provider}; host=${host}; port=${port}; secure=${secure}; user=${smtpUser}; password=${password ? 'UPDATED' : input.clearPassword === true ? 'CLEARED' : 'UNCHANGED'}`,
  user?.email || brandText("GMX Local")]
  );

  return getSmtpStatus();
}

export async function sendSmtpTest({ to } = {}, user = null) {
  const recipient = txt(to).toLowerCase();
  if (!recipient) throw new Error('SMTP_TEST_RECIPIENT_REQUIRED');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new Error('SMTP_TEST_RECIPIENT_INVALID');

  const result = await queueAndSendEmail({
    to: recipient,
    subject: brandText("GMX · Prueba de configuración de correo"),
    html: brandText(`<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:24px">
      <div style="max-width:620px;margin:auto;background:#fff;border-radius:14px;padding:28px">
        <h1 style="margin-top:0">GMX</h1>
        <h2>Correo configurado correctamente</h2>
        <p>Este mensaje confirma que la configuración SMTP de GMX puede enviar correos.</p>
        <p style="color:#667085;font-size:12px">Fecha de prueba: ${new Date().toLocaleString('es-MX')}</p>
      </div></body></html>`),
    reference: 'SMTP-TEST'
  });

  if (!result.sent) {
    if (result.reason === 'SMTP_NOT_CONFIGURED') throw new Error('SMTP_NOT_CONFIGURED');
    const err = new Error('SMTP_TEST_SEND_FAILED');
    err.smtpDiagnostic = result.diagnostic || null;
    throw err;
  }

  await query(`INSERT INTO gmx.auditoria(fecha,modulo,accion,referencia,detalle,usuario)
    VALUES(NOW(),'SISTEMA','SMTP_TEST_OK','CORREO',$1,$2)`, [
  `${recipient}; email=${result.id}`, user?.email || brandText("GMX Local")]
  );
  return { sent: true, to: recipient, id: result.id };
}

export function quoteEmailHtml({ quote, brand = brandText("GMX") }) {
  const money = (v) => Number(v || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  const items = Array.isArray(quote.items_json) ?
  quote.items_json :
  (() => {try {return JSON.parse(quote.items_json || '[]');} catch {return [];}})();

  const created = quote.fecha ? new Date(quote.fecha) : new Date();
  const validity = Math.max(1, Number(quote.validez_dias || 15));
  const expires = new Date(created.getTime());
  expires.setDate(expires.getDate() + validity);

  const rows = items.map((item) => {
    const type = String(item.item_type || 'PRODUCT').toUpperCase() === 'TCG' ? 'Carta TCG' : 'Producto';
    const details = String(item.item_type || '').toUpperCase() === 'TCG' ?
    [
    item.numero_carta,
    item.rareza ? `(${item.rareza})` : '',
    item.condicion, item.idioma, item.acabado, item.edicion].
    filter(Boolean).join(' · ') :
    [item.sku].filter(Boolean).join(' · ');

    return `<tr>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb">
        <div style="font-size:11px;color:#667085;text-transform:uppercase">${escapeHtml(type)}</div>
        <strong>${escapeHtml(item.producto || 'Artículo')}</strong>
        ${details ? `<div style="font-size:12px;color:#667085;margin-top:3px">${escapeHtml(details)}</div>` : ''}
      </td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:center">${Number(item.cantidad || 0)}</td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right">${money(item.precio_unitario)}</td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right"><strong>${money(item.subtotal)}</strong></td>
    </tr>`;
  }).join('');

  return `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f3f4f6;padding:24px;color:#111827">
    <div style="max-width:760px;margin:auto;background:#fff;border-radius:16px;overflow:hidden">
      <div style="padding:28px;background:#111827;color:#fff">
        <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.72">${escapeHtml(brand)}</div>
        <h1 style="margin:8px 0 0">Cotización ${escapeHtml(quote.id || '')}</h1>
      </div>
      <div style="padding:28px">
        <p>Hola <strong>${escapeHtml(quote.cliente || 'Cliente')}</strong>,</p>
        <p>Te compartimos la cotización solicitada. Los precios están expresados en MXN.</p>

        <div style="display:flex;gap:24px;flex-wrap:wrap;margin:20px 0">
          <div><div style="font-size:11px;color:#667085">FECHA</div><strong>${created.toLocaleDateString('es-MX')}</strong></div>
          <div><div style="font-size:11px;color:#667085">VÁLIDA HASTA</div><strong>${expires.toLocaleDateString('es-MX')}</strong></div>
          <div><div style="font-size:11px;color:#667085">VIGENCIA</div><strong>${validity} día(s)</strong></div>
        </div>

        <table style="width:100%;border-collapse:collapse;margin-top:18px">
          <thead>
            <tr style="background:#f9fafb">
              <th style="padding:10px;text-align:left">Artículo</th>
              <th style="padding:10px;text-align:center">Cant.</th>
              <th style="padding:10px;text-align:right">Precio</th>
              <th style="padding:10px;text-align:right">Importe</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="4" style="padding:18px;text-align:center;color:#667085">Sin partidas</td></tr>'}</tbody>
        </table>

        <div style="margin:20px 0 0 auto;max-width:320px">
          <div style="display:flex;justify-content:space-between;padding:6px 0"><span>Subtotal</span><strong>${money(quote.subtotal)}</strong></div>
          <div style="display:flex;justify-content:space-between;padding:6px 0"><span>Descuento</span><strong>${money(quote.descuento)}</strong></div>
          <div style="display:flex;justify-content:space-between;padding:12px 0;border-top:2px solid #111827;font-size:20px"><strong>Total</strong><strong>${money(quote.total)}</strong></div>
        </div>

        ${quote.notas ? `<div style="margin-top:22px;padding:14px;border-radius:10px;background:#f9fafb"><strong>Notas</strong><div style="margin-top:5px;color:#475467">${escapeHtml(quote.notas)}</div></div>` : ''}

        <p style="margin-top:26px;color:#667085;font-size:12px">
          Esta cotización no reserva inventario hasta que sea convertida y procesada como pedido.
        </p>
      </div>
    </div>
  </body></html>`;
}


export function posReceiptEmailHtml({ order, brand = brandText("GMX") }) {
  const money = (v) => Number(v || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  const date = order?.fecha ? new Date(order.fecha) : new Date();
  const lines = Array.isArray(order?.detalles) ? order.detalles : [];
  const totalDiscount = Number(order?.descuento_promocion || 0) + Number(order?.descuento_puntos || 0);
  const rows = lines.map((x) => {
    const isTcg = String(x.tipo || 'PRODUCTO').toUpperCase() === 'TCG';
    return `<tr>
      <td style="padding:9px 6px;border-bottom:1px solid #e5e7eb">
        <strong>${escapeHtml(x.producto || 'Artículo')}</strong>
        ${x.sku ? `<div style="font-size:11px;color:#667085">${escapeHtml(x.sku)}</div>` : ''}
        ${isTcg && x.detalle ? `<div style="font-size:11px;color:#667085">${escapeHtml(x.detalle)}</div>` : ''}
      </td>
      <td style="padding:9px 6px;border-bottom:1px solid #e5e7eb;text-align:center">${Number(x.cantidad || 0)}</td>
      <td style="padding:9px 6px;border-bottom:1px solid #e5e7eb;text-align:right">${money(x.precio_unitario || x.precio)}</td>
      <td style="padding:9px 6px;border-bottom:1px solid #e5e7eb;text-align:right"><strong>${money(x.subtotal)}</strong></td>
    </tr>`;
  }).join('');
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f3f4f6;padding:22px;color:#111827">
    <div style="max-width:720px;margin:auto;background:#fff;border-radius:14px;overflow:hidden">
      <div style="padding:24px;background:#111827;color:#fff">
        <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;opacity:.72">${escapeHtml(brand)}</div>
        <h1 style="margin:6px 0">Ticket / comprobante de venta</h1>
        <div>${escapeHtml(order?.id_pedido || '')}</div>
      </div>
      <div style="padding:24px">
        <div style="display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap">
          <div><div style="font-size:11px;color:#667085">FECHA</div><strong>${date.toLocaleString('es-MX')}</strong></div>
          <div><div style="font-size:11px;color:#667085">SUCURSAL</div><strong>${escapeHtml(order?.sucursal || '')}</strong></div>
          <div><div style="font-size:11px;color:#667085">CLIENTE</div><strong>${escapeHtml(order?.nombre_cliente || 'Público general')}</strong></div>
        </div>
        <table style="width:100%;border-collapse:collapse;margin-top:20px">
          <thead><tr style="background:#f9fafb"><th style="padding:9px 6px;text-align:left">Artículo</th><th>Cant.</th><th style="text-align:right">Precio</th><th style="text-align:right">Importe</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="margin:18px 0 0 auto;max-width:320px">
          <div style="display:flex;justify-content:space-between;padding:5px 0"><span>Subtotal</span><strong>${money(order?.subtotal)}</strong></div>
          ${totalDiscount > 0 ? `<div style="display:flex;justify-content:space-between;padding:5px 0"><span>Descuentos</span><strong>-${money(totalDiscount)}</strong></div>` : ''}
          <div style="display:flex;justify-content:space-between;padding:10px 0;border-top:2px solid #111827;font-size:20px"><strong>Total</strong><strong>${money(order?.total)}</strong></div>
        </div>
        <div style="margin-top:18px;padding:12px;background:#f9fafb;border-radius:9px">
          <div><strong>Método de pago:</strong> ${escapeHtml(order?.metodo_pago || '')}</div>
          ${order?.referencia_pago ? `<div style="margin-top:4px"><strong>Referencia:</strong> ${escapeHtml(order.referencia_pago)}</div>` : ''}
        </div>
        <p style="margin-top:22px;color:#667085;font-size:11px;text-align:center">Gracias por tu compra.</p>
      </div>
    </div>
  </body></html>`;
}
