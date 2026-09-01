import { brandText } from "../config/brand.js";import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../services/api.js';
import '../phase_shiny_exact_views_r23.css';

import '../notifications_visual_r78_fix4.css';
const priorities = ['', 'CRITICA', 'ALTA', 'MEDIA', 'BAJA'];
const defaults = {
  'alerts.low_stock_enabled': 'true', 'alerts.low_stock_threshold': '5',
  'alerts.tcg_low_stock_enabled': 'true', 'alerts.tcg_low_stock_threshold': '2',
  'alerts.payables_enabled': 'true', 'alerts.payables_due_days': '5',
  'alerts.purchase_invoice_enabled': 'true', 'alerts.purchase_invoice_days': '2',
  'alerts.cash_difference_enabled': 'true', 'alerts.cash_difference_threshold': '1',
  'alerts.tcg_sync_enabled': 'true', 'alerts.auto_generate_enabled': 'true', 'alerts.auto_generate_minutes': '15'
};
const bool = (v) => String(v).toLowerCase() === 'true';

export default function NotificationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const focusedAlertId = searchParams.get('alert') || '';
  const [rows, setRows] = useState([]),[summary, setSummary] = useState({}),[settings, setSettings] = useState(defaults);
  const [filters, setFilters] = useState({ status: 'OPEN', priority: '', type: '', search: '' });
  const [message, setMessage] = useState(''),[busy, setBusy] = useState(false),[refreshing, setRefreshing] = useState(false),[tab, setTab] = useState('alerts');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [selectedAlertId, setSelectedAlertId] = useState('');

  async function load({ silent = false } = {}) {
    if (!silent) setRefreshing(true);
    try {
      const effectiveFilters = focusedAlertId ? { ...filters, status: 'ALL' } : filters;
      const q = new URLSearchParams(Object.entries(effectiveFilters).filter(([, v]) => v !== ''));
      const [n, s] = await Promise.all([
      api(`/api/v1/notifications?${q}`),
      api('/api/v1/notifications/settings/config')]
      );
      setRows(n.data || []);
      setSummary(n.summary || {});
      setSettings({ ...defaults, ...(s.data || {}) });
      setLastUpdated(new Date());
    } finally {
      if (!silent) setRefreshing(false);
    }
  }
  useEffect(() => {load().catch((e) => setMessage(e.message));}, [filters.status, filters.priority, filters.type, focusedAlertId]);

  // Mientras el Centro de Alertas está abierto, recoge condiciones generadas
  // por ventas/compras/caja/TCG sin requerir F5 ni pulsar Actualizar.
  useEffect(() => {
    if (tab !== 'alerts') return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        load({ silent: true }).catch(() => {});
      }
    }, 10000);
    return () => clearInterval(timer);
  }, [tab, filters.status, filters.priority, filters.type]);

  const types = useMemo(() => [...new Set(rows.map((x) => x.tipo).filter(Boolean))].sort(), [rows]);
  const visible = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return !q ? rows : rows.filter((x) => [x.titulo, x.mensaje, x.referencia, x.tipo, x.sucursal].some((v) => String(v || '').toLowerCase().includes(q)));
  }, [rows, filters.search]);
  const selectedAlert = useMemo(() => {
    const wanted = focusedAlertId || selectedAlertId;
    return visible.find((row) => String(row.row_id) === String(wanted)) || visible[0] || null;
  }, [visible, focusedAlertId, selectedAlertId]);
  const typeSummary = useMemo(() => {
    const counts = visible.reduce((result, row) => {
      const key = String(row.tipo || 'OTRA').replaceAll('_', ' ');
      result[key] = (result[key] || 0) + 1;
      return result;
    }, {});
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [visible]);
  const trendSummary = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - (6 - index));
      return { key: date.toISOString().slice(0, 10), label: date.toLocaleDateString('es-MX', { weekday: 'short' }), count: 0 };
    });
    const byKey = new Map(days.map((day) => [day.key, day]));
    visible.forEach((row) => {
      if (!row.fecha) return;
      const key = new Date(row.fecha).toISOString().slice(0, 10);
      if (byKey.has(key)) byKey.get(key).count += 1;
    });
    return days;
  }, [visible]);

  useEffect(() => {
    if (!focusedAlertId || !rows.length) return;
    setSelectedAlertId(focusedAlertId);
    const timer = setTimeout(() => {
      document.getElementById(`alert-row-${focusedAlertId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
    return () => clearTimeout(timer);
  }, [focusedAlertId, rows]);

  async function generate() {
    setBusy(true);
    try {
      const r = await api('/api/v1/notifications/generate', { method: 'POST', body: '{}' });
      setMessage(`${r.data.created} alerta(s) nuevas · ${r.data.updated} actualizadas.`);
      await load();
    } catch (e) {setMessage(e.message);} finally {setBusy(false);}
  }
  async function mark(x, read = true) {
    try {await api(`/api/v1/notifications/${x.row_id}/read`, { method: 'POST', body: JSON.stringify({ read }) });await load();}
    catch (e) {setMessage(e.message);}
  }
  async function markAllRead() {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await api('/api/v1/notifications?status=UNREAD&limit=1000');
      const unread = (response.data || []).filter((x) => !x.leida);

      if (!unread.length) {
        setMessage('No hay alertas pendientes por marcar como leídas.');
        await load();
        return;
      }

      let updated = 0;
      for (const alert of unread) {
        await api(`/api/v1/notifications/${alert.row_id}/read`, {
          method: 'POST',
          body: JSON.stringify({ read: true })
        });
        updated++;
      }

      setMessage(`${updated} alerta(s) marcadas como leídas.`);
      await load();
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function resolve(x, resolved = true) {
    let note = '';
    if (resolved) {
      note = prompt('Nota de resolución (opcional):', '') || '';
    }
    try {await api(`/api/v1/notifications/${x.row_id}/resolve`, { method: 'POST', body: JSON.stringify({ resolved, note }) });await load();}
    catch (e) {setMessage(e.message);}
  }
  async function saveSettings() {
    try {
      await api('/api/v1/notifications/settings/config', { method: 'PUT', body: JSON.stringify(settings) });
      setMessage('Configuración de alertas guardada.');
    } catch (e) {setMessage(e.message);}
  }
  const setBool = (key, val) => setSettings((x) => ({ ...x, [key]: String(val) }));
  const setNum = (key, val) => setSettings((x) => ({ ...x, [key]: String(val) }));

  return <div className="alerts-page r23-view r23-alerts">
    <header className="alerts-hero">
      <div><div className="eyebrow">CONTROL OPERATIVO</div><h1>Notificaciones / Alertas</h1><p>Condiciones que requieren atención en inventario, finanzas, compras, caja y TCG.</p></div>
      <div className="alerts-header-tools">
        <div className="alerts-last-update">{lastUpdated ? `Actualizado ${lastUpdated.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Sin actualizar'}</div>
        <div className="alerts-actions">
          <button
            className="secondary"
            disabled={busy || Number(summary?.no_leidas || 0) <= 0}
            onClick={markAllRead}
            title="Marca como leídas todas las alertas visibles para tu alcance de sucursal">
            
            ✓ Marcar todas como leídas
          </button>
          <button className="secondary" disabled={refreshing} onClick={() => load().catch((e) => setMessage(e.message))}>
            {refreshing ? <><span className="mini-spinner" />Actualizando…</> : 'Actualizar'}
          </button>
          <button disabled={busy} onClick={generate}>{busy ? <><span className="mini-spinner light" />Revisando…</> : 'Revisar ahora'}</button>
        </div>
      </div>
    </header>
    {message ? <div className="message">{message}</div> : null}

    <nav className="alerts-tabs">
      <button className={tab === 'alerts' ? 'active' : ''} onClick={() => setTab('alerts')}>Centro de alertas</button>
      <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>Configuración</button>
    </nav>

    {tab === 'alerts' ? <section className="alerts-control-layout">
      <section className="alert-kpis" aria-label="Resumen rápido de alertas">
        <article className="alert-kpi alert-kpi-open">
          <div className="alert-kpi-icon" aria-hidden="true">◎</div>
          <div className="alert-kpi-copy">
            <span className="alert-kpi-label">Alertas abiertas</span>
            <strong>{summary.abiertas || 0}</strong>
            <small>Requieren seguimiento</small>
          </div>
        </article>
        <article className="alert-kpi alert-kpi-unread">
          <div className="alert-kpi-icon" aria-hidden="true">✉</div>
          <div className="alert-kpi-copy">
            <span className="alert-kpi-label">No leídas</span>
            <strong>{summary.no_leidas || 0}</strong>
            <small>Pendientes de revisar</small>
          </div>
        </article>
        <article className="alert-kpi alert-kpi-critical">
          <div className="alert-kpi-icon" aria-hidden="true">!</div>
          <div className="alert-kpi-copy">
            <span className="alert-kpi-label">Críticas</span>
            <strong>{summary.criticas || 0}</strong>
            <small>Atención inmediata</small>
          </div>
        </article>
        <article className="alert-kpi alert-kpi-high">
          <div className="alert-kpi-icon" aria-hidden="true">△</div>
          <div className="alert-kpi-copy">
            <span className="alert-kpi-label">Altas</span>
            <strong>{summary.altas || 0}</strong>
            <small>Prioridad alta</small>
          </div>
        </article>
        <article className="alert-kpi alert-kpi-resolved">
          <div className="alert-kpi-icon" aria-hidden="true">✓</div>
          <div className="alert-kpi-copy">
            <span className="alert-kpi-label">Resueltas</span>
            <strong>{summary.resueltas || 0}</strong>
            <small>Atendidas correctamente</small>
          </div>
        </article>
      </section>
      <div className="alerts-control-main">
      <section className="alerts-visual-summary" aria-label="Resumen visual de alertas">
        <article>
          <div className="alerts-visual-heading"><div><span>Distribución</span><h3>Alertas por tipo</h3></div><strong>{visible.length}</strong></div>
          <div className="alerts-type-bars">{typeSummary.map(([label, value]) => <div key={label}><span>{label}</span><i><b style={{ width: `${Math.max(8, (value / Math.max(1, typeSummary[0]?.[1] || 1)) * 100)}%` }} /></i><strong>{value}</strong></div>)}</div>
        </article>
        <article>
          <div className="alerts-visual-heading"><div><span>Tendencia</span><h3>Últimos 7 días</h3></div><strong>{trendSummary.reduce((sum, day) => sum + day.count, 0)}</strong></div>
          <div className="alerts-trend-bars">{trendSummary.map((day) => <div key={day.key}><i><b style={{ height: `${Math.max(day.count ? 14 : 3, (day.count / Math.max(1, ...trendSummary.map((item) => item.count))) * 100)}%` }} /></i><strong>{day.count}</strong><span>{day.label.replace('.', '')}</span></div>)}</div>
        </article>
      </section>

      <section className="alerts-center-grid">
        <div className="alerts-inbox">
          <div className="alert-filterbar">
            <select value={filters.status} onChange={(e) => setFilters((x) => ({ ...x, status: e.target.value }))}><option value="OPEN">Abiertas</option><option value="UNREAD">No leídas</option><option value="RESOLVED">Resueltas</option><option value="ALL">Todas</option></select>
            <select value={filters.priority} onChange={(e) => setFilters((x) => ({ ...x, priority: e.target.value }))}>{priorities.map((p) => <option key={p} value={p}>{p || 'Todas las prioridades'}</option>)}</select>
            <select value={filters.type} onChange={(e) => setFilters((x) => ({ ...x, type: e.target.value }))}><option value="">Todos los tipos</option>{types.map((t) => <option key={t}>{t}</option>)}</select>
            <input value={filters.search} onChange={(e) => setFilters((x) => ({ ...x, search: e.target.value }))} placeholder="Buscar alerta, referencia, sucursal…" />
          </div>

          {focusedAlertId ? <div className="focused-alert-banner">
            <span>Mostrando la alerta seleccionada desde el aviso global.</span>
            <button className="secondary compact" onClick={() => setSearchParams({})}>Quitar selección</button>
          </div> : null}
          <div className="alerts-list alerts-list-compact">
            {visible.map((x) => <article onClick={() => setSelectedAlertId(x.row_id)} id={`alert-row-${x.row_id}`} key={x.row_id} className={`alert-card ${String(x.prioridad || 'media').toLowerCase()} ${x.leida ? 'read' : ''} ${x.resuelta ? 'resolved' : ''} ${String(x.row_id) === String(selectedAlert?.row_id) ? 'selected focused' : ''}`}>
              <div className="alert-icon">{alertIcon(x.tipo)}</div>
              <div className="alert-body">
                <div className="alert-title-line"><h3>{x.titulo}</h3><span className={`priority-pill ${String(x.prioridad).toLowerCase()}`}>{x.prioridad}</span></div>
                <p>{x.mensaje}</p>
                <div className="alert-meta">{x.sucursal ? <span>{x.sucursal}</span> : null}<span>{x.fecha ? new Date(x.fecha).toLocaleString('es-MX') : '—'}</span></div>
              </div>
            </article>)}
            {!visible.length ? <div className="alerts-empty"><b>Sin alertas para estos filtros.</b><span>{brandText("GMX continuará revisando las condiciones configuradas.")}</span></div> : null}
          </div>
        </div>

      </section>
      </div>
      <AlertDetail alert={selectedAlert} onRead={mark} onResolve={resolve} />
    </section> : null}

    {tab === 'settings' ? <section className="alerts-settings">
      <div className="alerts-settings-head"><div><h2>Reglas automáticas</h2><p>Define cuándo una condición debe convertirse en alerta.</p></div><button onClick={saveSettings}>Guardar configuración</button></div>
      <div className="alert-setting-grid">
        <Setting title="Stock bajo · Productos" enabled={bool(settings['alerts.low_stock_enabled'])} onEnabled={(v) => setBool('alerts.low_stock_enabled', v)}><label>Umbral mínimo<input type="number" min="0" value={settings['alerts.low_stock_threshold']} onChange={(e) => setNum('alerts.low_stock_threshold', e.target.value)} /></label></Setting>
        <Setting title="Stock bajo · TCG" enabled={bool(settings['alerts.tcg_low_stock_enabled'])} onEnabled={(v) => setBool('alerts.tcg_low_stock_enabled', v)}><label>Disponibles ≤<input type="number" min="0" value={settings['alerts.tcg_low_stock_threshold']} onChange={(e) => setNum('alerts.tcg_low_stock_threshold', e.target.value)} /></label></Setting>
        <Setting title="Cuentas por pagar" enabled={bool(settings['alerts.payables_enabled'])} onEnabled={(v) => setBool('alerts.payables_enabled', v)}><label>Avisar días antes<input type="number" min="0" value={settings['alerts.payables_due_days']} onChange={(e) => setNum('alerts.payables_due_days', e.target.value)} /></label></Setting>
        <Setting title="Compras sin factura" enabled={bool(settings['alerts.purchase_invoice_enabled'])} onEnabled={(v) => setBool('alerts.purchase_invoice_enabled', v)}><label>Después de días<input type="number" min="0" value={settings['alerts.purchase_invoice_days']} onChange={(e) => setNum('alerts.purchase_invoice_days', e.target.value)} /></label></Setting>
        <Setting title="Diferencias de caja" enabled={bool(settings['alerts.cash_difference_enabled'])} onEnabled={(v) => setBool('alerts.cash_difference_enabled', v)}><label>Diferencia mayor a $<input type="number" min="0" step=".01" value={settings['alerts.cash_difference_threshold']} onChange={(e) => setNum('alerts.cash_difference_threshold', e.target.value)} /></label></Setting>
        <Setting title="Errores de sincronización TCG" enabled={bool(settings['alerts.tcg_sync_enabled'])} onEnabled={(v) => setBool('alerts.tcg_sync_enabled', v)}><p>Genera una alerta cuando un proveedor TCG reporta error o estado degradado.</p></Setting>
        <Setting title="Revisión automática" enabled={bool(settings['alerts.auto_generate_enabled'])} onEnabled={(v) => setBool('alerts.auto_generate_enabled', v)}><label>Frecuencia (minutos)<input type="number" min="5" max="1440" value={settings['alerts.auto_generate_minutes']} onChange={(e) => setNum('alerts.auto_generate_minutes', e.target.value)} /></label><small>El nuevo intervalo se aplica al reiniciar la API.</small></Setting>
      </div>
    </section> : null}
  </div>;
}

function alertIcon(type) {
  return type === 'STOCK_BAJO' ? '📦' : type === 'TCG_STOCK_BAJO' ? '🃏' : type?.startsWith('CXP_') ? '💳' : type === 'COMPRA_SIN_FACTURA' ? '🧾' : type === 'DIFERENCIA_CAJA' ? '💵' : '⚠️';
}

function AlertDetail({ alert, onRead, onResolve }) {
  if (!alert) return <aside className="alert-detail-panel empty"><div className="alert-detail-empty"><span>✓</span><h3>Sin alertas seleccionadas</h3><p>Ajusta los filtros o ejecuta una revisión para consultar condiciones pendientes.</p></div></aside>;
  return <aside className={`alert-detail-panel ${String(alert.prioridad || 'media').toLowerCase()}`}>
    <div className="alert-detail-header"><span className="alert-detail-icon">{alertIcon(alert.tipo)}</span><div><span>Detalle de alerta</span><h2>{alert.titulo}</h2></div><span className={`priority-pill ${String(alert.prioridad).toLowerCase()}`}>{alert.prioridad}</span></div>
    <p className="alert-detail-message">{alert.mensaje}</p>
    <dl className="alert-detail-data">
      <div><dt>Tipo</dt><dd>{String(alert.tipo || '—').replaceAll('_', ' ')}</dd></div>
      <div><dt>Sucursal</dt><dd>{alert.sucursal || 'Todas / no indicada'}</dd></div>
      <div><dt>Referencia</dt><dd>{alert.referencia || '—'}</dd></div>
      <div><dt>Detectada</dt><dd>{alert.fecha ? new Date(alert.fecha).toLocaleString('es-MX') : '—'}</dd></div>
      <div><dt>Lectura</dt><dd>{alert.leida ? 'Leída' : 'Pendiente'}</dd></div>
      <div><dt>Estado</dt><dd>{alert.resuelta ? 'Resuelta' : 'Abierta'}</dd></div>
    </dl>
    {alert.resuelta && alert.nota_resolucion ? <div className="resolution-note">✓ {alert.nota_resolucion}</div> : null}
    <div className="alert-detail-actions">
      {alert.ruta && !alert.resuelta ? <Link className="button" to={alert.ruta} onClick={() => !alert.leida && onRead(alert, true)}>Atender alerta</Link> : null}
      {!alert.leida ? <button className="secondary" onClick={() => onRead(alert, true)}>Marcar leída</button> : !alert.resuelta ? <button className="secondary" onClick={() => onRead(alert, false)}>Marcar no leída</button> : null}
      {!alert.resuelta ? <button onClick={() => onResolve(alert, true)}>Resolver</button> : <button className="secondary" onClick={() => onResolve(alert, false)}>Reabrir</button>}
    </div>
  </aside>;
}

function Setting({ title, enabled, onEnabled, children }) {
  return <article className={`alert-setting ${enabled ? 'enabled' : 'disabled'}`}>
    <div className="alert-setting-title"><h3>{title}</h3><label className="switch-line"><input type="checkbox" checked={enabled} onChange={(e) => onEnabled(e.target.checked)} /><span>{enabled ? 'Activa' : 'Inactiva'}</span></label></div>
    <div className="alert-setting-body">{children}</div>
  </article>;
}
