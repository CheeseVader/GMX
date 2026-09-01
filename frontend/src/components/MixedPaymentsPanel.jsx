import { brandText } from "../config/brand.js";import React, { useEffect, useMemo } from 'react';

const METHODS = ['EFECTIVO', 'TRANSFERENCIA', 'TARJETA'];

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mxn(value) {
  return num(value).toLocaleString('es-MX', {
    style: 'currency',
    currency: 'MXN'
  });
}

export default function MixedPaymentsPanel({
  total = 0,
  primaryMethod = 'EFECTIVO',
  payments = [],
  setPayments
}) {
  const saleTotal = Number(num(total).toFixed(2));

  useEffect(() => {
    setPayments((current) => {
      let rows = Array.isArray(current) && current.length ?
      current.map((row) => ({ ...row })) :
      [{ method: primaryMethod, amount: '', cashReceived: '', reference: '' }];

      rows[0].method = primaryMethod;

      // El método principal absorbe automáticamente el saldo restante.
      const secondaryTotal = rows.slice(1).reduce((sum, row) => sum + num(row.amount), 0);
      const primaryApplied = Math.max(0, Number((saleTotal - secondaryTotal).toFixed(2)));
      rows[0].amount = primaryApplied;

      if (primaryMethod === 'EFECTIVO') {
        // No aumentamos automáticamente el efectivo recibido una vez que el usuario ya escribió.
        if (rows[0].cashReceived === null || typeof rows[0].cashReceived === 'undefined' || rows[0].cashReceived === '') {
          rows[0].cashReceived = primaryApplied;
        }
      } else {
        rows[0].cashReceived = null;
      }

      return rows;
    });
  }, [primaryMethod, saleTotal, setPayments]);

  // Recalcular el importe principal inmediatamente cuando cambian métodos secundarios.
  useEffect(() => {
    setPayments((current) => {
      if (!Array.isArray(current) || !current.length) return current;
      const rows = current.map((row) => ({ ...row }));
      const secondaryTotal = rows.slice(1).reduce((sum, row) => sum + num(row.amount), 0);
      rows[0].amount = Math.max(0, Number((saleTotal - secondaryTotal).toFixed(2)));
      return rows;
    });
  }, [
  saleTotal,
  setPayments,
  payments.slice(1).map((row) => `${row.method}:${row.amount}`).join('|')]
  );

  const assigned = useMemo(
    () => payments.reduce((sum, row) => sum + num(row.amount), 0),
    [payments]
  );

  const secondaryAssigned = useMemo(
    () => payments.slice(1).reduce((sum, row) => sum + num(row.amount), 0),
    [payments]
  );

  const primary = payments[0] || {};
  const primaryApplied = num(primary.amount);
  const cashReceived = primary.method === 'EFECTIVO' ? num(primary.cashReceived) : 0;

  const secondaryExcess = Math.max(0, Number((secondaryAssigned - saleTotal).toFixed(2)));

  // Para efectivo, "pendiente" refleja lo que todavía falta recibir físicamente.
  // Si se recibe de más, el mismo indicador cambia a "Cambio".
  const cashPending = primary.method === 'EFECTIVO' ?
  Math.max(0, Number((primaryApplied - cashReceived).toFixed(2))) :
  Math.max(0, Number((saleTotal - assigned).toFixed(2)));

  const cashChange = primary.method === 'EFECTIVO' ?
  Math.max(0, Number((cashReceived - primaryApplied).toFixed(2))) :
  0;

  const statusLabel = secondaryExcess > 0 ?
  'Excedente' :
  cashChange > 0 ?
  'Cambio' :
  'Pendiente';

  const statusValue = secondaryExcess > 0 ?
  secondaryExcess :
  cashChange > 0 ?
  cashChange :
  cashPending;

  function patch(index, changes) {
    setPayments((current) => current.map((row, i) =>
    i === index ? { ...row, ...changes } : row
    ));
  }

  function addMethod() {
    const used = new Set(payments.map((row) => row.method));
    const method = METHODS.find((candidate) => !used.has(candidate));
    if (!method) return;

    const available = Math.max(0, Number((saleTotal - secondaryAssigned).toFixed(2)));
    setPayments((current) => [
    ...current,
    {
      method,
      amount: '',
      cashReceived: method === 'EFECTIVO' ? '' : null,
      reference: ''
    }]
    );
  }

  function removeMethod(index) {
    if (index === 0) return;
    setPayments((current) => current.filter((_, i) => i !== index));
  }

  return (
    <section className="pos-mixed-payments" style={{ display: 'grid', gap: 10, marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <strong>{'Distribuci\u00f3n del pago'}</strong>
        <button
          type="button"
          className="secondary compact"
          onClick={addMethod}
          disabled={payments.length >= METHODS.length}>
          
          {'+ Agregar m\u00e9todo'}
        </button>
      </div>

      {payments.map((row, index) => {
        const amount = num(row.amount);
        const received = num(row.cashReceived);
        const change = row.method === 'EFECTIVO' ?
        Math.max(0, Number((received - amount).toFixed(2))) :
        0;

        return (
          <div
            key={`${row.method}-${index}`}
            style={{
              display: 'grid',
              gap: 8,
              padding: 10,
              border: '1px solid #d0d5dd',
              borderRadius: 12
            }}>
            
            {index === 0 ?
            <>
                <div>
                  <small>{'M\u00e9todo principal'}</small>
                  <strong style={{ display: 'block' }}>
                    {row.method.charAt(0) + row.method.slice(1).toLowerCase()}
                  </strong>
                </div>

                <div>
                  <small>{row.method === 'EFECTIVO' ? 'Efectivo a cobrar' : 'Importe aplicado'}</small>
                  <strong style={{ display: 'block', fontSize: '1.05rem' }}>{mxn(amount)}</strong>
                </div>
              </> :

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'end' }}>
                <label>
                  {'M\u00e9todo'}
                  <select
                  value={row.method}
                  onChange={(event) => {
                    const next = event.target.value;
                    patch(index, {
                      method: next,
                      cashReceived: next === 'EFECTIVO' ? amount : null,
                      reference: ''
                    });
                  }}>
                  
                    {METHODS.
                  filter((method) => method === row.method || !payments.some((p, i) => i !== index && p.method === method)).
                  map((method) =>
                  <option key={method} value={method}>
                          {method.charAt(0) + method.slice(1).toLowerCase()}
                        </option>
                  )}
                  </select>
                </label>

                <label>
                  Importe aplicado
                  <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={row.amount ?? ''}
                  onChange={(event) => patch(index, { amount: event.target.value })} />
                
                </label>

                <button type="button" className="secondary compact" onClick={() => removeMethod(index)}>
                  {'\u00d7'}</button>
              </div>
            }

            {row.method === 'EFECTIVO' ?
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignItems: 'end' }}>
                <label>
                  Efectivo recibido
                  <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={row.cashReceived ?? ''}
                  onChange={(event) => patch(index, { cashReceived: event.target.value })} />
                
                </label>
                <div>
                  <small>{change > 0 ? 'Cambio' : 'Pendiente'}</small>
                  <strong style={{ display: 'block', fontSize: '1.25rem' }}>
                    {mxn(change > 0 ? change : Math.max(0, amount - received))}
                  </strong>
                </div>
              </div> :
            null}

            {index > 0 && row.method === 'TRANSFERENCIA' ?
            <label>
                Referencia / folio
                <input
                value={row.reference || ''}
                onChange={(event) => patch(index, { reference: event.target.value })}
                placeholder="Referencia bancaria" />
              
              </label> :
            null}

            {row.method === 'TARJETA' ?
            <div style={{ fontSize: '.86rem', lineHeight: 1.35 }}>
                {brandText("Tarjeta queda preparada para Mercado Pago. GMX no marcará esta porción como autorizada hasta validar la integración de Mercado Pago.")}
              </div> :
            null}
          </div>);

      })}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
        <div>
          <small>Total venta</small>
          <strong style={{ display: 'block' }}>{mxn(saleTotal)}</strong>
        </div>
        <div>
          <small>Total asignado</small>
          <strong style={{ display: 'block' }}>{mxn(assigned)}</strong>
        </div>
        <div>
          <small>{statusLabel}</small>
          <strong style={{ display: 'block' }}>{mxn(statusValue)}</strong>
        </div>
      </div>
    </section>);

}
