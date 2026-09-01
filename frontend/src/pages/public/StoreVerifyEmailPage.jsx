import { brandText } from "../../config/brand.js";import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { publicApi } from '../../services/publicApi.js';

export default function StoreVerifyEmailPage() {
  const [params] = useSearchParams();
  const [state, setState] = useState('checking');
  const token = params.get('token') || '';

  useEffect(() => {
    if (!token) {setState('invalid');return;}
    publicApi('/api/client/auth/verify', { method: 'POST', body: JSON.stringify({ token }) }).
    then(() => setState('ok')).
    catch(() => setState('invalid'));
  }, [token]);

  return <main className="public-page"><div className="verification-card">
    {state === 'checking' ? <><div className="verification-icon">✉</div><h1>Confirmando tu correo…</h1></> : null}
    {state === 'ok' ? <><div className="verification-icon success">✓</div><h1>Correo confirmado</h1><p>{brandText("Tu cuenta GMX ya está activa y tu sesión de cliente fue iniciada.")}</p><Link className="public-cta" to="/tienda/cuenta">Ir a mi cuenta</Link></> : null}
    {state === 'invalid' ? <><div className="verification-icon error">!</div><h1>Enlace no válido</h1><p>El enlace ya fue utilizado o expiró.</p><Link className="public-cta" to="/tienda/cuenta">Volver a cuenta</Link></> : null}
  </div></main>;
}
