import { brandText } from "../config/brand.js";import { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api.js';
import '../phase_shiny_exact_views_r23.css';
import '../admin_usr_d.css';

const actionKeys = [['leer', 'Leer'], ['crear', 'Crear'], ['editar', 'Editar'], ['eliminar', 'Eliminar'], ['autorizar', 'Autorizar']];
const blank = () => ({ nombre: '', email: '', password: '', rol: 'OPERADOR', activo: true, sucursal_principal: '', sucursales_permitidas: [] });

export default function AdminPage() {
  const currentUser = useMemo(() => {try {return JSON.parse(localStorage.getItem('Shiny_AUTH_USER') || '{}');} catch {return {};}}, []);
  const [users, setUsers] = useState([]),[meta, setMeta] = useState({ modules: [], roles: [], branches: [] });
  const [message, setMessage] = useState(''),[selected, setSelected] = useState(null),[form, setForm] = useState(blank()),[permissions, setPermissions] = useState([]),[effective, setEffective] = useState(null),[dirty, setDirty] = useState(false);
  const [security, setSecurity] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [identityPassword,setIdentityPassword]=useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [activeTab, setActiveTab] = useState('summary');

  async function load() {
    const [u, m] = await Promise.all([api('/api/v1/admin/users'), api('/api/v1/admin/access/modules')]);
    const rows = u.data || []; setUsers(rows);setMeta(m.data || { modules: [], roles: [], branches: [] });
    if (!selected && rows.length) setTimeout(() => selectUser(rows[0]), 0);
  }
  useEffect(() => {load().catch((e) => setMessage(e.message));}, []);
  const resetSecurity = () => setSecurity({ currentPassword: '', newPassword: '', confirmPassword: '' });

  function toggleBranch(target, setter, id) {
    const rows = Array.isArray(target.sucursales_permitidas) ? target.sucursales_permitidas : [];
    setter((x) => ({ ...x, sucursales_permitidas: rows.includes(id) ? rows.filter((v) => v !== id) : [...rows, id] }));
  }

  function openCreate() {
    setForm(blank());resetSecurity();setCreateOpen(true);
  }

  function closeCreate() {
    setCreateOpen(false);setForm(blank());resetSecurity();
  }

  async function createUser() {
    try {
      await api('/api/v1/admin/users', { method: 'POST', body: JSON.stringify({ ...form, currentPassword: form.rol === 'SUPERADMIN' ? security.currentPassword : undefined }) });
      closeCreate();setMessage('Usuario creado.');await load();
    } catch (e) {setMessage(e.message);}
  }

  async function selectUser(u) {
    setSelected({ ...u, sucursales_permitidas: Array.isArray(u.sucursales_permitidas) ? u.sucursales_permitidas : [] });setDirty(false);resetSecurity();
    try {
      const r = await api(`/api/v1/admin/permissions/${encodeURIComponent(u.email)}`);
      const custom = r.data?.custom || [],map = new Map(custom.map((x) => [String(x.modulo).toUpperCase(), x]));
      setPermissions((meta.modules || []).map((m) => map.get(m.id) || { modulo: m.id, leer: false, crear: false, editar: false, eliminar: false, autorizar: false, _custom: false }));
      setEffective(r.data?.effective || null);
    } catch (e) {setMessage(e.message);}
  }

  async function saveUser() {
    if (!selected) return;
    try {
      const previous = users.find((x) => x.row_id === selected.row_id),sensitive = selected.rol === 'SUPERADMIN' || previous?.rol === 'SUPERADMIN';
      const r = await api(`/api/v1/admin/users/${selected.row_id}`, { method: 'PUT', body: JSON.stringify({ ...selected, currentPassword: sensitive ? security.currentPassword : undefined }) });
      setSelected(r.data);resetSecurity();setMessage('Usuario actualizado.');await load();
    } catch (e) {setMessage(e.message);}
  }

  function val(module, key) {
    const row = permissions.find((x) => x.modulo === module);
    if (row?._custom) return row[key] === true;
    const a = { leer: 'read', crear: 'create', editar: 'edit', eliminar: 'delete', autorizar: 'authorize' }[key];
    return effective?.permissions?.[module]?.[a] === true;
  }
  function setVal(module, key, value) {
    setDirty(true);setPermissions((rows) => rows.map((x) => x.modulo === module ? { ...x, [key]: value, _custom: true } : x));
  }
  function preset(module, type) {
    const p = type === 'NONE' ? {} : type === 'READ' ? { leer: true } : type === 'OPERATE' ? { leer: true, crear: true, editar: true } : { leer: true, crear: true, editar: true, eliminar: true, autorizar: true };
    setDirty(true);setPermissions((rows) => rows.map((x) => x.modulo === module ? { ...x, leer: !!p.leer, crear: !!p.crear, editar: !!p.editar, eliminar: !!p.eliminar, autorizar: !!p.autorizar, _custom: true } : x));
  }
  async function saveIdentity(){
    if(!selected)return;
    try{const r=await api(`/api/v1/admin/users/${selected.row_id}/identity`,{method:'PUT',body:JSON.stringify({email:String(selected.email||'').trim().toLowerCase(),username:String(selected.username||'').trim().toLowerCase(),password:identityPassword})});setSelected(r.data);setIdentityPassword('');setMessage('Correo, usuario y acceso actualizados.');await load();}catch(e){setMessage(e.message);}
  }
async function savePermissions() {
    if (!selected || selected.rol === 'SUPERADMIN') return;
    if (!security.currentPassword) return setMessage('Escribe tu contraseña actual para autorizar el cambio.');
    const rows = permissions.filter((x) => x._custom).map(({ modulo, leer, crear, editar, eliminar, autorizar }) => ({ modulo, leer, crear, editar, eliminar, autorizar }));
    try {
      await api(`/api/v1/admin/permissions/${encodeURIComponent(selected.email)}`, { method: 'PUT', body: JSON.stringify({ permissions: rows, currentPassword: security.currentPassword }) });
      setDirty(false);resetSecurity();setMessage('Permisos actualizados.');await selectUser(selected);
    } catch (e) {setMessage(e.message);}
  }
  async function changePassword() {
    if (!selected) return;
    if (security.newPassword !== security.confirmPassword) return setMessage('Las contraseñas nuevas no coinciden.');
    try {
      await api(`/api/v1/admin/users/${selected.row_id}/change-password`, { method: 'POST', body: JSON.stringify({ currentPassword: security.currentPassword, newPassword: security.newPassword }) });
      resetSecurity();setMessage('Contraseña actualizada.');
    } catch (e) {setMessage(e.message);}
  }
  async function revokeSessions() {
    if (!selected) return;
    try {
      const r = await api(`/api/v1/admin/users/${selected.row_id}/revoke-sessions`, { method: 'POST', body: JSON.stringify({ currentPassword: security.currentPassword }) });
      setMessage(`${r.data.revoked} sesión(es) revocada(s).`);resetSecurity();
    } catch (e) {setMessage(e.message);}
  }

  const visibleUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      const matchesText = !q || [u.nombre, u.username, u.rol].some((v) => String(v || '').toLowerCase().includes(q));
      const matchesRole = !roleFilter || u.rol === roleFilter;
      const active = u.activo !== false;
      const matchesStatus = !statusFilter || (statusFilter === 'active' ? active : !active);
      return matchesText && matchesRole && matchesStatus;
    });
  }, [users, search, roleFilter, statusFilter]);

  const activeUsers = users.filter((user) => user.activo !== false).length;
  const availableRoles = [...new Set([...(meta.roles || []), ...users.map((user) => user.rol).filter(Boolean)])];
  const roleDistribution = availableRoles.map((role) => ({
    role,
    count: users.filter((user) => user.rol === role).length
  })).filter((item) => item.count > 0);
  const maxRoleCount = Math.max(1, ...roleDistribution.map((item) => item.count));

  const branchName = (id) => (meta.branches || []).find((b) => b.id_sucursal === id)?.nombre_sucursal || id || 'Sin restricción';
  const initials = (u) => String(u?.nombre || u?.username || '?').split(/\s+/).filter(Boolean).slice(0,2).map((x)=>x[0]).join('').toUpperCase();
  const sensitiveModules = (meta.modules || []).filter((m) => ['ADMIN','USERS','USUARIOS','CONFIG','SETTINGS','INVENTORY','INVENTARIO','ORDERS','ORDENES'].some((k)=>String(m.id).toUpperCase().includes(k))).slice(0,4);

  return <div className="admin-stack admin-rbac-page usrd-approved-layout">
    <section className="content-card usrd-shell">
      <div className="section-head usrd-top-head">
        <div><div className="eyebrow">SEGURIDAD · RBAC</div><h2>Usuarios y permisos</h2><p className="section-copy">Administra cuentas, roles, sucursales y permisos de acceso.</p></div>
        <button onClick={openCreate}>+ Nuevo usuario</button>
      </div>
      {message ? <div className="message">{message}</div> : null}

      <div className="usrd-workspace">
        <aside className="usrd-directory">
          <div className="usrd-directory-title"><b>Directorio de usuarios</b><span>{users.length}</span></div>
          <div className="usrd-search"><span>⌕</span><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Buscar por nombre o usuario..." /></div>
          <div className="usrd-filter-row">
            <select value={roleFilter} onChange={(e)=>setRoleFilter(e.target.value)}><option value="">Todos los roles</option>{availableRoles.map((r)=><option key={r}>{r}</option>)}</select>
            <select value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value)}><option value="">Estado</option><option value="active">Activos</option><option value="inactive">Inactivos</option></select>
          </div>
          <div className="usrd-user-list">{visibleUsers.map((u)=><button key={u.row_id} className={`usrd-user-item ${selected?.row_id===u.row_id?'active':''}`} onClick={()=>{selectUser(u);setActiveTab('summary')}}>
            <span className="usrd-avatar">{initials(u)}</span><span className="usrd-user-copy"><b>{u.nombre || 'Sin nombre'}</b><small>@{u.username}</small><em>{u.rol}</em></span><i className={u.activo===false?'off':'on'} />
          </button>)}{visibleUsers.length===0?<div className="usrd-empty">No hay usuarios que coincidan.</div>:null}</div>
        </aside>

        <main className="usrd-detail">{selected ? <>
          <header className="usrd-profile-head"><div className="usrd-profile-id"><span className="usrd-avatar large">{initials(selected)}</span><div><h3>{selected.nombre || 'Sin nombre'}</h3><p>@{selected.username}</p><div><span className="usrd-role-badge">{selected.rol}</span><span className={`usrd-state ${selected.activo===false?'inactive':''}`}>{selected.activo===false?'Inactivo':'Activo'}</span></div></div></div><button className="secondary compact" onClick={()=>setActiveTab('summary')}>Editar usuario</button></header>
          <nav className="usrd-tabs">{[['summary','Resumen'],['roles','Roles y permisos'],['branches','Sucursales'],['activity','Actividad reciente'],['security','Seguridad']].map(([id,label])=><button key={id} className={activeTab===id?'active':''} onClick={()=>setActiveTab(id)}>{label}</button>)}</nav>

          {activeTab==='summary'?<div className="usrd-tab-body">
            <div className="usrd-summary-grid"><section className="usrd-card"><div className="usrd-card-head"><h4>Información del usuario</h4><span>Cuenta</span></div><div className="usrd-info-grid"><label>Nombre<input value={selected.nombre||''} onChange={(e)=>setSelected(x=>({...x,nombre:e.target.value}))}/></label><label>Usuario<input value={selected.username||''} readOnly title="El usuario de cuentas existentes se conserva para proteger sesiones y permisos internos."/></label><label>Rol<select value={selected.rol} onChange={(e)=>{const rol=e.target.value;setSelected(x=>({...x,rol,sucursal_principal:rol==='SUPERADMIN'?'':x.sucursal_principal,sucursales_permitidas:rol==='SUPERADMIN'?[]:x.sucursales_permitidas}))}}>{(meta.roles||[]).map(r=><option key={r}>{r}</option>)}</select></label><label>Estado<select value={selected.activo===false?'inactive':'active'} onChange={(e)=>setSelected(x=>({...x,activo:e.target.value==='active'}))}><option value="active">Activo</option><option value="inactive">Inactivo</option></select></label></div><div className="usrd-save-row"><button onClick={saveUser}>Guardar cambios</button></div></section>
            <section className="usrd-card" data-fix="GMX_SUPERADMIN_IDENTITY_R1"><div className="usrd-card-head"><h4>Identidad y acceso</h4><span>Solo SUPERADMIN</span></div><div className="usrd-info-grid"><label>Correo<input type="email" value={selected.email||''} onChange={(e)=>setSelected(x=>({...x,email:e.target.value}))}/></label><label>Usuario<input value={selected.username||''} onChange={(e)=>setSelected(x=>({...x,username:e.target.value.toLowerCase()}))}/></label><label>ContraseÃ±a nueva<input type="password" value={identityPassword} onChange={(e)=>setIdentityPassword(e.target.value)} placeholder="Dejar vacÃ­o para conservar"/></label><button type="button" onClick={saveIdentity} disabled={!selected.email||!selected.username||(identityPassword.length>0&&identityPassword.length<10)}>Guardar identidad</button></div></section><section className="usrd-card"><div className="usrd-card-head"><h4>Permisos sensibles</h4><button className="linklike" onClick={()=>setActiveTab('roles')}>Gestionar permisos</button></div><div className="usrd-sensitive-list">{sensitiveModules.length?sensitiveModules.map(m=><div key={m.id}><span><b>{m.label}</b><small>{m.id}</small></span><strong>{val(m.id,'autorizar')?'Total':val(m.id,'editar')?'Editar':val(m.id,'leer')?'Lectura':'Sin acceso'}</strong></div>):<p className="usrd-muted">No hay módulos sensibles identificados.</p>}</div></section>
          </div>
          <div className="usrd-bottom-grid"><section className="usrd-card usrd-role-distribution"><div className="usrd-card-head"><h4>Distribución por rol</h4><span>{users.length} usuarios</span></div><div className="usrd-donut" style={{'--total':Math.max(users.length,1)}}><div><b>{users.length}</b><small>Total</small></div></div><div className="usrd-role-legend">{roleDistribution.map(x=><p key={x.role}><span>{x.role}</span><b>{x.count}</b></p>)}</div></section><section className="usrd-card"><div className="usrd-card-head"><h4>Alcance actual</h4><button className="linklike" onClick={()=>setActiveTab('branches')}>Ver sucursales</button></div><div className="usrd-scope"><b>{selected.rol==='SUPERADMIN'?'Todas las sucursales':branchName(selected.sucursal_principal)}</b><p>{selected.rol==='SUPERADMIN'?'Alcance global implícito.':`${(selected.sucursales_permitidas||[]).length} sucursal(es) permitida(s).`}</p></div></section></div>
          </div>:null}

          {activeTab==='roles'?<div className="usrd-tab-body"><section className="usrd-card"><div className="usrd-card-head"><div><h4>Roles y permisos</h4><p>Permisos por módulo y acción.</p></div>{selected.rol!=='SUPERADMIN'?<button className="secondary compact" onClick={()=>{setPermissions(x=>x.map(p=>({...p,_custom:false})));setDirty(true)}}>Restablecer al rol</button>:null}</div>{selected.rol==='SUPERADMIN'?<div className="rbac-info">SUPERADMIN tiene permisos totales implícitos.</div>:<div className="permission-table-wrap"><table className="permission-table"><thead><tr><th>Módulo</th>{actionKeys.map(([k,l])=><th key={k}>{l}</th>)}<th>Atajo</th></tr></thead><tbody>{(meta.modules||[]).map(m=><tr key={m.id}><td><b>{m.label}</b><small>{m.id}</small></td>{actionKeys.map(([k])=><td key={k}><input type="checkbox" checked={val(m.id,k)} onChange={(e)=>setVal(m.id,k,e.target.checked)}/></td>)}<td><select defaultValue="" onChange={(e)=>{if(e.target.value)preset(m.id,e.target.value);e.target.value=''}}><option value="">Aplicar…</option><option value="NONE">Sin acceso</option><option value="READ">Solo lectura</option><option value="OPERATE">Operar</option><option value="FULL">Total</option></select></td></tr>)}</tbody></table></div>}{selected.rol!=='SUPERADMIN'?<div className="usrd-permission-save"><label>Tu contraseña actual<input type="password" value={security.currentPassword} onChange={(e)=>setSecurity(x=>({...x,currentPassword:e.target.value}))}/></label><button disabled={!dirty} onClick={savePermissions}>Guardar permisos</button></div>:null}</section></div>:null}

          {activeTab==='branches'?<div className="usrd-tab-body"><section className="usrd-card"><div className="usrd-card-head"><h4>Sucursales</h4><span>Alcance del usuario</span></div>{selected.rol==='SUPERADMIN'?<div className="rbac-info">SUPERADMIN: alcance global implícito.</div>:selected.rol==='OPERADOR'?<label>Sucursal asignada<select value={selected.sucursal_principal||''} onChange={(e)=>{const id=e.target.value;setSelected(x=>({...x,sucursal_principal:id,sucursales_permitidas:id?[id]:[]}))}}><option value="">Selecciona una sucursal</option>{(meta.branches||[]).map(b=><option key={b.id_sucursal} value={b.id_sucursal}>{b.nombre_sucursal}</option>)}</select></label>:<><label>Sucursal principal<select value={selected.sucursal_principal||''} onChange={(e)=>setSelected(x=>({...x,sucursal_principal:e.target.value}))}><option value="">Sin restricción</option>{(meta.branches||[]).map(b=><option key={b.id_sucursal} value={b.id_sucursal}>{b.nombre_sucursal}</option>)}</select></label><div className="branch-scope-box"><b>Sucursales permitidas</b>{(meta.branches||[]).map(b=><label key={b.id_sucursal}><input type="checkbox" checked={(selected.sucursales_permitidas||[]).includes(b.id_sucursal)} onChange={()=>toggleBranch(selected,setSelected,b.id_sucursal)}/>{b.nombre_sucursal}</label>)}</div></>}<div className="usrd-save-row"><button disabled={selected.rol==='OPERADOR'&&!selected.sucursal_principal} onClick={saveUser}>Guardar alcance</button></div></section></div>:null}

          {activeTab==='activity'?<div className="usrd-tab-body"><section className="usrd-card usrd-empty-card"><h4>Actividad reciente</h4><p>Este módulo actual no expone un historial de actividad del usuario. No se muestran datos inventados.</p></section></div>:null}

          {activeTab==='security'?<div className="usrd-tab-body"><section className="usrd-card usrd-security"><div className="usrd-card-head"><h4>Seguridad</h4><span>Contraseña y sesiones</span></div><div className="usrd-info-grid"><label>Tu contraseña actual<input type="password" value={security.currentPassword} onChange={(e)=>setSecurity(x=>({...x,currentPassword:e.target.value}))}/></label><label>Nueva contraseña<input type="password" value={security.newPassword} onChange={(e)=>setSecurity(x=>({...x,newPassword:e.target.value}))}/></label><label>Confirmar contraseña<input type="password" value={security.confirmPassword} onChange={(e)=>setSecurity(x=>({...x,confirmPassword:e.target.value}))}/></label></div><div className="usrd-security-actions"><button onClick={changePassword}>Cambiar contraseña</button><button className="danger" onClick={revokeSessions}>Cerrar sesiones</button></div></section></div>:null}
        </>:<div className="usrd-no-selection">Selecciona un usuario del directorio.</div>}</main>
      </div>
    </section>

    {createOpen ? <div className="modal-backdrop tcg_store_template-user-modal-backdrop" onMouseDown={closeCreate}>
      <section className="modal tcg_store_template-user-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="section-head"><div><div className="eyebrow">ALTA DE USUARIO</div><h3>Nuevo usuario</h3><p>Crea una cuenta y define su rol y alcance.</p></div><button className="secondary compact" onClick={closeCreate}>Cerrar</button></div>
        <div className="tcg_store_template-user-modal-form">
          <label>Nombre<input value={form.nombre} onChange={(e) => setForm((x) => ({ ...x, nombre: e.target.value }))} /></label>
          <label>Usuario<input type="text" value={form.username||''} onChange={(e) => setForm((x) => ({ ...x, username: e.target.value.toLowerCase() }))} autoCapitalize="none" spellCheck={false} /></label>
          <label>{'Contrase\u00f1a'}<input type="password" value={form.password} onChange={(e) => setForm((x) => ({ ...x, password: e.target.value }))} /></label>
          <label>Rol<select value={form.rol} onChange={(e) => {const rol = e.target.value;setForm((x) => ({ ...x, rol, sucursal_principal: rol === 'SUPERADMIN' ? '' : x.sucursal_principal, sucursales_permitidas: rol === 'SUPERADMIN' ? [] : x.sucursales_permitidas }));}}>{(meta.roles || []).map((r) => <option key={r}>{r}</option>)}</select></label>
          {form.rol === 'OPERADOR' ? <>
            <label className="tcg_store_template-modal-wide">Sucursal asignada *<select value={form.sucursal_principal} onChange={(e) => {const id = e.target.value;setForm((x) => ({ ...x, sucursal_principal: id, sucursales_permitidas: id ? [id] : [] }));}}><option value="">Selecciona una sucursal</option>{(meta.branches || []).map((b) => <option key={b.id_sucursal} value={b.id_sucursal}>{b.nombre_sucursal}</option>)}</select></label>
            <div className="rbac-info tcg_store_template-modal-wide">El OPERADOR entra directamente al POS y trabaja únicamente con esta sucursal.</div>
          </> : form.rol !== 'SUPERADMIN' ? <>
            <label className="tcg_store_template-modal-wide">Sucursal principal<select value={form.sucursal_principal} onChange={(e) => setForm((x) => ({ ...x, sucursal_principal: e.target.value }))}><option value="">Sin restricción</option>{(meta.branches || []).map((b) => <option key={b.id_sucursal} value={b.id_sucursal}>{b.nombre_sucursal}</option>)}</select></label>
            <div className="branch-scope-box tcg_store_template-modal-wide"><b>Sucursales permitidas</b>{(meta.branches || []).map((b) => <label key={b.id_sucursal}><input type="checkbox" checked={form.sucursales_permitidas.includes(b.id_sucursal)} onChange={() => toggleBranch(form, setForm, b.id_sucursal)} />{b.nombre_sucursal}</label>)}</div>
          </> : <div className="rbac-info tcg_store_template-modal-wide">SUPERADMIN: alcance global.</div>}
          {form.rol === 'SUPERADMIN' ? <label className="tcg_store_template-modal-wide">Tu contraseña actual<input type="password" value={security.currentPassword} onChange={(e) => setSecurity((x) => ({ ...x, currentPassword: e.target.value }))} /></label> : null}
        </div>
        <div className="tcg_store_template-user-modal-actions"><button className="secondary" onClick={closeCreate}>Cancelar</button><button disabled={!form.email || form.password.length < 10 || form.rol === 'OPERADOR' && !form.sucursal_principal} onClick={createUser}>Crear usuario</button></div>
      </section>
    </div> : null}

  </div>;
}
