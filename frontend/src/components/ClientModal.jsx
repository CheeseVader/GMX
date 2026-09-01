import { brandText } from "../config/brand.js";import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../services/api.js';
import AdminGeoSelectFields from './AdminGeoSelectFields.jsx';

const empty = {
  id_cliente: '',
  nombre: '',
  telefono: '',
  email: '',
  direccion: '',
  cp: '',
  estado: '',
  municipio: '',
  ciudad: '',
  colonia: '',
  pais: 'México',
  rfc: '',
  razon_social: '',
  regimen_fiscal: '',
  cp_fiscal: '',
  uso_cfdi: ''
};

export default function ClientModal({
  open,
  client,
  onClose,
  onSave,
  onDelete
}) {
  const [form, setForm] = useState(empty);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (client) {
      setForm({
        id_cliente: client.id_cliente ?? '',
        nombre: client.nombre ?? '',
        telefono: client.telefono ?? '',
        email: client.email ?? '',
        direccion: client.direccion ?? '',
        cp: client.cp ?? '',
        estado: client.estado ?? '',
        municipio: client.municipio ?? '',
        ciudad: client.ciudad ?? '',
        colonia: client.colonia ?? '',
        pais: client.pais || 'México',
        rfc: client.rfc ?? '',
        razon_social: client.razon_social ?? '',
        regimen_fiscal: client.regimen_fiscal ?? '',
        cp_fiscal: client.cp_fiscal ?? '',
        uso_cfdi: client.uso_cfdi ?? ''
      });
    } else {
      setForm(empty);
    }

    setFormError('');
    setSaving(false);
  }, [client, open]);


  if (!open) return null;

  function change(event) {
    const { name, value } = event.target;
    if (name === 'telefono') {
      if (value !== '' && !/^\d+$/.test(value)) return;
      if (value.length > 15) return;
    }
    setForm((current) => ({ ...current, [name]: value }));
  }

  function validateForm() {
    if (!String(form.nombre || '').trim()) return 'Ingresa el nombre del cliente.';
    if (!String(form.email || '').trim() && !String(form.telefono || '').trim()) return 'Captura al menos correo electrónico o teléfono.';
    if (form.telefono && !/^\d+$/.test(form.telefono)) return 'El teléfono solo puede contener números del 0 al 9.';
    if (form.telefono && (form.telefono.length < 10 || form.telefono.length > 15)) return 'El teléfono debe contener entre 10 y 15 dígitos.';
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return 'Escribe un correo electrónico válido.';
    if (form.rfc && !/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(String(form.rfc).toUpperCase())) return 'El RFC no tiene un formato válido.';
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
    setSaving(true);
    setFormError('');
    try {
      await onSave(form);
    } catch (error) {
      const msg = String(error?.message || 'No fue posible guardar el cliente.');
      setFormError(msg);
      window.shinyNotify?.(msg, { type: 'error', duration: 6000 });
    } finally {
      setSaving(false);
    }
  }


  return createPortal(
    <div className="modal-backdrop shiny-portal-backdrop" onMouseDown={onClose}>
      <div
        className="modal client-modal"
        onMouseDown={(event) => event.stopPropagation()}>
        
        <div className="modal-head">
          <div>
            <div className="eyebrow">{brandText("GMX CLIENTES")}</div>
            <h2>
              {client ?
              `Editar ${client.nombre || client.id_cliente}` :
              'Nuevo cliente'}
            </h2>
          </div>

          <button className="icon-btn" type="button" onClick={onClose}>
            ×
          </button>
        </div>

        <form onSubmit={submit}>
          <div className="form-grid">
            <label>
              ID Cliente
              <input value={client?.id_cliente || 'Se genera automáticamente'} disabled readOnly />
            </label>

            <label>
              Nombre
              <input
                name="nombre"
                required
                value={form.nombre}
                onChange={change} />
              
            </label>

            <label>
              Teléfono
              <input
                name="telefono"
                type="tel"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength="15"
                autoComplete="tel"
                value={form.telefono}
                onChange={change}
                onPaste={(event) => {
                  const pasted = event.clipboardData.getData('text');
                  if (!/^\d+$/.test(pasted)) event.preventDefault();
                }}
                placeholder="Solo números" />
              
            </label>

            <label>
              Email
              <input
                name="email"
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={change} />
              
            </label>

            <div className="wide">
              <AdminGeoSelectFields
                value={form}
                onChange={(next) => setForm((current) => ({ ...current, ...next }))}
                includeAddress={true} />
              
            </div>
          </div>

          <details className="fiscal-details">
            <summary>Datos fiscales (opcional, solo para facturación)</summary>
            <div className="form-grid fiscal-grid">
              <label>RFC<input name="rfc" maxLength="13" value={form.rfc} onChange={change} placeholder="Opcional" /></label>
              <label>CP fiscal<input name="cp_fiscal" inputMode="numeric" maxLength="5" value={form.cp_fiscal} onChange={change} /></label>
              <label className="wide">Razón social<input name="razon_social" value={form.razon_social} onChange={change} /></label>
              <label>Régimen fiscal<input name="regimen_fiscal" value={form.regimen_fiscal} onChange={change} /></label>
              <label>Uso CFDI<input name="uso_cfdi" value={form.uso_cfdi} onChange={change} /></label>
            </div>
            <div className="inline-note">El RFC no se usa para iniciar sesión ni para identificar de forma única al cliente.</div>
          </details>

          {formError ? <div className="client-form-error" role="alert">{formError}</div> : null}

          <div className="modal-actions">
            {client ?
            <button
              type="button"
              className="danger"
              onClick={() => onDelete(client)}>
              
                Eliminar
              </button> :
            null}

            <div className="spacer" />

            <button
              type="button"
              className="secondary"
              onClick={onClose}
              disabled={saving}>
              
              Cancelar
            </button>

            <button type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
