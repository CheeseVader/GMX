import { brandText } from "../../config/brand.js";
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useClientAuth } from '../../contexts/ClientAuthContext.jsx';
import { publicApi, money } from '../../services/publicApi.js';
import { usePublicStore } from '../../contexts/PublicStoreContext.jsx';
import GeoSelectFields from '../../components/public/GeoSelectFields.jsx';
import '../../store_account_approved_r1.css';

const NAV = [
  ['summary','⌂','Resumen'],['orders','▣','Mis pedidos'],['points','◇','Mis puntos'],
  ['addresses','⌖','Direcciones'],['data','♙','Mis datos'],['security','♙','Seguridad'],
  ['preferences','⚙','Preferencias'],['favorites','♡','Favoritos']
];

function fmtDate(v){
  if(!v) return '—';
  try{return new Date(v).toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'});}catch{return String(v)}
}
function shortOrder(id=''){
  const m=String(id).match(/(\d{4,})/g); return m?.length ? `#${m[m.length-1].slice(-4)}` : String(id).replace(/^PED[-_]/i,'').slice(-8);
}
function paid(o){return /pagad|paid|complet/i.test(String(o?.estado_pago||''))}
function orderTone(o){return paid(o)?'ok':/cancel|rechaz/i.test(String(o?.estado_pago||o?.estado_pedido||''))?'bad':'warn'}

export default function StoreAccountPage() {
  const auth = useClientAuth();
  const nav = useNavigate();
  const { store } = usePublicStore();
  const [mode, setMode] = useState('login');
  const [tab,setTab] = useState('summary');
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', country: 'México', state: '', city: '', zip: '', settlement: '', address: '' });
  const [message, setMessage] = useState('');
  const [verificationUrl, setVerificationUrl] = useState('');
  const [orders, setOrders] = useState([]);
  const [loyalty, setLoyalty] = useState(null);
  const [addresses, setAddresses] = useState([]);
  const [memberships,setMemberships] = useState([]);
  const [tcgGames,setTcgGames] = useState([]);
  const [preferences,setPreferences] = useState({
    tcg_favoritos: [], promociones: true, lanzamientos: true, pedidos: true, idioma: 'es', moneda: 'mxn'
  });
  const [preferenceSaving,setPreferenceSaving] = useState(false);
  const [addressOpen,setAddressOpen] = useState(false);
  const [address, setAddress] = useState({ alias: 'Casa', nombre_receptor: '', telefono: '', address: '', city: '', state: '', zip: '', settlement: '', country: 'México', principal: true });
  const currency = store?.settings?.['public.store.currency'] || 'MXN';

  async function loadPrivate() {
    if (!auth.user) return;
    try {
      const [o,l,d,m,g,p] = await Promise.all([
        publicApi('/api/client/orders'),
        publicApi('/api/client/loyalty'),
        publicApi('/api/client/addresses'),
        publicApi('/api/client/memberships').catch(()=>({data:[]})),
        publicApi(`/api/public/tcg/games?_=${Date.now()}`).catch(()=>({data:[]})),
        publicApi('/api/client/preferences').catch(()=>({data:null}))
      ]);
      const games = Array.isArray(g.data) ? g.data : [];
      setOrders(o.data || []);
      setLoyalty(l.data || null);
      setAddresses(d.data || []);
      setMemberships(m.data || []);
      setTcgGames(games);
      const prefKey = `gmx-client-preferences:${auth.user?.id_cliente || auth.user?.email || 'guest'}`;
      let pref = {
        tcg_favoritos: [],
        promociones: true,
        lanzamientos: true,
        pedidos: true,
        idioma: 'es',
        moneda: 'mxn'
      };

      try {
        const saved = localStorage.getItem(prefKey);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed && typeof parsed === 'object') {
            pref = {
              tcg_favoritos: Array.isArray(parsed.tcg_favoritos) ? parsed.tcg_favoritos : [],
              promociones: parsed.promociones !== false,
              lanzamientos: parsed.lanzamientos !== false,
              pedidos: parsed.pedidos !== false,
              idioma: parsed.idioma || 'es',
              moneda: parsed.moneda || 'mxn'
            };
          }
        }
      } catch {}

      const validGameIds = new Set(games.map(x=>x.id_juego));
      pref.tcg_favoritos = pref.tcg_favoritos.filter(id=>validGameIds.has(id));

      setPreferences(pref);
    } catch (e) {setMessage(e.message);}
  }
  useEffect(() => {loadPrivate();}, [auth.user?.id_cliente]);

  function persistPreferences(next) {
    setPreferences(next);
    setPreferenceSaving(false);
    setMessage('');

    try {
      const prefKey = `gmx-client-preferences:${auth.user?.id_cliente || auth.user?.email || 'guest'}`;
      localStorage.setItem(prefKey,JSON.stringify(next));
      window.dispatchEvent(new CustomEvent('gmx:client-preferences-changed',{
        detail:{ key:prefKey, preferences:next }
      }));
    } catch (e) {
      console.error('[CLIENT_PREFERENCES_LOCAL_SAVE]',e);
    }
  }

  function toggleTcgFavorite(idJuego) {
    const current = Array.isArray(preferences.tcg_favoritos) ? preferences.tcg_favoritos : [];
    const exists = current.includes(idJuego);

    const next = {
      ...preferences,
      tcg_favoritos: exists
        ? current.filter(x=>x!==idJuego)
        : [...current,idJuego]
    };

    persistPreferences(next);
  }

  function changePreference(key,value) {
    persistPreferences({ ...preferences, [key]: value });
  }

  async function saveAddress(e) {
    e.preventDefault();setMessage('');
    try {
      const payload = { alias: address.alias, nombre_receptor: address.nombre_receptor, telefono: address.telefono,
        direccion: [address.address, address.settlement].filter(Boolean).join(', '), ciudad: address.city,
        estado: address.state, cp: address.zip, pais: address.country || 'México', principal: address.principal };
      await publicApi('/api/client/addresses', { method: 'POST', body: JSON.stringify(payload) });
      setMessage('Dirección guardada.'); setAddressOpen(false);
      const d = await publicApi('/api/client/addresses');setAddresses(d.data || []);
      setAddress((x) => ({ ...x, address: '', zip: '', settlement: '' }));
    } catch (e2) {setMessage(e2.message);}
  }

  async function submit(e) {
    e.preventDefault();setMessage('');setVerificationUrl('');
    try {
      if (mode === 'login') { await auth.login(form.email, form.password); setMessage('Sesión iniciada.'); }
      else {
        const result = await auth.register(form);
        setMessage(`Cuenta creada. Enviamos un correo de confirmación a ${result?.email || form.email}. Debes confirmar tu correo antes de iniciar sesión.`);
        if (result?.development_verification_url) setVerificationUrl(result.development_verification_url);
      }
    } catch (e2) {
      const map = {
        EMAIL_NOT_VERIFIED:'Debes confirmar tu correo electrónico antes de iniciar sesión.',
        CLIENT_ACCOUNT_EXISTS:'Ya existe una cuenta con ese correo. Inicia sesión o recupera tu cuenta.',
        CLIENT_EMAIL_ALREADY_REGISTERED:'Ya existe una cuenta asociada a ese correo. Inicia sesión o recupera tu cuenta.',
        CLIENT_PHONE_ALREADY_REGISTERED:'Ya existe una cuenta asociada a ese número de teléfono. Inicia sesión o recupera tu cuenta.',
        CLIENT_IDENTITY_EXISTS:'Los datos proporcionados ya están asociados a una cuenta existente. Inicia sesión o recupera tu cuenta.',
        CUSTOMER_IDENTITY_CONFLICT:'El correo y teléfono proporcionados pertenecen a registros distintos. Contacta a soporte para validar tu identidad.',
        INVALID_CLIENT_CREDENTIALS:'Correo o contraseña incorrectos.'
      };
      const raw = String(e2?.code || e2?.error || e2?.message || '');
      const knownCode = Object.keys(map).find(code=>raw.includes(code));
      if (knownCode) setMessage(map[knownCode]);
      else if (mode === 'register' && /409|duplicate|duplicad|already exists|unique/i.test(raw))
        setMessage('Ya existe una cuenta con esos datos. Inicia sesión o recupera tu cuenta.');
      else
        setMessage(raw || (mode === 'register' ? 'No fue posible crear la cuenta.' : 'No fue posible iniciar sesión.'));
    }
  }

  if (auth.loading) return <main className="public-page"><div className="public-empty">Cargando cuenta…</div></main>;

  if (!auth.user) return <main className="public-page">
    <div className="public-page-head"><small>{brandText("CUENTA GMX")}</small><h1>{mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}</h1><p>Tu cuenta de cliente es independiente del acceso administrativo.</p></div>
    {message ? <div className="checkout-message">{message}</div> : null}
    {verificationUrl ? <div className="dev-verification"><b>Modo local:</b> si SMTP todavía no está configurado, puedes probar la confirmación con <a href={verificationUrl}>este enlace</a>.</div> : null}
    <div className="client-auth-shell">
      <div className="client-auth-switch"><button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Iniciar sesión</button><button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Crear cuenta</button></div>
      <form className="client-auth-card" onSubmit={submit}>
        {mode === 'register' ? <><label>Nombre completo<input required value={form.name} onChange={(e) => setForm((x) => ({ ...x, name: e.target.value }))} /></label><label>Teléfono<input required value={form.phone} onChange={(e) => setForm((x) => ({ ...x, phone: e.target.value }))} /></label></> : null}
        <label>Email<input required type="email" value={form.email} onChange={(e) => setForm((x) => ({ ...x, email: e.target.value }))} /></label>
        <label>Contraseña<input required type="password" minLength="8" value={form.password} onChange={(e) => setForm((x) => ({ ...x, password: e.target.value }))} /><small>Mínimo 8 caracteres, con letras y números.</small></label>
        {mode === 'register' ? <><h3>Dirección principal</h3><GeoSelectFields value={form} onChange={setForm} /></> : null}
        <button>{mode === 'login' ? 'Entrar' : 'Crear mi cuenta'}</button>
        {mode === 'login' ? <Link className="forgot-password-link" to="/tienda/recuperar-cuenta">¿Olvidaste tu contraseña? Recuperar cuenta</Link> : null}
      </form>
    </div>
  </main>;

  const points = Number(loyalty?.account?.puntos_disponibles || 0);
  const pointValue = Number(store?.settings?.['loyalty.point_value_mxn'] || .1);
  const principal = addresses.find(x=>x.principal) || addresses[0];
  const activeMembership = memberships.find(x=>String(x.estado||'').toUpperCase()==='ACTIVA') || memberships[0];
  const memberName = activeMembership?.nombre || 'GMX Free';
  const paidCount = orders.filter(paid).length;
  const pendingCount = orders.length-paidCount;
  const recentOrders = orders.slice(0,3);
  const movements = loyalty?.movements || [];
  const earned = movements.filter(x=>Number(x.puntos)>0).reduce((a,x)=>a+Number(x.puntos||0),0);
  const spent = Math.abs(movements.filter(x=>Number(x.puntos)<0).reduce((a,x)=>a+Number(x.puntos||0),0));
  const favoriteIds = Array.isArray(preferences.tcg_favoritos) ? preferences.tcg_favoritos : [];

  const OrderRow=({o})=><Link className="gmx-acct-order" to={`/tienda/pedido/${o.public_token}`}>
    <div className="gmx-acct-order-main"><b>Pedido {shortOrder(o.id_pedido)}</b><small>{fmtDate(o.fecha)}</small></div>
    <span className={`gmx-acct-status ${orderTone(o)}`}>{paid(o)?'PAGADO':String(o.estado_pago||'PAGO PENDIENTE').toUpperCase()}</span>
    <small className="gmx-acct-order-stage">{o.estado_pedido || 'En proceso'}</small>
    <strong>{money(o.total,currency)}</strong><em>Ver detalle</em>
  </Link>;

  const Sidebar=()=> <aside className="gmx-acct-side"><b>Mi cuenta</b>{NAV.map(([id,ico,label])=><button key={id} type="button" className={tab===id?'active':''} onClick={()=>setTab(id)}><span>{ico}</span>{label}</button>)}<button type="button" onClick={auth.logout}><span>↪</span>Cerrar sesión</button></aside>;

  return <main className="public-page gmx-acct-r1">
    <div className="gmx-acct-shell"><Sidebar/><section className="gmx-acct-content">
      {message ? <div className="checkout-message">{message}</div> : null}

      {tab==='summary' && <>
        <header className="gmx-acct-title"><div><h1>Hola, {auth.user.nombre || auth.user.email} <span>👋</span></h1><p>Cliente GMX desde agosto 2026</p></div><button type="button" onClick={()=>setTab('data')}>Editar perfil</button></header>
        <div className="gmx-acct-metrics four">
          <article><strong>{points.toLocaleString('es-MX')} pts</strong><span>Puntos disponibles</span><small>≈ {money(points*pointValue,currency)}</small><button onClick={()=>setTab('points')}>Ver puntos</button></article>
          <article><strong>{pendingCount}</strong><span>Pedido activo</span><small>{orders.length} completados</small><button onClick={()=>setTab('orders')}>Ver pedidos</button></article>
          <article><strong>{memberName}</strong><span>Membresía actual</span><small>{activeMembership?.estado || 'Gratis'}</small><Link to="/tienda/membresias">Ver beneficios</Link></article>
          <article><strong>0</strong><span>Favoritos</span><small>Guardados</small><button onClick={()=>setTab('favorites')}>Ver lista</button></article>
        </div>
        <div className="gmx-acct-summary-grid"><article className="gmx-acct-card"><h2>Pedidos recientes</h2>{recentOrders.length?recentOrders.map(o=><OrderRow key={o.id_pedido} o={o}/>):<div className="gmx-acct-empty">Aún no tienes pedidos.</div>}</article><div className="gmx-acct-stack"><article className="gmx-acct-card mini"><h3>Dirección principal</h3>{principal?<><b>{principal.alias||'Casa'}</b><span>{principal.ciudad}, {principal.estado}</span><small>C.P. {principal.cp||'—'}</small></>:<span>Sin dirección registrada</span>}<button onClick={()=>setTab('addresses')}>Editar</button></article><article className="gmx-acct-card mini"><h3>Tu membresía</h3><strong>{memberName}</strong><span>{activeMembership?.estado||'Consulta beneficios y descuentos'}</span><Link to="/tienda/membresias">Ver membresías</Link></article></div></div>
      </>}

      {tab==='orders' && <><header className="gmx-acct-section-head"><h1>Mis pedidos</h1></header><div className="gmx-acct-order-layout"><article className="gmx-acct-card"><div className="gmx-acct-order-tabs"><b>Todos</b><span>Pendientes</span><span>Pagados</span><span>Enviados</span><span>Completados</span><span>Cancelados</span></div>{orders.length?orders.map(o=><OrderRow key={o.id_pedido} o={o}/>):<div className="gmx-acct-empty">Aún no tienes pedidos.</div>}</article><aside className="gmx-acct-stack"><article className="gmx-acct-card mini"><h3>Resumen de pedidos</h3><span>Total pedidos</span><strong>{orders.length}</strong><span>Total gastado</span><strong>{money(orders.filter(paid).reduce((a,o)=>a+Number(o.total||0),0),currency)}</strong><span>Pedidos este mes</span><strong>{orders.length}</strong></article><article className="gmx-acct-card mini"><h3>¿Necesitas ayuda?</h3><span>Contacta a soporte</span><b>Abrir ticket</b></article></aside></div></>}

      {tab==='points' && <><header className="gmx-acct-section-head"><h1>Mis puntos</h1></header><div className="gmx-acct-points-top"><article className="gmx-acct-card points"><strong>{points.toLocaleString('es-MX')} pts</strong><span>Disponibles</span><small>≈ {money(points*pointValue,currency)}</small><div className="gmx-acct-coins">◉ ◉<br/>◉</div><button type="button">Canjear puntos</button></article><article className="gmx-acct-card stats"><h3>Resumen</h3><p><span>Ganados</span><b>{earned.toLocaleString('es-MX')} pts</b></p><p><span>Utilizados</span><b>-{spent.toLocaleString('es-MX')} pts</b></p><p><span>Vencen pronto</span><b>0 pts</b></p><em>Ver detalles</em></article></div><article className="gmx-acct-card"><h2>Historial de puntos</h2><div className="gmx-acct-ledger"><div className="head"><span>Fecha</span><span>Concepto</span><span>Movimiento</span><span>Saldo</span></div>{movements.map((m,i)=><div key={`${m.fecha}-${i}`}><span>{fmtDate(m.fecha)}</span><span>{m.id_pedido?`Compra ${shortOrder(m.id_pedido)}`:(m.motivo||m.tipo)}</span><b className={Number(m.puntos)>=0?'plus':'minus'}>{Number(m.puntos)>=0?'+':''}{Number(m.puntos)} pts</b><span>{Number(m.saldo_nuevo||0).toLocaleString('es-MX')} pts</span></div>)}</div></article></>}

      {tab==='addresses' && <><header className="gmx-acct-section-head"><h1>Mis direcciones</h1><button type="button" onClick={()=>setAddressOpen(v=>!v)}>＋ Agregar dirección</button></header><div className="gmx-acct-address-grid">{addresses.map(d=><article className="gmx-acct-card address" key={d.id_direccion}>{d.principal?<em>Principal</em>:null}<h3>{d.alias||'Dirección'}</h3><b>{d.nombre_receptor||auth.user.nombre}</b><span>{d.direccion}</span><span>{[d.ciudad,d.estado].filter(Boolean).join(', ')}</span><small>C.P. {d.cp||'—'} · México</small><small>Tel. {d.telefono||'—'}</small></article>)}</div>{addressOpen?<form className="gmx-acct-card gmx-acct-address-form" onSubmit={saveAddress}><label>Alias<input value={address.alias} onChange={e=>setAddress(x=>({...x,alias:e.target.value}))}/></label><label>Nombre receptor<input value={address.nombre_receptor} onChange={e=>setAddress(x=>({...x,nombre_receptor:e.target.value}))}/></label><label>Teléfono<input value={address.telefono} onChange={e=>setAddress(x=>({...x,telefono:e.target.value}))}/></label><GeoSelectFields value={address} onChange={setAddress}/><label className="check"><input type="checkbox" checked={address.principal} onChange={e=>setAddress(x=>({...x,principal:e.target.checked}))}/> Usar como principal</label><button>Guardar dirección</button></form>:null}</>}

      {tab==='data' && <><header className="gmx-acct-section-head"><h1>Mis datos</h1></header><article className="gmx-acct-card"><h3>Información personal</h3><div className="gmx-acct-data-grid"><label>Nombre(s)<input value={auth.user.nombre||''} readOnly/></label><label>Apellido paterno<input value="" readOnly/></label><label>Apellido materno<input value="" readOnly/></label><label>Teléfono<input value={auth.user.telefono||''} readOnly/></label><label className="wide">Correo electrónico<div className="gmx-acct-verified"><input value={auth.user.email||''} readOnly/><b>Verificado</b></div></label><label>Fecha de nacimiento<input value="" readOnly placeholder="dd/mm/aaaa"/></label></div></article></>}

      {tab==='security' && <><header className="gmx-acct-section-head"><h1>Seguridad</h1></header><article className="gmx-acct-card gmx-acct-security-row"><div><h3>Cambiar contraseña</h3><span>Administra la contraseña de acceso a tu cuenta.</span></div><button onClick={()=>nav('/tienda/recuperar-cuenta')}>Cambiar contraseña</button></article><article className="gmx-acct-card gmx-acct-security-row"><div><h3>Sesiones activas</h3><b>Navegador actual</b><span>Sesión de cliente GMX · Actual</span></div><button onClick={auth.logout}>Cerrar sesión</button></article><article className="gmx-acct-card gmx-acct-security-row"><div><h3>Verificación en dos pasos (2FA)</h3><span>Protege tu cuenta con una capa adicional de seguridad.</span></div><button type="button" disabled>Activar 2FA</button></article></>}

      {tab==='preferences' && <><header className="gmx-acct-section-head"><h1>Preferencias</h1></header><article className="gmx-acct-card"><h3>TCG favoritos</h3><div className="gmx-acct-chips">
        {tcgGames.map(g=>{
          const selected=favoriteIds.includes(g.id_juego);
          return <button
            type="button"
            key={g.id_juego}
            className={selected?'selected':'available'}
            aria-pressed={selected}
            disabled={preferenceSaving}
            onClick={()=>toggleTcgFavorite(g.id_juego)}
          >{selected?'✓':'＋'} {g.nombre}</button>;
        })}
      </div></article><article className="gmx-acct-card"><h3>Comunicación</h3><div className="gmx-acct-pref">
        <span>Recibir promociones y ofertas</span><input type="checkbox" checked={preferences.promociones} disabled={preferenceSaving} onChange={e=>changePreference('promociones',e.target.checked)}/>
        <span>Nuevos lanzamientos y noticias</span><input type="checkbox" checked={preferences.lanzamientos} disabled={preferenceSaving} onChange={e=>changePreference('lanzamientos',e.target.checked)}/>
        <span>Actualizaciones de pedidos</span><input type="checkbox" checked={preferences.pedidos} disabled={preferenceSaving} onChange={e=>changePreference('pedidos',e.target.checked)}/>
      </div></article></>}

      {tab==='favorites' && <><header className="gmx-acct-section-head"><h1>Favoritos</h1></header><article className="gmx-acct-card"><div className="gmx-acct-empty">No tienes favoritos guardados.</div></article></>}
    </section></div>
  </main>;
}





