import { brandText } from "../config/brand.js";import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import AdminGeoSelectFields from './AdminGeoSelectFields.jsx';

const empty = {
  id_sucursal: '',
  nombre_sucursal: '',
  codigo: '',
  direccion: '',
  ciudad: '',
  municipio: '',
  estado: '',
  cp: '',
  colonia: '',
  pais: 'México',
  telefono: '',
  email: '',
  activa: true
};

export default function BranchModal({ open, branch, onClose, onSave }) {
  const [form, setForm] = useState(empty);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setForm(branch ? {
      id_sucursal: branch.id_sucursal ?? '',
      nombre_sucursal: branch.nombre_sucursal ?? '',
      codigo: branch.codigo ?? '',
      direccion: branch.direccion ?? '',
      ciudad: branch.ciudad ?? '',
      municipio: branch.municipio ?? branch.ciudad ?? '',
      estado: branch.estado ?? '',
      cp: branch.cp ?? '',
      colonia: branch.colonia ?? '',
      pais: branch.pais || 'México',
      telefono: branch.telefono ?? '',
      email: branch.email ?? '',
      activa: branch.activa !== false
    } : empty);
    setFormError('');
    setSaving(false);
  }, [branch, open]);

  if (!open) return null;

  function change(event) {
    const { name, value, type, checked } = event.target;
    setForm((current) => ({
      ...current,
      [name]: type === 'checkbox' ? checked : value
    }));
  }

  function validateForm() {
    if (!String(form.nombre_sucursal || '').trim()) return 'Ingresa el nombre de la sucursal.';
    if (!String(form.estado || '').trim()) return 'Selecciona el estado.';
    if (!String(form.ciudad || form.municipio || '').trim()) return 'Selecciona el municipio o ciudad.';
    if (!/^\d{5}$/.test(String(form.cp || '').trim())) return 'Selecciona un código postal válido.';
    if (!String(form.colonia || '').trim()) return 'Selecciona la colonia o asentamiento.';
    const phone = String(form.telefono || '').replace(/\D/g, '');
    if (phone && (phone.length < 10 || phone.length > 15)) return 'El teléfono debe contener entre 10 y 15 dígitos.';
    const email = String(form.email || '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Escribe un correo electrónico válido.';
    return '';
  }

  async function submit(event) {
    event.preventDefault();
    const error = validateForm();
    if (error) {
      setFormError(error);
      window.shinyNotify?.(error, { type: 'error', duration: 5000 });
      return;
    }
    setFormError('');
    setSaving(true);
    try {
      await onSave(form);
    } catch (error) {
      const msg = String(error?.message || 'No fue posible guardar la sucursal.');
      setFormError(msg);
      window.shinyNotify?.(msg, { type: 'error', duration: 6000 });
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="modal-backdrop shiny-portal-backdrop" onMouseDown={onClose}>
      <div className="modal shiny-branch-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="eyebrow">{brandText("GMX SUCURSALES")}</div>
            <h2>{branch ? `Editar ${branch.nombre_sucursal}` : 'Nueva sucursal'}</h2>
          </div>
          <button className="icon-btn" type="button" onClick={onClose}>×</button>
        </div>

        <form className="branch-form" onSubmit={submit} noValidate>
          <div className="branch-core-grid">
            <label>ID Sucursal<input value={branch?.id_sucursal || 'Se genera automáticamente'} disabled readOnly /></label>
            <label>Código<input name="codigo" maxLength="30" value={form.codigo} onChange={change} placeholder="Opcional" /></label>
            <label>Nombre *<input name="nombre_sucursal" required maxLength="120" value={form.nombre_sucursal} onChange={change} placeholder="Ej. Sucursal Rosarito" /></label>
          </div>

          <AdminGeoSelectFields
            value={form}
            onChange={(next) => setForm((current) => ({ ...current, ...next }))}
            includeAddress={true}
            required={true} />
          

          <div className="branch-contact-grid">
            <label>Teléfono
              <input className="branch-phone-input" name="telefono" type="tel" inputMode="tel" maxLength="24" value={form.telefono} onChange={change} placeholder="Ej. 664 123 4567" />
            </label>
            <label>Email
              <input name="email" type="email" maxLength="254" value={form.email} onChange={change} placeholder="correo@empresa.com" />
            </label>
            <label className="branch-active-toggle">
              <input name="activa" type="checkbox" checked={form.activa} onChange={change} />
              <span><strong>Sucursal activa</strong><small>Disponible para operación, inventario y POS.</small></span>
            </label>
          </div>

          {formError ? <div className="branch-form-error" role="alert">{formError}</div> : null}

          <div className="modal-actions branch-modal-actions">
            <div className="spacer" />
            <button type="button" className="secondary" onClick={onClose} disabled={saving}>Cancelar</button>
            <button type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
