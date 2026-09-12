import { NavLink } from 'react-router';
import NavIcon from './NavIcon.jsx';
import BrandLogo from './BrandLogo.jsx';

const groups = [
{ label: 'GENERAL', items: [
  ['/admin/dashboard', 'Dashboard', 'dashboard', 'DASHBOARD'], ['/admin/productos', 'Productos', 'products', 'PRODUCTOS'], ['/admin/categorias', 'Categorías', 'products', 'PRODUCTOS'],
  ['/admin/clientes', 'Clientes', 'clients', 'CLIENTES'], ['/admin/inventario', 'Inventario', 'inventory', 'INVENTARIO'],
  ['/admin/sucursales', 'Sucursales', 'branches', 'SUCURSALES']]
},
{ label: 'OPERACIÓN', items: [
  ['/admin/pos', 'POS', 'orders', 'PEDIDOS'], ['/admin/historial-ventas', 'Historial de ventas', 'reports', 'PEDIDOS'], ['/admin/pedidos', 'Pedidos', 'orders', 'PEDIDOS'], ['/admin/transferencias', 'Transferencias', 'orders', 'PEDIDOS'], ['/admin/devoluciones', 'Devoluciones', 'buylist', 'COMERCIAL'], ['/admin/generar-codigo', 'Generar código', 'system', 'COMERCIAL'], ['/admin/compras', 'Compras / Recepción', 'purchases', 'COMPRAS'],
  ['/admin/caja', 'Caja / Arqueo', 'inventory', 'CAJA'], ['/admin/comercial', 'Gestión Comercial', 'clients', 'COMERCIAL']]
},
{ label: 'TCG', items: [
  ['/admin/tcg', 'Catálogo TCG', 'tcg', 'TCG'], ['/admin/tcg-operacion', 'Operación TCG', 'inventory', 'TCG'], ['/admin/buylist', 'Buylist', 'buylist', 'BUYLIST'],
  ['/ai-vision-lab', 'EscÃ¡ner de cartas', 'tcg', 'TCG'],
  ['/admin/membresias', 'Membresías', 'reports', 'COMERCIAL'], ['/admin/torneos', 'Torneos', 'tcg', 'COMERCIAL']]
},
{ label: 'GESTIÓN', items: [
  ['/admin/promociones', 'Promociones / Fidelidad', 'reports', 'CONTENIDO'], ['/admin/contenido', 'Contenido / Marketing', 'reports', 'CONTENIDO'],
  ['/admin/notificaciones', 'Notificaciones / Alertas', 'reports', 'NOTIFICACIONES'], ['/admin/reportes', 'Reportes', 'reports', 'REPORTES'], ['/admin/administracion', 'Usuarios / Permisos', 'system', 'ADMIN'], ['/admin/sistema', 'Sistema', 'system', 'SISTEMA']]
}];

function access() {try {return JSON.parse(localStorage.getItem('SHINY_AUTH_ACCESS') || localStorage.getItem('Shiny_AUTH_ACCESS') || '{}');} catch {return {};}}

export default function Sidebar({ open, onNavigate }) {
  const a = access(),role = String(a?.role || '').toUpperCase(),canRead = (m) => a?.permissions?.[m]?.read === true;
  const visibleGroups = role === 'OPERADOR' ?
  [{ label: 'PUNTO DE VENTA', items: [['/admin/pos', 'POS / Venta', 'orders', 'PEDIDOS']] }] :
  groups.map((g) => ({
    ...g,
    items: g.items.filter((x) => canRead(x[3]) && (x[3] !== 'ADMIN' || role === 'SUPERADMIN'))
  }));

  return <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
    <div className="brand"><BrandLogo compact={role === 'OPERADOR'} /></div>
    <nav className="sidebar-nav">{visibleGroups.map((g) => {
        const items = g.items.filter((x) => canRead(x[3]));if (!items.length) return null;
        return <div className="nav-group" key={g.label}><div className="nav-group-label">{g.label}</div>{items.map(([to, label, icon]) => <NavLink key={to} to={to} onClick={onNavigate} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><NavIcon name={icon} /><span>{label}</span></NavLink>)}</div>;
      })}</nav>
    <div className="sidebar-footer"><span className="status-dot" /><div><strong>{a?.role || 'LOCAL_SECURE'}</strong><span>{a?.branchScope?.all ? 'Todas las sucursales' : `${a?.branchScope?.allowed?.length || 0} sucursal(es)`}</span></div></div>
  </aside>;
}
