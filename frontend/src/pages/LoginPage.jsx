import { brandText } from "../config/brand.js";import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { api } from '../services/api.js';
import BrandLogo from '../components/BrandLogo.jsx';

import './LoginPageR63.css';
import RpiWifiManager from '../components/RpiWifiManager.jsx';
export default function LoginPage() {
  const nav = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [wifiManagerOpen,setWifiManagerOpen]=useState(false);
  const localWifiAllowed=typeof window!=='undefined' && (window.location.hostname==='127.0.0.1'||window.location.hostname==='localhost');
  const [loginAppearance,setLoginAppearance] = useState(() => {
    try {
      const cached=JSON.parse(localStorage.getItem('SHINY_LOGIN_APPEARANCE_R55')||'{}');
      return {
        design:String(cached.design||'network4'),
        glow:String(cached.glow||'violet'),
        mediaId:String(cached.mediaId||''),
        opacity:Math.max(0,Math.min(1,Number(cached.opacity??1)||1)),
        fit:['cover','contain','fill'].includes(String(cached.fit||''))?String(cached.fit):'cover'
      };
    } catch {
      return {design:'network4',glow:'violet',mediaId:'',opacity:1,fit:'cover'};
    }
  });

  useEffect(() => {
    let alive=true;
    fetch('/api/auth/login-appearance',{cache:'no-store'})
      .then(async(r)=>{
        if(!r.ok)throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((body)=>{
        if(!alive)return;
        const x=body?.data||{};
        const next={
          design:String(x.design||'network4'),
          glow:String(x.glow||'violet'),
          mediaId:String(x.mediaId||''),
          opacity:Math.max(0,Math.min(1,Number(x.opacity??1)||1)),
          fit:['cover','contain','fill'].includes(String(x.fit||''))?String(x.fit):'cover'
        };
        setLoginAppearance(next);
        try{localStorage.setItem('SHINY_LOGIN_APPEARANCE_R55',JSON.stringify(next));}catch{}
      })
      .catch(()=>{});
    return ()=>{alive=false;};
  },[]);

  async function submit(e) {
    e.preventDefault();setLoading(true);setError('');
    try {
      const r = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      localStorage.setItem('SHINY_AUTH_TOKEN', r.data.token);
      localStorage.setItem('SHINY_AUTH_USER', JSON.stringify(r.data.user));

      const role = String(r.data?.user?.rol || '').toUpperCase();

      // GMX POS R11 — doble modalidad:
      // - Web normal: OPERADOR -> /admin/pos y Shiny solicita Fullscreen con un clic.
      // - Launcher/terminal kiosk: /login?kiosk=1 -> /admin/pos?kiosk=1.
      if (role === 'OPERADOR') {
        const kiosk = String(new URLSearchParams(location.search).get('kiosk') || '') === '1';
        nav(kiosk ? '/admin/pos?kiosk=1' : '/admin/pos', { replace: true, state: null });
        return;
      }

      const requested = String(location.state?.from || '');
      const target = requested.startsWith('/admin') ? requested : '/admin/dashboard';
      nav(target, { replace: true, state: null });
    } catch (e2) {
      const map = {
        INVALID_CREDENTIALS: 'Correo o contraseña incorrectos.',
        CREDENTIALS_REQUIRED: 'Escribe correo y contraseña.',
        TOO_MANY_ATTEMPTS: 'Demasiados intentos. Espera antes de volver a intentar.'
      };
      setError(map[e2.message] || e2.message);
    } finally {setLoading(false);}
  }

  return <main className={`login-page shiny-login-r55 design-${loginAppearance.design}`} data-login-glow={loginAppearance.glow}>
      <RpiWifiManager open={wifiManagerOpen} onClose={()=>setWifiManagerOpen(false)} />
      {loginAppearance.design==='custom' && loginAppearance.mediaId ?
        <img
          className="shiny-login-custom-background-r63m"
          src={`/api/auth/login-background?v=${encodeURIComponent(loginAppearance.mediaId)}`}
          alt=""
          aria-hidden="true"
          style={{
            opacity:loginAppearance.opacity,
            objectFit:loginAppearance.fit
          }}
        /> : null}
    <div className="shiny-login-network-r55" aria-hidden="true">
      <span className="shiny-login-orb-r55 orb-a" />
      <span className="shiny-login-orb-r55 orb-b" />
      <span className="shiny-login-orb-r55 orb-c" />
      <span className="shiny-login-line-r55 line-a" />
      <span className="shiny-login-line-r55 line-b" />
      <span className="shiny-login-line-r55 line-c" />
      <span className="shiny-login-node-r55 node-a" />
      <span className="shiny-login-node-r55 node-b" />
      <span className="shiny-login-node-r55 node-c" />
      <span className="shiny-login-node-r55 node-d" />
      <span className="shiny-login-node-r55 node-e" />
    </div>
    <form className="login-card" onSubmit={submit}>
      <BrandLogo compact className="login-dynamic-brand" />
      <div className="eyebrow">{brandText("GMX · ADMIN")}</div>
      <h1>Iniciar sesión</h1>
      <p>Acceso administrativo seguro.</p>
      {localWifiAllowed?<button type="button" className="gmx-login-wifi-button" onClick={()=>setWifiManagerOpen(true)}>Configurar Wi-Fi</button>:null}
      <label>Usuario<input type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} autoCapitalize="none" spellCheck={false} required /></label>
      <label>Contrase&ntilde;a<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
      {error ? <div className="alert error">{error}</div> : null}
      <button disabled={loading}>{loading ? 'Validando...' : 'Entrar'}</button>

    </form>
  </main>;
}
