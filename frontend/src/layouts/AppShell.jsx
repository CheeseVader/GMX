import { brandText } from "../config/brand.js";import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import Sidebar from '../components/Sidebar.jsx';
import TopBar from '../components/TopBar.jsx';
import { api } from '../services/api.js';

const pageMeta = {
  '/admin/dashboard': ['Dashboard', brandText("GMX LOCAL")],
  '/admin/productos': ['Productos', 'CATÁLOGO'],
  '/admin/alta-externa-beta': ['Alta Externa Beta', 'LABORATORIO Â· CONSULTA EXTERNA'],


  '/admin/busqueda-visual-beta': ['Búsqueda Visual Beta', 'LABORATORIO · OPENCV + OPENCLIP'],
  '/admin/categorias': ['Categorías', 'CATÁLOGO MAESTRO'],
  '/admin/clientes': ['Clientes', 'CRM'],
  '/admin/inventario': ['Inventario', 'OPERACIÓN'],
  '/admin/sucursales': ['Sucursales', 'MULTISUCURSAL'],
  '/admin/pos': ['POS', 'VENTAS'],
  '/admin/historial-ventas': ['Historial de ventas', 'VENTAS - COBROS Y PAGOS'],
  '/admin/pedidos': ['Pedidos', 'VENTAS'],
  '/admin/compras': ['Compras / Recepción', 'OPERACIÓN'],
  '/admin/caja': ['Caja / Arqueo', 'EFECTIVO'],
  '/admin/devoluciones': ['Devoluciones', 'OPERACIÓN'],
  '/admin/generar-codigo': ['Generar código', 'AUTORIZACIÓN POS'],
  '/admin/comercial': ['Gestión Comercial', 'OPERACIÓN'],
  '/admin/promociones': ['Promociones / Fidelidad', 'BENEFICIOS'],
  '/admin/notificaciones': ['Notificaciones / Alertas', 'CONTROL OPERATIVO'],
  '/admin/contenido': ['Contenido / Marketing', 'MARKETING'],
  '/admin/tcg': ['TCG', 'TRADING CARD GAME'],
  '/admin/tcg-operacion': ['Operación TCG', 'TRADING CARD GAME'],
  '/admin/buylist': ['Buylist', 'TCG'],
  '/admin/reportes': ['Reportes', 'ANALÍTICA'],
  '/admin/administracion': ['Administración', 'SEGURIDAD'],
  '/admin/sistema': ['Sistema', 'CONFIGURACIÓN']
};

