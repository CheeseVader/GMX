import { brandText } from "../config/brand.js";import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router';
import { api } from '../services/api.js';
import SystemAccessUrlsPanel from '../components/SystemAccessUrlsPanel.jsx';
import '../phase_shiny_exact_views_r23.css';
import '../system_sys_h_r2.css';

export default function SystemPage() {
  const { health, refreshHealth } = useOutletContext();
  const [settings, setSettings] = useState({
    'public.payment.transfer.bank_name': '',
    'public.payment.transfer.account_holder': '',
    'public.payment.transfer.account_number': '',
    'public.payment.transfer.clabe': '',
    'public.payment.transfer.instructions': 'Usa tu número de comprobante como referencia.'
  });
  const [message, setMessage] = useState('');
  const currentAdmin = (() => {try {return JSON.parse(localStorage.getItem('Shiny_AUTH_USER') || '{}');} catch {return {};}})();
  const isSuperadmin = String(currentAdmin.rol || '').toUpperCase() === 'SUPERADMIN';
  const [technical, setTechnical] = useState(null);
  const [technicalBusy, setTechnicalBusy] = useState(false);
  const [technicalTab, setTechnicalTab] = useState('overview');
  const [businessSettings, setBusinessSettings] = useState({
    'store.currency': 'MXN', 'store.locale': 'es-MX',
    'alerts.low_stock_threshold': '5', 'alerts.low_stock_enabled': 'true'
  });
  const [businessSaving, setBusinessSaving] = useState(false);
  const [fxData, setFxData] = useState({ config: {}, effective: null, history: [] });
  const [fxForm, setFxForm] = useState({
    banxicoEnabled: true, banxicoToken: '', clearBanxicoToken: false,
    tijuanaEnabled: true, priority: 'TIJUANA_THEN_BANXICO', maxAgeDays: 3, blockIfStale: true
  });
  const [tijuanaRate, setTijuanaRate] = useState('');
  const [tijuanaDate, setTijuanaDate] = useState(new Date().toISOString().slice(0, 10));
  const [fxBusy, setFxBusy] = useState(false);
  const [smtp, setSmtp] = useState({
    enabled: true, provider: 'GMAIL', host: 'smtp.gmail.com', port: 587, secure: false,
    user: '', password: '', fromEmail: '', fromName: brandText("GMX")
  });
  const [smtpStatus, setSmtpStatus] = useState({ configured: false, passwordConfigured: false });
  const [smtpTestEmail, setSmtpTestEmail] = useState('');
  const [smtpBusy, setSmtpBusy] = useState(false);
  const [smtpAction, setSmtpAction] = useState('');
  const [smtpProgress, setSmtpProgress] = useState(0);
  const [systemSection, setSystemSection] = useState('general');

  useEffect(() => {
    api('/api/v1/content/settings').then((r) => {
      const found = Object.fromEntries((r.data || []).map((x) => [x.parametro, x.valor]));
      setSettings((x) => ({ ...x, ...found }));
    }).catch(() => {});
    loadFx().catch(() => {});
    loadSmtp().catch(() => {});
  }, []);

  async function loadFx() {
    const r = await api('/api/v1/content/finance/fx');
    setFxData(r.data || { config: {}, effective: null, history: [] });
    setFxForm((x) => ({ ...x, ...(r.data?.config || {}), banxicoToken: '', clearBanxicoToken: false }));
  }

  async function saveFxConfig() {
    setFxBusy(true);
    try {
      await api('/api/v1/content/finance/fx/config', { method: 'PUT', body: JSON.stringify(fxForm) });
      setMessage('Configuración financiera guardada.');
      await loadFx();
    } catch (e) {setMessage(e.message);} finally
    {setFxBusy(false);}
  }

  async function saveBanxicoToken() {
    const token = String(fxForm.banxicoToken || '').trim();
    if (!token) {
      setMessage('Captura el token SIE antes de guardarlo.');
      return;
    }
    setFxBusy(true);
    try {
      await api('/api/v1/content/finance/fx/banxico/token', {
        method: 'PUT', body: JSON.stringify({ token })
      });
      setFxForm((x) => ({ ...x, banxicoToken: '' }));
      setMessage('Token SIE guardado correctamente. Ya puedes actualizar Banco de México.');
      await loadFx();
    } catch (e) {setMessage(e.message);} finally
    {setFxBusy(false);}
  }

  async function refreshBanxico() {
    if (!fxData.config?.banxicoTokenConfigured) {
      setMessage('Guarda primero el token SIE de Banco de México.');
      return;
    }
    setFxBusy(true);
    try {
      const r = await api('/api/v1/content/finance/fx/banxico/refresh', { method: 'POST', body: '{}' });
      setMessage(`Banco de México actualizado: ${Number(r.data.rate).toFixed(4)} MXN/USD · ${r.data.rate_date}.`);
      await loadFx();
    } catch (e) {setMessage(e.message);} finally
    {setFxBusy(false);}
  }

  async function saveTijuana() {
    setFxBusy(true);
    try {
      const r = await api('/api/v1/content/finance/fx/tijuana', { method: 'POST', body: JSON.stringify({
          rate: Number(tijuanaRate), rateDate: tijuanaDate, notes: 'TC operativo desde Configuración'
        }) });
      setTijuanaRate('');
      setMessage(`TC operativo Tijuana guardado: ${Number(r.data.rate).toFixed(4)} MXN/USD.`);
      await loadFx();
    } catch (e) {setMessage(e.message);} finally
    {setFxBusy(false);}
  }

  async function loadSmtp() {
    const r = await api('/api/v1/content/email/smtp');
    const d = r.data || {};
    setSmtpStatus(d);
    setSmtp((x) => ({
      ...x,
      enabled: d.enabled !== false,
      provider: d.provider || x.provider || 'CUSTOM',
      host: d.host || x.host || '',
      port: Number(d.port || 587),
      secure: d.secure === true,
      user: d.user || '',
      password: '',
      fromEmail: d.fromEmail || '',
      fromName: d.fromName || brandText("GMX")
    }));
    if (!smtpTestEmail && d.fromEmail) setSmtpTestEmail(d.fromEmail);
  }

  async function persistSmtpConfig({ silent = false } = {}) {
    const r = await api('/api/v1/content/email/smtp', {
      method: 'PUT',
      body: JSON.stringify(smtp)
    });
    setSmtpStatus(r.data || {});
    setSmtp((x) => ({ ...x, password: '' }));
    if (!silent) setMessage('Configuración SMTP guardada correctamente.');
    return r.data || {};
  }

  async function saveSmtp() {
    setSmtpBusy(true);
    setSmtpAction('GUARDANDO');
    setSmtpProgress(15);
    try {
      await persistSmtpConfig();
      setSmtpProgress(100);
    } catch (e) {
      setMessage(e.message);
    } finally {
      setTimeout(() => {
        setSmtpBusy(false);
        setSmtpAction('');
        setSmtpProgress(0);
      }, 250);
    }
  }

  async function testSmtp() {
    const to = String(smtpTestEmail || '').trim();
    if (!to) {
      setMessage('Captura un correo destinatario para la prueba.');
      return;
    }

    setSmtpBusy(true);
    setSmtpAction('PROBANDO');
    setSmtpProgress(8);
    setMessage('');

    try {
      // Si el usuario escribió o cambió credenciales, se guardan antes de la prueba.
      const hasUnsavedPassword = String(smtp.password || '').length > 0;
      const needsSave = !smtpStatus.configured || hasUnsavedPassword;

      if (needsSave) {
        setSmtpAction('GUARDANDO_Y_PROBANDO');
        setSmtpProgress(22);
        await persistSmtpConfig({ silent: true });
        setSmtpProgress(48);
      }

      setSmtpAction('ENVIANDO');
      setSmtpProgress(62);

      const r = await api('/api/v1/content/email/smtp/test', {
        method: 'POST',
        body: JSON.stringify({ to })
      });

      setSmtpProgress(100);
      setSmtpAction('ENVIADO');
      setMessage(`Correo de prueba enviado correctamente a ${r.data.to}.`);
      await loadSmtp();
    } catch (e) {
      setSmtpAction('ERROR');
      setSmtpProgress(100);
      setMessage(e.message);
    } finally {
      setTimeout(() => {
        setSmtpBusy(false);
        setSmtpAction('');
        setSmtpProgress(0);
      }, 500);
    }
  }

  async function savePayments() {
    try {
      const payload = Object.fromEntries(Object.entries(settings).filter(([k]) => k.startsWith('public.payment.transfer.')));
      await api('/api/v1/content/settings', { method: 'PUT', body: JSON.stringify(payload) });
      setMessage('Configuración bancaria guardada.');
    } catch (e) {setMessage(e.message);}
  }

  async function saveStoreContact() {
    try {
      const email = String(settings['public.store.contact.email'] || '').trim();
      const phone = String(settings['public.store.contact.phone'] || '').trim();
      const whatsapp = String(settings['public.store.contact.whatsapp'] || '').trim();
      const hours = String(settings['public.store.contact.hours'] || '').trim();

      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setMessage('Captura un correo de contacto valido.');
        return;
      }

      if (phone && phone.replace(/\D/g, '').length < 10) {
        setMessage('El telefono de contacto debe contener al menos 10 digitos.');
        return;
      }

      if (whatsapp && whatsapp.replace(/\D/g, '').length < 10) {
        setMessage('El numero de WhatsApp debe contener al menos 10 digitos.');
        return;
      }

      const payload = {
        'public.store.contact.email': email,
        'public.store.contact.phone': phone,
        'public.store.contact.whatsapp': whatsapp,
        'public.store.contact.hours': hours,
        'public.store.contact.show_email': String(settings['public.store.contact.show_email'] !== 'false'),
        'public.store.contact.show_phone': String(settings['public.store.contact.show_phone'] !== 'false'),
        'public.store.contact.show_whatsapp': String(settings['public.store.contact.show_whatsapp'] !== 'false'),
        'public.store.contact.show_hours': String(settings['public.store.contact.show_hours'] !== 'false')
      };

      await api('/api/v1/content/settings', {
        method: 'PUT',
        body: JSON.stringify(payload)
      });

      setMessage('Datos de contacto de la tienda guardados.');
    } catch (e) {
      setMessage(e.message);
    }
  }
  async function saveBusinessSettings() {
    setBusinessSaving(true);
    try {
      const payload = {
        'store.currency': businessSettings['store.currency'] || 'MXN',
        'store.locale': businessSettings['store.locale'] || 'es-MX',
        'alerts.low_stock_threshold': String(Math.max(0, Number(businessSettings['alerts.low_stock_threshold'] || 0))),
        'alerts.low_stock_enabled': String(businessSettings['alerts.low_stock_enabled'] === 'true')
      };
      await api('/api/v1/content/settings', { method: 'PUT', body: JSON.stringify(payload) });
      setMessage('Configuración operativa guardada.');
    } catch (e) {setMessage(e.message);} finally
    {setBusinessSaving(false);}
  }

  async function loadTechnical() {
    if (!isSuperadmin) return;
    setTechnicalBusy(true);
    try {
      const r = await api('/api/v1/admin/technical/diagnostic');
      setTechnical(r.data || null);
      setMessage('Diagnóstico técnico actualizado.');
    } catch (e) {setMessage(e.message);} finally
    {setTechnicalBusy(false);}
  }

  const apiOk = health?.success === true;
  const dbOk = Boolean(health?.database?.database);
  const schemaOk = Boolean(health?.database?.schema);
  const modeOk = Boolean(health?.mode);
  const serviceChecks = [apiOk, dbOk, schemaOk, modeOk];
  const serviceOkCount = serviceChecks.filter(Boolean).length;
  const serviceWarnCount = serviceChecks.length - serviceOkCount;
  const servicePct = Math.round(serviceOkCount / serviceChecks.length * 100);
  const dbLatency = Number(health?.db_ms);
  const latencyPct = Number.isFinite(dbLatency) ? Math.max(30, Math.min(100, Math.round(100 - Math.max(0, dbLatency - 5) * 1.5))) : 0;

  return <div className="system-admin-page r23-view r23-system sysh-r2">
    {message ? <div className="message">{message}</div> : null}

    <section className="sysh-overview">
      <div className="sysh-kpi-grid">
        <article className="sysh-kpi">
          <div className="sysh-kpi-icon">⚙</div><div><span>API</span><strong className={apiOk ? 'is-ok' : 'is-bad'}>{apiOk ? 'Disponible' : 'Sin conexión'}</strong><small><i className={apiOk ? 'ok' : 'bad'} />{apiOk ? 'En funcionamiento' : 'Requiere atención'}</small></div>
        </article>
        <article className="sysh-kpi">
          <div className="sysh-kpi-icon">▣</div><div><span>Base de datos</span><strong>{health?.database?.database || '—'}</strong><small><i className={dbOk ? 'ok' : 'bad'} />{dbOk ? 'Conectada' : 'Sin conexión'}</small></div>
        </article>
        <article className="sysh-kpi">
          <div className="sysh-kpi-icon">⌁</div><div><span>Latencia DB</span><strong>{health?.db_ms != null ? `${health.db_ms} ms` : '—'}</strong><small><i className={latencyPct >= 70 ? 'ok' : 'warn'} />{latencyPct >= 90 ? 'Óptima' : latencyPct >= 70 ? 'Estable' : 'Revisar'}</small></div>
        </article>
        <article className="sysh-kpi">
          <div className="sysh-kpi-icon">◇</div><div><span>Modo</span><strong>{health?.mode || '—'}</strong><small><i className={modeOk ? 'ok' : 'warn'} />{modeOk ? 'Activo' : 'No informado'}</small></div>
        </article>
      </div>

      <div className="sysh-health-grid">
        <section className="sysh-panel sysh-services">
          <div className="sysh-panel-head"><div><span className="sysh-eyebrow">DIAGNÓSTICO LOCAL</span><h2>Estado de los servicios</h2></div><button className="secondary sysh-refresh" onClick={refreshHealth}>Actualizar</button></div>
          <div className="sysh-services-body">
            <div className="sysh-donut" style={{'--ok': `${servicePct * 3.6}deg`}}><div><strong>{serviceChecks.length}</strong><span>TOTAL</span></div></div>
            <div className="sysh-legend">
              <div><span><i className="ok" />Operativos</span><b>{serviceOkCount}</b><em>{servicePct}%</em></div>
              <div><span><i className="warn" />Con advertencia</span><b>{serviceWarnCount}</b><em>{100 - servicePct}%</em></div>
              <div><span><i className="bad" />Fuera de servicio</span><b>{apiOk ? 0 : 1}</b><em>{apiOk ? '0%' : '25%'}</em></div>
            </div>
          </div>
        </section>

        <section className="sysh-panel sysh-health">
          <div className="sysh-panel-head"><div><span className="sysh-eyebrow">SALUD DEL SISTEMA</span><h2>Salud del sistema</h2></div></div>
          <div className="sysh-bars">
            <div><span>API</span><div><i style={{width: apiOk ? '100%' : '12%'}} /></div><b>{apiOk ? '100%' : '0%'}</b></div>
            <div><span>Base de datos</span><div><i style={{width: dbOk ? '100%' : '12%'}} /></div><b>{dbOk ? '100%' : '0%'}</b></div>
            <div><span>Conectividad</span><div><i style={{width: `${latencyPct}%`}} /></div><b>{latencyPct}%</b></div>
          </div>
          <div className={`sysh-health-note ${apiOk && dbOk ? 'good' : 'warn'}`}><span>{apiOk && dbOk ? '✓' : '!'}</span>{apiOk && dbOk ? 'Todos los sistemas principales están funcionando correctamente.' : 'Hay servicios que requieren atención.'}</div>
          <div className="sysh-tech-strip"><span>PostgreSQL <b>{health?.database?.db_user || '—'}</b></span><span>Schema <b>{health?.database?.schema || '—'}</b></span></div>
        </section>
      </div>
    </section>

    <SystemAccessUrlsPanel />

    <nav className="system-section-tabs" aria-label="Secciones de configuración">
      <button className={systemSection === 'general' ? 'active' : ''} onClick={() => setSystemSection('general')}>Operación general</button>
      <button className={systemSection === 'contact' ? 'active' : ''} onClick={() => setSystemSection('contact')}>Contacto / Tienda</button>
      <button className={systemSection === 'payments' ? 'active' : ''} onClick={() => setSystemSection('payments')}>Pagos</button>
      <button className={systemSection === 'email' ? 'active' : ''} onClick={() => setSystemSection('email')}>Correo</button>
      <button className={systemSection === 'fx' ? 'active' : ''} onClick={() => setSystemSection('fx')}>Tipo de cambio</button>
      {isSuperadmin ? <button className={systemSection === 'diagnostic' ? 'active' : ''} onClick={() => setSystemSection('diagnostic')}>Diagnóstico técnico</button> : null}
    </nav>

    {systemSection === 'contact' ? <section className="content-card system-business-settings">
      <div className="section-head">
        <div>
          <div className="eyebrow">DATOS PUBLICOS DE CONTACTO</div>
          <h2>Contacto de la tienda</h2>
          <p className="section-copy">Estos datos se muestran en el footer de la tienda publica. Puedes editar, ocultar o dejar vacio cualquier medio de contacto.</p>
        </div>
        <button onClick={saveStoreContact}>Guardar contacto</button>
      </div>

      <div className="system-settings-grid">
        <label>Correo electronico
          <input
            type="email"
            value={settings['public.store.contact.email'] || ''}
            onChange={(e) => setSettings((x) => ({...x,'public.store.contact.email':e.target.value}))}
            placeholder="ventas@dominio.com"
          />
        </label>

        <label>Telefono
          <input
            value={settings['public.store.contact.phone'] || ''}
            onChange={(e) => setSettings((x) => ({...x,'public.store.contact.phone':e.target.value}))}
            placeholder="+52 664 123 4567"
          />
        </label>

        <label>WhatsApp
          <input
            value={settings['public.store.contact.whatsapp'] || ''}
            onChange={(e) => setSettings((x) => ({...x,'public.store.contact.whatsapp':e.target.value}))}
            placeholder="+52 664 123 4567"
          />
        </label>

        <label>Horario de atencion
          <input
            value={settings['public.store.contact.hours'] || ''}
            onChange={(e) => setSettings((x) => ({...x,'public.store.contact.hours':e.target.value}))}
            placeholder="Lun-Sab 10:00-19:00"
          />
        </label>

        <label className="system-check-setting">
          <input
            type="checkbox"
            checked={settings['public.store.contact.show_email'] !== 'false'}
            onChange={(e) => setSettings((x) => ({...x,'public.store.contact.show_email':String(e.target.checked)}))}
          />
          <span>Mostrar correo en la tienda</span>
        </label>

        <label className="system-check-setting">
          <input
            type="checkbox"
            checked={settings['public.store.contact.show_phone'] !== 'false'}
            onChange={(e) => setSettings((x) => ({...x,'public.store.contact.show_phone':String(e.target.checked)}))}
          />
          <span>Mostrar telefono en la tienda</span>
        </label>

        <label className="system-check-setting">
          <input
            type="checkbox"
            checked={settings['public.store.contact.show_whatsapp'] !== 'false'}
            onChange={(e) => setSettings((x) => ({...x,'public.store.contact.show_whatsapp':String(e.target.checked)}))}
          />
          <span>Mostrar WhatsApp en la tienda</span>
        </label>

        <label className="system-check-setting">
          <input
            type="checkbox"
            checked={settings['public.store.contact.show_hours'] !== 'false'}
            onChange={(e) => setSettings((x) => ({...x,'public.store.contact.show_hours':String(e.target.checked)}))}
          />
          <span>Mostrar horario en la tienda</span>
        </label>
      </div>

      <p className="system-settings-note">WhatsApp abre una conversacion directa; telefono usa enlace de llamada y correo abre el cliente de correo del usuario.</p>
    </section> : null}
    {systemSection === 'general' ? <section className="content-card system-business-settings">
      <div className="section-head">
        <div>
          <div className="eyebrow">CONFIGURACIÓN GLOBAL</div>
          <h2>Operación general</h2>
          <p className="section-copy">Parámetros globales del negocio. Se administran aquí para evitar duplicarlos en Contenido / Marketing.</p>
        </div>
        <button disabled={businessSaving} onClick={saveBusinessSettings}>{businessSaving ? 'Guardando…' : 'Guardar configuración'}</button>
      </div>
      <div className="system-settings-grid">
        <label>Moneda
          <select value={businessSettings['store.currency'] || 'MXN'} onChange={(e) => setBusinessSettings((x) => ({ ...x, 'store.currency': e.target.value }))}>
            <option>MXN</option><option>USD</option>
          </select>
        </label>
        <label>Idioma / locale
          <select value={businessSettings['store.locale'] || 'es-MX'} onChange={(e) => setBusinessSettings((x) => ({ ...x, 'store.locale': e.target.value }))}>
            <option value="es-MX">Español (México)</option><option value="en-US">English (US)</option>
          </select>
        </label>
        <label>Umbral global de stock bajo
          <input type="number" min="0" value={businessSettings['alerts.low_stock_threshold'] || '5'} onChange={(e) => setBusinessSettings((x) => ({ ...x, 'alerts.low_stock_threshold': e.target.value }))} />
        </label>
        <label className="system-check-setting">
          <input type="checkbox" checked={businessSettings['alerts.low_stock_enabled'] === 'true'} onChange={(e) => setBusinessSettings((x) => ({ ...x, 'alerts.low_stock_enabled': String(e.target.checked) }))} />
          <span>Generar alertas de stock bajo</span>
        </label>
      </div>
      <p className="system-settings-note">Las alertas se consultan y gestionan desde Notificaciones / Alertas; aquí únicamente se define su comportamiento global.</p>
    </section> : null}

    {isSuperadmin && systemSection === 'diagnostic' ? <section className="content-card technical-diagnostic-card">
      <div className="section-head">
        <div>
          <div className="eyebrow">SUPERADMIN · DESARROLLO</div>
          <h2>Diagnóstico técnico</h2>
          <p className="section-copy">Herramientas internas de soporte y desarrollo. No forman parte de los reportes operativos.</p>
        </div>
        <button className="secondary" disabled={technicalBusy} onClick={loadTechnical}>
          {technicalBusy ? 'Consultando…' : 'Cargar diagnóstico'}
        </button>
      </div>

      {!technical ? <div className="technical-empty">Los datos técnicos se cargan únicamente cuando SUPERADMIN los solicita.</div> : <>
        <div className="technical-kpis">
          <article><span>Base PostgreSQL</span><strong>{technical.database?.database || '—'}</strong><small>{technical.database?.size || '—'}</small></article>
          <article><span>{brandText("Schema GMX")}</span><strong>{technical.schema?.size || '—'}</strong><small>tablas + índices</small></article>
          <article><span>Node</span><strong>{technical.runtime?.node || '—'}</strong><small>{technical.runtime?.platform || '—'}</small></article>
          <article><span>Uptime API</span><strong>{technical.runtime?.uptimeSeconds != null ? `${technical.runtime.uptimeSeconds}s` : '—'}</strong><small>PID {technical.runtime?.pid || '—'}</small></article>
        </div>

        <nav className="technical-tabs">
          <button className={technicalTab === 'overview' ? 'active' : ''} onClick={() => setTechnicalTab('overview')}>PostgreSQL</button>
          <button className={technicalTab === 'migrations' ? 'active' : ''} onClick={() => setTechnicalTab('migrations')}>Migraciones</button>
          <button className={technicalTab === 'trace' ? 'active' : ''} onClick={() => setTechnicalTab('trace')}>Trazabilidad técnica</button>
          <button className={technicalTab === 'sessions' ? 'active' : ''} onClick={() => setTechnicalTab('sessions')}>Sesiones</button>
        </nav>

        {technicalTab === 'overview' ? <div className="table-wrap"><table>
          <thead><tr><th>Tabla</th><th>Tamaño total</th><th>Datos</th><th>Bytes</th></tr></thead>
          <tbody>{(technical.tables || []).map((x) => <tr key={x.table_name}><td>{x.table_name}</td><td>{x.total_size}</td><td>{x.table_size}</td><td>{Number(x.total_bytes || 0).toLocaleString('es-MX')}</td></tr>)}</tbody>
        </table></div> : null}

        {technicalTab === 'migrations' ? <div className="table-wrap"><table>
          <thead><tr><th>Versión</th><th>Descripción</th><th>Aplicada</th></tr></thead>
          <tbody>{(technical.migrations || []).map((x, i) => <tr key={`${x.version}-${i}`}><td>{x.version}</td><td>{x.description}</td><td>{x.applied_at ? new Date(x.applied_at).toLocaleString('es-MX') : '—'}</td></tr>)}</tbody>
        </table></div> : null}

        {technicalTab === 'trace' ? <div className="table-wrap"><table>
          <thead><tr><th>Fecha</th><th>Módulo</th><th>Acción</th><th>Referencia</th><th>Usuario</th><th>Detalle</th></tr></thead>
          <tbody>{(technical.audit || []).map((x) => <tr key={x.row_id}><td>{x.fecha ? new Date(x.fecha).toLocaleString('es-MX') : '—'}</td><td>{x.modulo}</td><td>{x.accion}</td><td>{x.referencia || '—'}</td><td>{x.usuario || '—'}</td><td>{x.detalle || '—'}</td></tr>)}</tbody>
        </table></div> : null}

        {technicalTab === 'sessions' ? <div className="table-wrap"><table>
          <thead><tr><th>Usuario</th><th>Estado</th><th>Creada</th><th>Última actividad</th><th>Expira</th></tr></thead>
          <tbody>{(technical.sessions || []).map((x) => <tr key={x.id}><td>{x.email}</td><td>{x.estado}</td><td>{x.created_at ? new Date(x.created_at).toLocaleString('es-MX') : '—'}</td><td>{x.last_seen_at ? new Date(x.last_seen_at).toLocaleString('es-MX') : '—'}</td><td>{x.expires_at ? new Date(x.expires_at).toLocaleString('es-MX') : '—'}</td></tr>)}</tbody>
        </table></div> : null}
      </>}
    </section> : null}

    {systemSection === 'payments' ? <section className="content-card payment-admin-config">
      <div className="section-head"><div><div className="eyebrow">PORTAL CLIENTE · PAGOS</div><h2>Transferencia bancaria</h2><p className="section-copy">Estos datos son los que verá el cliente después de seleccionar Transferencia.</p></div><button onClick={savePayments}>Guardar</button></div>
      <div className="form-grid">
        <label>Banco<input value={settings['public.payment.transfer.bank_name'] || ''} onChange={(e) => setSettings((x) => ({ ...x, 'public.payment.transfer.bank_name': e.target.value }))} /></label>
        <label>Titular<input value={settings['public.payment.transfer.account_holder'] || ''} onChange={(e) => setSettings((x) => ({ ...x, 'public.payment.transfer.account_holder': e.target.value }))} /></label>
        <label>Número de cuenta<input value={settings['public.payment.transfer.account_number'] || ''} onChange={(e) => setSettings((x) => ({ ...x, 'public.payment.transfer.account_number': e.target.value }))} /></label>
        <label>CLABE<input maxLength="18" value={settings['public.payment.transfer.clabe'] || ''} onChange={(e) => setSettings((x) => ({ ...x, 'public.payment.transfer.clabe': e.target.value.replace(/\D/g, '') }))} /></label>
        <label className="wide">Instrucciones<textarea rows="3" value={settings['public.payment.transfer.instructions'] || ''} onChange={(e) => setSettings((x) => ({ ...x, 'public.payment.transfer.instructions': e.target.value }))} /></label>
      </div>
      <div className="architecture-note"><b>Tarjeta</b><p>Las llaves secretas de Stripe no se almacenan en PostgreSQL ni se muestran en el navegador. Se configuran únicamente en <code>backend/.env</code>.</p></div>
    </section> : null}

    {systemSection === 'email' ? <section className="content-card smtp-config">
      <div className="section-head">
        <div>
          <div className="eyebrow">SISTEMA · CORREO</div>
          <h2>Correo / SMTP</h2>
          <p className="section-copy">Configuración global para cotizaciones, pedidos, comprobantes y recuperación de acceso.</p>
        </div>
        <div className={`smtp-status ${smtpStatus.configured ? 'is-ready' : 'is-missing'}`}>
          <span>Estado</span>
          <strong>{smtpStatus.configured ? 'Configurado' : 'No configurado'}</strong>
          <small>{smtpStatus.configured ? `${smtpStatus.host}:${smtpStatus.port} · ${smtpStatus.source}` : 'Completa y guarda los datos SMTP.'}</small>
        </div>
      </div>

      <div className="smtp-grid">
        <article className="smtp-card">
          <h3>Proveedor</h3>
          <p>Selecciona un proveedor conocido o utiliza un servidor SMTP personalizado.</p>
          <label>Proveedor
            <select value={smtp.provider} onChange={(e) => {
              const provider = e.target.value;
              const preset = provider === 'GMAIL' ?
              { host: 'smtp.gmail.com', port: 587, secure: false } :
              provider === 'MICROSOFT365' ?
              { host: 'smtp.office365.com', port: 587, secure: false } :
              {};
              setSmtp((x) => ({ ...x, provider, ...preset }));
            }}>
              <option value="GMAIL">Gmail / Google Workspace</option>
              <option value="MICROSOFT365">Microsoft 365 / Outlook</option>
              <option value="CUSTOM">SMTP personalizado</option>
            </select>
          </label>
          <label className="check-label">
            <input type="checkbox" checked={smtp.enabled !== false} onChange={(e) => setSmtp((x) => ({ ...x, enabled: e.target.checked }))} />
            Habilitar envío de correo
          </label>
        </article>

        <article className="smtp-card">
          <h3>Servidor</h3>
          <div className="smtp-inline">
            <label>Host
              <input value={smtp.host} disabled={smtp.provider !== 'CUSTOM'} onChange={(e) => setSmtp((x) => ({ ...x, host: e.target.value }))} placeholder="smtp.ejemplo.com" />
            </label>
            <label>Puerto
              <input type="number" min="1" max="65535" value={smtp.port} disabled={smtp.provider !== 'CUSTOM'} onChange={(e) => setSmtp((x) => ({ ...x, port: Number(e.target.value) }))} />
            </label>
          </div>
          <label className="check-label">
            <input type="checkbox" checked={smtp.secure === true} disabled={smtp.provider !== 'CUSTOM'} onChange={(e) => setSmtp((x) => ({ ...x, secure: e.target.checked }))} />
            SSL directo (normalmente puerto 465)
          </label>
          <small className="smtp-help">Para Gmail y Microsoft 365 se usa STARTTLS sobre puerto 587.</small>
        </article>

        <article className="smtp-card">
          <h3>Credenciales</h3>
          <label>Usuario / correo SMTP
            <input type="email" value={smtp.user} onChange={(e) => setSmtp((x) => ({ ...x, user: e.target.value, fromEmail: x.fromEmail || e.target.value }))} placeholder="correo@dominio.com" />
          </label>
          <label>Contraseña / contraseña de aplicación
            <input type="password" autoComplete="new-password" value={smtp.password} onChange={(e) => setSmtp((x) => ({ ...x, password: e.target.value }))} placeholder={smtpStatus.passwordConfigured ? 'Contraseña ya guardada · escribe solo para reemplazar' : 'Captura la contraseña SMTP'} />
          </label>
          <div className="smtp-secret-status">{smtpStatus.passwordConfigured ? '✓ Contraseña guardada' : 'Contraseña no configurada'}</div>
        </article>

        <article className="smtp-card">
          <h3>Remitente</h3>
          <label>Nombre visible
            <input value={smtp.fromName} onChange={(e) => setSmtp((x) => ({ ...x, fromName: e.target.value }))} placeholder={brandText("GMX")} />
          </label>
          <label>Correo remitente
            <input type="email" value={smtp.fromEmail} onChange={(e) => setSmtp((x) => ({ ...x, fromEmail: e.target.value }))} placeholder="ventas@dominio.com" />
          </label>
          <button disabled={smtpBusy} onClick={saveSmtp}>
            {smtpBusy && smtpAction === 'GUARDANDO' ?
            <span className="smtp-button-working"><span className="smtp-spinner" />Guardando...</span> :
            'Guardar configuración SMTP'}
          </button>
        </article>
      </div>

      <div className="smtp-test-box">
        <div>
          <h3>Probar configuración</h3>
          <p>Envía un correo real para confirmar que las credenciales y el servidor funcionan antes de usar Cotizaciones.</p>
        </div>
        <div className="smtp-test-actions">
          <input type="email" value={smtpTestEmail} onChange={(e) => setSmtpTestEmail(e.target.value)} placeholder="correo@destino.com" />
          <button
            disabled={smtpBusy || !smtpTestEmail.trim() || smtp.enabled === false || !String(smtp.user || '').trim() || !smtpStatus.passwordConfigured && !String(smtp.password || '').trim()}
            onClick={testSmtp}>
            
            {smtpBusy ?
            <span className="smtp-button-working"><span className="smtp-spinner" />{smtpAction === 'GUARDANDO_Y_PROBANDO' ? 'Guardando y preparando...' : smtpAction === 'ENVIANDO' ? 'Enviando...' : smtpAction === 'ENVIADO' ? 'Enviado' : 'Procesando...'}</span> :
            'Enviar correo de prueba'}
          </button>
        </div>
        {smtpBusy ? <div className="smtp-progress-wrap" aria-live="polite">
          <div className="smtp-progress-head">
            <span>{smtpAction === 'GUARDANDO_Y_PROBANDO' ? 'Guardando credenciales y preparando envío' : smtpAction === 'ENVIANDO' ? 'Conectando con el servidor SMTP y enviando correo' : smtpAction === 'ENVIADO' ? 'Correo enviado correctamente' : 'Procesando configuración SMTP'}</span>
            <strong>{smtpProgress}%</strong>
          </div>
          <div className="smtp-progress-track"><div className="smtp-progress-bar" style={{ width: `${smtpProgress}%` }} /></div>
        </div> : null}
      </div>
    </section> : null}

    {systemSection === 'fx' ? <section className="content-card finance-fx-config">
      <div className="section-head">
        <div>
          <div className="eyebrow">FINANZAS · TIPO DE CAMBIO</div>
          <h2>USD → MXN</h2>
          <p className="section-copy">Tipo de cambio financiero global para operaciones no TCG. Catálogo Maestro y Buylist TCG usan el TDC configurado por cada juego.</p>
        </div>
        <div className="finance-effective-rate">
          <span>TC efectivo</span>
          <strong>{fxData.effective?.available ? `${Number(fxData.effective.rate).toFixed(4)} MXN/USD` : 'No disponible'}</strong>
          <small>{fxData.effective?.available ? `${fxData.effective.source} · ${fxData.effective.location || 'México'} · ${fxData.effective.rate_date}` : 'Configura una fuente válida.'}</small>
        </div>
      </div>

      <div className="finance-fx-grid">
        <article className="finance-fx-card">
          <div>
            <h3>Banco de México</h3>
            <p>Referencia FIX mediante SIE. El token se guarda en backend y nunca se vuelve a mostrar en el navegador.</p>
          </div>
          <label className="check-label"><input type="checkbox" checked={fxForm.banxicoEnabled !== false} onChange={(e) => setFxForm((x) => ({ ...x, banxicoEnabled: e.target.checked }))} />Usar Banco de México</label>
          <label>Token SIE
            <input type="password" autoComplete="new-password" value={fxForm.banxicoToken || ''} onChange={(e) => setFxForm((x) => ({ ...x, banxicoToken: e.target.value, clearBanxicoToken: false }))} placeholder={fxData.config?.banxicoTokenConfigured ? 'Token ya configurado · escribe solo para reemplazar' : 'Captura tu token SIE'} />
          </label>
          <div className="finance-token-status">{fxData.config?.banxicoTokenConfigured ? '✓ Token configurado y guardado' : 'Token todavía no guardado'}</div>
          <div className="actions finance-banxico-actions">
            <button disabled={fxBusy || !String(fxForm.banxicoToken || '').trim()} onClick={saveBanxicoToken}>Guardar token</button>
            <button className="secondary" disabled={fxBusy || !fxData.config?.banxicoTokenConfigured} onClick={refreshBanxico}>Actualizar Banxico</button>
          </div>
          {!fxData.config?.banxicoTokenConfigured ? <small className="finance-help">Primero pega el token, pulsa Guardar token y después actualiza Banco de México.</small> : null}
        </article>

        <article className="finance-fx-card">
          <div>
            <h3>TC operativo Tijuana</h3>
            <p>Override opcional para usar el tipo de cambio con el que realmente opera el negocio ese día.</p>
          </div>
          <label className="check-label"><input type="checkbox" checked={fxForm.tijuanaEnabled !== false} onChange={(e) => setFxForm((x) => ({ ...x, tijuanaEnabled: e.target.checked }))} />Permitir TC operativo Tijuana</label>
          <div className="finance-inline">
            <label>Fecha<input type="date" value={tijuanaDate} onChange={(e) => setTijuanaDate(e.target.value)} /></label>
            <label>MXN por USD<input type="number" min=".0001" step=".0001" value={tijuanaRate} onChange={(e) => setTijuanaRate(e.target.value)} placeholder="Ej. 17.2500" /></label>
          </div>
          <button disabled={fxBusy || !Number(tijuanaRate)} onClick={saveTijuana}>Guardar TC Tijuana</button>
        </article>

        <article className="finance-fx-card">
          <div><h3>Política de uso</h3><p>Define qué fuente tiene prioridad y cuándo un TC deja de ser válido.</p></div>
          <label>Prioridad<select value={fxForm.priority || 'TIJUANA_THEN_BANXICO'} onChange={(e) => setFxForm((x) => ({ ...x, priority: e.target.value }))}>
            <option value="TIJUANA_THEN_BANXICO">Tijuana → Banxico</option>
            <option value="BANXICO_THEN_TIJUANA">Banxico → Tijuana</option>
          </select></label>
          <label>Vigencia máxima (días)<input type="number" min="0" max="10" value={fxForm.maxAgeDays ?? 3} onChange={(e) => setFxForm((x) => ({ ...x, maxAgeDays: Number(e.target.value) }))} /></label>
          <label className="check-label"><input type="checkbox" checked={fxForm.blockIfStale !== false} onChange={(e) => setFxForm((x) => ({ ...x, blockIfStale: e.target.checked }))} />Bloquear conversiones si el TC está vencido</label>
          <button disabled={fxBusy} onClick={saveFxConfig}>Guardar política</button>
        </article>
      </div>

      <div className="finance-fx-history">
        <h3>Historial reciente</h3>
        <div className="table-wrap"><table>
          <thead><tr><th>Fecha</th><th>TC</th><th>Fuente</th><th>Ubicación</th><th>Tipo</th><th>Actualizado</th></tr></thead>
          <tbody>{(fxData.history || []).map((r) => <tr key={r.row_id}>
            <td>{r.rate_date}</td><td>{Number(r.rate).toFixed(4)}</td><td>{r.source}</td><td>{r.location || '—'}</td>
            <td>{r.is_operational ? 'Operativo' : 'Referencia'}</td><td>{r.fetched_at ? new Date(r.fetched_at).toLocaleString('es-MX') : '—'}</td>
          </tr>)}</tbody>
        </table></div>
      </div>
    </section> : null}
  </div>;
}


