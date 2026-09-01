import { brandText } from "./config/brand.js";import { pool, query } from './db.js';
import { newToken, hashToken, hashPassword } from './security.js';
import { queueAndSendEmail, adminPasswordResetEmailHtml, adminPasswordChangedEmailHtml } from './emailService.js';

const txt = (v) => String(v ?? '').trim();

export async function requestAdminPasswordReset({ email = '', ip = '', baseUrl = '', requestedBy = 'PUBLIC' }) {
  const normalized = txt(email).toLowerCase();
  const generic = { accepted: true };
  if (!normalized) return generic;

  const r = await query(`SELECT id_admin,nombre,email,rol,activo
    FROM gmx.administradores
    WHERE LOWER(email)=$1
    ORDER BY row_id LIMIT 1`, [normalized]);

  // Anti-enumeración: no cambia la respuesta pública.
  if (!r.rowCount || r.rows[0].activo === false) return generic;

  const admin = r.rows[0];
  const token = newToken();
  const cfg = await query(`SELECT valor FROM gmx.configuracion
    WHERE parametro='security.admin_password_reset_minutes'`);
  const minutes = Math.min(Math.max(Number(cfg.rows[0]?.valor || 20), 5), 60);

  await query(`UPDATE gmx.admin_password_reset_tokens
    SET used_at=NOW()
    WHERE id_admin=$1 AND used_at IS NULL`, [admin.id_admin]);

  await query(`INSERT INTO gmx.admin_password_reset_tokens(
    token_hash,id_admin,email,expires_at,requested_ip)
    VALUES($1,$2,$3,NOW()+($4||' minutes')::interval,$5)`, [
  hashToken(token), admin.id_admin, admin.email, String(minutes), txt(ip)]
  );

  const publicBase = String(baseUrl || process.env.SHINY_PUBLIC_BASE_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');
  const resetUrl = `${publicBase}/admin/recuperar-acceso?token=${encodeURIComponent(token)}`;

  const mail = await queueAndSendEmail({
    to: admin.email,
    subject: brandText("GMX · Recuperación de acceso administrativo"),
    html: adminPasswordResetEmailHtml({ name: admin.nombre || '', resetUrl }),
    reference: admin.id_admin
  });

  await query(`INSERT INTO gmx.auditoria(fecha,modulo,accion,referencia,detalle,usuario)
    VALUES(NOW(),'AUTH','ADMIN_PASSWORD_RESET_REQUEST',$1,$2,$3)`, [
  admin.id_admin,
  `${mail.sent ? 'EMAIL_SENT' : mail.queued ? 'EMAIL_QUEUED' : 'EMAIL_NOT_SENT'}; requestedBy=${requestedBy}`,
  requestedBy]
  );

  return {
    accepted: true,
    target: { id_admin: admin.id_admin, email: admin.email, nombre: admin.nombre, rol: admin.rol },
    mail,
    development_reset_url: String(process.env.NODE_ENV || 'development') === 'development' ? resetUrl : undefined
  };
}

export async function completeAdminPasswordReset({ token = '', password = '', ip = '' }) {
  const p = String(password || '');
  if (p.length < 10) throw new Error('ADMIN_PASSWORD_MIN_10');
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) throw new Error('ADMIN_PASSWORD_LETTER_AND_NUMBER_REQUIRED');

  const client = await pool.connect();
  let admin = null;
  let revoked = 0;
  try {
    await client.query('BEGIN');

    const r = await client.query(`SELECT t.row_id,t.id_admin,t.email,a.nombre,a.rol,a.activo
      FROM gmx.admin_password_reset_tokens t
      JOIN gmx.administradores a ON a.id_admin=t.id_admin
      WHERE t.token_hash=$1
        AND t.used_at IS NULL
        AND t.expires_at>NOW()
        AND COALESCE(a.activo,true)=true
      ORDER BY t.row_id DESC
      LIMIT 1
      FOR UPDATE OF t`, [hashToken(token)]);

    if (!r.rowCount) throw new Error('INVALID_OR_EXPIRED_ADMIN_RESET_TOKEN');
    admin = r.rows[0];

    await client.query(`UPDATE gmx.administradores
      SET password_hash=$2,fecha_actualizacion=NOW()
      WHERE id_admin=$1`, [admin.id_admin, hashPassword(p)]);

    await client.query(`UPDATE gmx.admin_password_reset_tokens
      SET used_at=NOW(),completed_ip=$2
      WHERE row_id=$1`, [admin.row_id, txt(ip)]);

    const sessions = await client.query(`UPDATE gmx.admin_sessions
      SET revoked_at=COALESCE(revoked_at,NOW())
      WHERE id_admin=$1 AND revoked_at IS NULL
      RETURNING id`, [admin.id_admin]);
    revoked = sessions.rowCount;

    await client.query(`INSERT INTO gmx.auditoria(fecha,modulo,accion,referencia,detalle,usuario)
      VALUES(NOW(),'AUTH','ADMIN_PASSWORD_RESET_COMPLETE',$1,$2,$3)`, [
    admin.id_admin, `Sesiones revocadas: ${revoked}`, admin.email]
    );

    await client.query('COMMIT');
  } catch (e) {
    try {await client.query('ROLLBACK');} catch {}
    throw e;
  } finally {
    client.release();
  }

  const mail = await queueAndSendEmail({
    to: admin.email,
    subject: brandText("GMX · Contraseña administrativa actualizada"),
    html: adminPasswordChangedEmailHtml({ name: admin.nombre || '' }),
    reference: admin.id_admin
  });

  return { reset: true, id_admin: admin.id_admin, revoked, mail };
}