export default function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [health, setHealth] = useState(null);
  const [globalAlerts, setGlobalAlerts] = useState([]);
  const [globalSummary, setGlobalSummary] = useState({ no_leidas: 0, criticas: 0, altas: 0 });
  const [activeGlobalAlert, setActiveGlobalAlert] = useState(null);
  const [alertChecking, setAlertChecking] = useState(false);
  const [alertDockExpanded, setAlertDockExpanded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [title, staticSubtitle] = pageMeta[location.pathname] || [brandText("GMX"), 'LOCAL'];
  const [dashboardBranchLabelR54D,setDashboardBranchLabelR54D]=useState(
    localStorage.getItem('SHINY_DASHBOARD_BRANCH_NAME') || 'Todas las sucursales'
  ); // SHINY_DASHBOARD_BRANCH_ID_R54D
  const subtitle = location.pathname==='/admin/dashboard' ? dashboardBranchLabelR54D : staticSubtitle;
  const currentUser = (() => {try {return JSON.parse(localStorage.getItem('SHINY_AUTH_USER') || '{}');} catch {return {};}})();
  const operatorMode = String(currentUser?.rol || '').toUpperCase() === 'OPERADOR';

  useEffect(()=>{
    if(location.pathname!=='/admin/dashboard')return;

    const refreshDashboardBranchLabelR54D=()=>{
      setDashboardBranchLabelR54D(
        localStorage.getItem('SHINY_DASHBOARD_BRANCH_NAME') || 'Todas las sucursales'
      );
    };

    const onChanged=(event)=>{
      const branchName=String(event?.detail?.branchName||'').trim();
      if(branchName){
        localStorage.setItem('SHINY_DASHBOARD_BRANCH_NAME',branchName);
      }
      refreshDashboardBranchLabelR54D();
    };

    refreshDashboardBranchLabelR54D();
    window.addEventListener('shiny:dashboard-branch-changed',onChanged);

    return()=>{
      window.removeEventListener('shiny:dashboard-branch-changed',onChanged);
    };
  },[location.pathname]);

  async function checkHealth() {
    try {
      setHealth(await api('/api/health'));
    } catch {
      setHealth({ success: false });
    }
  }

  useEffect(() => {
    checkHealth();
    const timer = setInterval(checkHealth, 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => setSidebarOpen(false), [location.pathname]);

  function canReadNotifications() {
    try {
      const access = JSON.parse(localStorage.getItem('SHINY_AUTH_ACCESS') || '{}');
      const user = JSON.parse(localStorage.getItem('SHINY_AUTH_USER') || '{}');
      const role = String(access?.role || user?.rol || '').toUpperCase();
      return role === 'SUPERADMIN' || access?.permissions?.NOTIFICACIONES?.read === true;
    } catch {return false;}
  }

  function announcedIds() {
    try {return new Set(JSON.parse(sessionStorage.getItem('Shiny_ALERTS_ANNOUNCED') || '[]').map(String));}
    catch {return new Set();}
  }

  function rememberAnnounced(id) {
    const ids = announcedIds();
    ids.add(String(id));
    sessionStorage.setItem('Shiny_ALERTS_ANNOUNCED', JSON.stringify([...ids].slice(-200)));
  }

  async function checkGlobalAlerts({ silent = true } = {}) {
    if (!canReadNotifications()) {
      setGlobalAlerts([]);
      setGlobalSummary({ no_leidas: 0, criticas: 0, altas: 0 });
      return;
    }
    if (!silent) setAlertChecking(true);
    try {
      const r = await api('/api/v1/notifications?status=UNREAD&limit=50');
      const unread = r.data || [];
      setGlobalAlerts(unread);
      setGlobalSummary(r.summary || {});

      if (!activeGlobalAlert && unread.length) {
        const announced = announcedIds();
        const next = unread.find((x) => !announced.has(String(x.row_id)));
        if (next) {
          rememberAnnounced(next.row_id);
          setActiveGlobalAlert(next);
        }
      }
    } catch {

      // Una falla del centro de alertas no debe bloquear la operación.
    } finally {if (!silent) setAlertChecking(false);
    }
  }

  async function markGlobalAlertRead(alert, { open = false } = {}) {
    if (!alert) return;
    try {
      await api(`/api/v1/notifications/${alert.row_id}/read`, {
        method: 'POST', body: JSON.stringify({ read: true })
      });
    } catch {}
    setActiveGlobalAlert(null);
    await checkGlobalAlerts({ silent: true });
    if (open) navigate(`/admin/notificaciones?alert=${alert.row_id}`);
  }

  function dismissGlobalAlert() {
    // Oculta solo el popup de esta sesión. La alerta sigue NO LEÍDA y
    // permanece en el contador global.
    setActiveGlobalAlert(null);
  }

  useEffect(() => {
    checkGlobalAlerts({ silent: true });
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') checkGlobalAlerts({ silent: true });
    }, 10000);
    const onVisible = () => {if (document.visibilityState === 'visible') checkGlobalAlerts({ silent: true });};
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    // Al cambiar de módulo se refresca el contador, útil después de una venta,
    // compra, recepción, caja o ajuste de inventario.
    checkGlobalAlerts({ silent: true });
  }, [location.pathname]);

  if (operatorMode) {
    return (
      <div className="operator-pos-shell">
        <Outlet context={{ health, refreshHealth: checkHealth }} />
      </div>);

  }

  return (
    <div className="app-shell">
      <Sidebar open={sidebarOpen} onNavigate={() => setSidebarOpen(false)} />
      {sidebarOpen ?
      <button className="sidebar-overlay" aria-label="Cerrar menú" onClick={() => setSidebarOpen(false)} /> :
      null}
      <div className="app-main">
        <TopBar
          title={title}
          subtitle={subtitle}
          health={health}
          onMenu={() => setSidebarOpen((value) => !value)} />
        
        <div className="page-container">
          <Outlet context={{ health, refreshHealth: checkHealth }} />
        </div>
      </div>

      {canReadNotifications() ? <div
        className={`global-alert-dock ${alertDockExpanded ? 'expanded' : ''}`}
        onMouseEnter={() => setAlertDockExpanded(true)}
        onMouseLeave={() => setAlertDockExpanded(false)}>
        
      <button
          className={`global-alert-bell ${Number(globalSummary.no_leidas || 0) > 0 ? 'has-unread' : ''}`}
          title="Notificaciones / Alertas"
          aria-label={`Alertas${Number(globalSummary.no_leidas || 0) > 0 ? `: ${globalSummary.no_leidas} no leídas` : ''}`}
          onFocus={() => setAlertDockExpanded(true)}
          onBlur={() => setAlertDockExpanded(false)}
          onClick={() => navigate('/admin/notificaciones')}>
          
        <span className="global-alert-bell-icon">!</span>
        <span className="global-alert-bell-label">Alertas</span>
        {Number(globalSummary.no_leidas || 0) > 0 ? <b>{Number(globalSummary.no_leidas) > 99 ? '99+' : globalSummary.no_leidas}</b> : null}
        {alertChecking ? <span className="global-alert-bell-spinner" /> : null}
      </button>
      </div> : null}

      <style>{brandText(`
        /* Shiny-ALERTAS-FLOATING-FIX-20260815
           El acceso a Alertas queda compacto por defecto para no cubrir
           botones/acciones de las tablas. Se expande sólo con hover/focus. */
        .global-alert-dock{
          position:fixed;
          right:14px;
          bottom:14px;
          z-index:3900;
          width:48px;
          height:48px;
          display:flex;
          justify-content:flex-end;
          pointer-events:none;
        }
        .global-alert-dock .global-alert-bell{
          pointer-events:auto;
          width:48px;
          min-width:48px;
          height:48px;
          padding:0 13px;
          overflow:hidden;
          white-space:nowrap;
          display:flex;
          align-items:center;
          justify-content:flex-start;
          gap:8px;
          transition:width .18s ease, box-shadow .18s ease;
        }
        .global-alert-dock .global-alert-bell-label{
          opacity:0;
          max-width:0;
          overflow:hidden;
          transition:opacity .12s ease,max-width .18s ease;
        }
        .global-alert-dock.expanded{width:150px;}
        .global-alert-dock.expanded .global-alert-bell{width:150px;}
        .global-alert-dock.expanded .global-alert-bell-label{
          opacity:1;
          max-width:70px;
        }
        .global-alert-dock .global-alert-bell b{flex:0 0 auto;}
        @media (max-width:700px){
          .global-alert-dock{right:10px;bottom:10px;}
          .global-alert-dock.expanded{width:48px;}
          .global-alert-dock.expanded .global-alert-bell{width:48px;}
          .global-alert-dock.expanded .global-alert-bell-label{opacity:0;max-width:0;}
        }
      `)}</style>

      {activeGlobalAlert ? <div className={`global-unread-alert ${String(activeGlobalAlert.prioridad || 'MEDIA').toLowerCase()}`} role="alert" aria-live="assertive">
        <div className="global-unread-alert-icon">
          {String(activeGlobalAlert.prioridad).toUpperCase() === 'CRITICA' ? '!!' : '!'}
        </div>
        <div className="global-unread-alert-body">
          <div className="global-unread-alert-top">
            <span>ALERTA {activeGlobalAlert.prioridad || 'MEDIA'}</span>
            <small>{activeGlobalAlert.sucursal || activeGlobalAlert.modulo || brandText("GMX")}</small>
          </div>
          <h3>{activeGlobalAlert.titulo}</h3>
          <p>{activeGlobalAlert.mensaje}</p>
          <div className="global-unread-alert-meta">
            {activeGlobalAlert.tipo ? <span>{activeGlobalAlert.tipo}</span> : null}
            {activeGlobalAlert.referencia ? <span>Ref. {activeGlobalAlert.referencia}</span> : null}
          </div>
          <div className="global-unread-alert-actions">
            <button onClick={() => markGlobalAlertRead(activeGlobalAlert, { open: true })}>Revisar alerta</button>
            <button className="secondary" onClick={() => markGlobalAlertRead(activeGlobalAlert)}>Marcar como leída</button>
            <button className="secondary" onClick={dismissGlobalAlert}>Cerrar por ahora</button>
          </div>
        </div>
      </div> : null}
    </div>);

}
