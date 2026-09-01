import { brandText } from "../../config/brand.js";import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { publicApi } from '../../services/publicApi.js';

export default function StoreRecoverAccountPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [developmentUrl, setDevelopmentUrl] = useState('');
  const [saving, setSaving] = useState(false);

  async function request(e) {
    e.preventDefault();setSaving(true);setMessage('');setDevelopmentUrl('');
    try {
      const r = await publicApi('/api/client/auth/recover', {
        method: 'POST',
        body: JSON.stringify({ email })
      });
      setMessage(brandText("Si el correo está asociado a una cuenta GMX verificada, recibirás un enlace para recuperar tu contraseña."));
      if (r.data?.development_reset_url) setDevelopmentUrl(r.data.development_reset_url);
    } catch {
      setMessage(brandText("Si el correo está asociado a una cuenta GMX verificada, recibirás un enlace para recuperar tu contraseña."));
    } finally {setSaving(false);}
  }

  async function reset(e) {
    e.preventDefault();
    if (password !== confirmPassword) {
      window.shinyNotify?.('Las contraseñas no coinciden.', { type: 'error' });
      return;
    }
    setSaving(true);setMessage('');
    try {
      await publicApi('/api/client/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password })
      });
      window.shinyNotify?.('Contraseña actualizada correctamente.', { type: 'success' });
      navigate('/tienda/cuenta', { replace: true });
    } catch (e2) {
      const map = {
        INVALID_OR_EXPIRED_RESET_TOKEN: 'El enlace de recuperación no es válido o ya expiró.',
        PASSWORD_MIN_8: 'La contraseña debe tener al menos 8 caracteres.',
        PASSWORD_LETTER_AND_NUMBER_REQUIRED: 'La contraseña debe contener letras y números.'
      };
      setMessage(map[e2.message] || 'No fue posible cambiar la contraseña.');
    } finally {setSaving(false);}
  }

  return <main className="public-page">
    <div className="recovery-shell">
      {!token ? <>
        <div className="verification-icon">↻</div>
        <small>{brandText("CUENTA GMX")}</small>
        <h1>Recuperar cuenta</h1>
        <p>Escribe el correo utilizado en tu cuenta. Si existe una cuenta verificada, te enviaremos un enlace temporal.</p>
        {message ? <div className="checkout-message">{message}</div> : null}
        {developmentUrl ? <div className="dev-verification"><b>Modo local:</b> SMTP no es obligatorio para probar. <a href={developmentUrl}>Abrir enlace de recuperación</a>.</div> : null}
        <form className="recovery-form" onSubmit={request}>
          <label>Correo electrónico<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@ejemplo.com" /></label>
          <button disabled={saving}>{saving ? 'Enviando…' : 'Enviar enlace de recuperación'}</button>
        </form>
        <Link className="recovery-back" to="/tienda/cuenta">← Volver a iniciar sesión</Link>
      </> : <>
        <div className="verification-icon">🔑</div>
        <small>SEGURIDAD</small>
        <h1>Nueva contraseña</h1>
        <p>{brandText("Al cambiarla, GMX cerrará todas las sesiones anteriores de tu cuenta.")}</p>
        {message ? <div className="checkout-message">{message}</div> : null}
        <form className="recovery-form" onSubmit={reset}>
          <label>Nueva contraseña<input required minLength="8" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /><small>Mínimo 8 caracteres, con letras y números.</small></label>
          <label>Confirmar contraseña<input required minLength="8" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} /></label>
          <button disabled={saving}>{saving ? 'Actualizando…' : 'Cambiar contraseña'}</button>
        </form>
      </>}
    </div>
  </main>;
}
