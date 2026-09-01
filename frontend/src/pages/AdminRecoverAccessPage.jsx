import { brandText } from "../config/brand.js";import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api } from '../services/api.js';

export default function AdminRecoverAccessPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const token = params.get('token') || '';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [developmentUrl, setDevelopmentUrl] = useState('');
  const [loading, setLoading] = useState(false);

  async function requestReset(e) {
    e.preventDefault();setLoading(true);setMessage('');setDevelopmentUrl('');
    try {
      const r = await api('/api/auth/recover', {
        method: 'POST',
        body: JSON.stringify({ email })
      });
      setMessage('Si el correo corresponde a una cuenta administrativa activa, recibirás un enlace temporal de recuperación.');
      if (r.data?.development_reset_url) setDevelopmentUrl(r.data.development_reset_url);
    } catch {
      setMessage('Si el correo corresponde a una cuenta administrativa activa, recibirás un enlace temporal de recuperación.');
    } finally {setLoading(false);}
  }

  async function resetPassword(e) {
    e.preventDefault();
    if (password !== confirmPassword) {
      window.shinyNotify?.('Las contraseñas no coinciden.', { type: 'error' });
      return;
    }
    setLoading(true);setMessage('');
    try {
      await api('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password })
      });
      window.shinyNotify?.('Contraseña administrativa actualizada. Todas las sesiones anteriores fueron cerradas.', { type: 'success', duration: 6500 });
      nav('/login', { replace: true });
    } catch (e2) {
      const map = {
        INVALID_OR_EXPIRED_ADMIN_RESET_TOKEN: 'El enlace de recuperación no es válido, ya fue utilizado o expiró.',
        ADMIN_PASSWORD_MIN_10: 'La contraseña administrativa debe tener al menos 10 caracteres.',
        ADMIN_PASSWORD_LETTER_AND_NUMBER_REQUIRED: 'La contraseña debe contener letras y números.',
        TOO_MANY_ATTEMPTS: 'Demasiados intentos. Espera antes de volver a intentar.'
      };
      setMessage(map[e2.message] || 'No fue posible restablecer el acceso administrativo.');
    } finally {setLoading(false);}
  }

  return <main className="login-page admin-recovery-page">
    <section className="login-card admin-recovery-card">
      <div className="brand-mark login-mark">G</div>
      <div className="eyebrow">{brandText("GMX · SEGURIDAD ADMIN")}</div>

      {!token ? <>
        <h1>Recuperar acceso</h1>
        <p>{brandText("Escribe el correo de tu cuenta administrativa. GMX enviará un enlace temporal si la cuenta está activa.")}</p>
        {message ? <div className="alert info">{message}</div> : null}
        {developmentUrl ? <div className="admin-dev-reset"><b>Modo local:</b> mientras SMTP no esté configurado puedes <a href={developmentUrl}>abrir el enlace de recuperación</a>.</div> : null}
        <form className="admin-recovery-form" onSubmit={requestReset}>
          <label>Correo administrativo<input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <button disabled={loading}>{loading ? 'Procesando…' : 'Enviar enlace de recuperación'}</button>
        </form>
        <Link className="admin-forgot-link" to="/login">← Volver al login administrativo</Link>
      </> : <>
        <h1>Nueva contraseña</h1>
        <p>{brandText("Al completar el cambio, GMX cerrará todas las sesiones administrativas anteriores de esta cuenta.")}</p>
        {message ? <div className="alert error">{message}</div> : null}
        <form className="admin-recovery-form" onSubmit={resetPassword}>
          <label>Nueva contraseña<input required minLength="10" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /><small>Mínimo 10 caracteres, incluyendo letras y números.</small></label>
          <label>Confirmar contraseña<input required minLength="10" type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} /></label>
          <button disabled={loading}>{loading ? 'Actualizando…' : 'Restablecer contraseña'}</button>
        </form>
      </>}
    </section>
  </main>;
}
