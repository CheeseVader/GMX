import { brandText } from "../config/brand.js";import { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api.js';
import '../phase_shiny_exact_views_r23.css';
import '../commercial_minimal_r69.css';
import '../commercial_quotes_wizard_r70.css';
import '../commercial_module_purchaseflow_r71.css';
import '../commercial_option3_icons_r66.css';
import '../commercial_returns_r73.css';

import '../commercial_returns_standalone_r74.css';
import '../return_pin_authorization_r77.css';
import './CommercialPageR63.css';
const money = (v) => Number(v || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const asArray = (v) => Array.isArray(v) ? v : [];

const RESOURCES = [
['health', '/api/v1/commercial/health'],
['branches', '/api/v1/branches?includeInactive=false'],
['clients', '/api/v1/clients?limit=500'],
['products', '/api/v1/products?limit=1000'],
['tcgInventory', '/api/v1/tcg/inventory?limit=1000'],
['providers', '/api/v1/commercial/providers'],
['quotes', '/api/v1/commercial/quotes?limit=500'],
['payables', '/api/v1/commercial/payables?limit=500'],
['expenses', '/api/v1/commercial/expenses?limit=500'],
['returns', '/api/v1/commercial/returns?limit=500'],
['purchases', '/api/v1/purchases?limit=300']];


export default function CommercialPage() {
  const standaloneReturns = window.location.pathname === '/admin/devoluciones';
  const [tab, setTab] = useState(standaloneReturns ? 'returns' : 'quotes');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [health, setHealth] = useState(null);
  const [branches, setBranches] = useState([]);
  const [clients, setClients] = useState([]);
  const [products, setProducts] = useState([]);
  const [tcgInventory, setTcgInventory] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [providers, setProviders] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [payables, setPayables] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [returns, setReturns] = useState([]);

  const [quote, setQuote] = useState({ branchId: '', clientId: '', clientName: '', email: '', phone: '', validityDays: 15, discount: 0, notes: '', items: [] });
  const [providerEditId, setProviderEditId] = useState(null);
  const [provider, setProvider] = useState({ razon_social: '', nombre_comercial: '', rfc: '', contacto: '', telefono: '', email: '', direccion: '', ciudad: '', estado: '', cp: '', pais: 'México', terminos_pago: 'CONTADO', dias_credito: 0, moneda: 'MXN', banco: '', cuenta_referencia: '', notas: '', activo: true });
  const [payable, setPayable] = useState({ providerId: '', document: '', dueDate: '', total: 0, branchId: '', notes: '' });
  const [payablePayment, setPayablePayment] = useState(null);
  const [payablePaymentForm, setPayablePaymentForm] = useState({ amount: 0, paymentMethod: 'TRANSFERENCIA', reference: '', notes: '' });
  const [payablePayments, setPayablePayments] = useState([]);
  const [expense, setExpense] = useState({ branchId: '', expenseDate: '', category: 'GENERAL', subcategory: '', concept: '', providerId: '', provider: '', currency: 'MXN', subtotal: 0, taxes: 0, total: 0, paymentMethod: 'TRANSFERENCIA', reference: '', receiptUrl: '', notes: '' });
  const [returnOrderId, setReturnOrderId] = useState('');
  const [returnOrder, setReturnOrder] = useState(null);
  const [returnQty, setReturnQty] = useState({});
  const [returnCondition, setReturnCondition] = useState({});
  // Shiny_DEV_001D_CONDICION_DESTINO
  const [returnOptions, setReturnOptions] = useState({ reason: '', refund: false, refundMethod: 'EFECTIVO', refundReference: '', notes: '' });
  const [quoteClientSearch, setQuoteClientSearch] = useState('');
  const [quoteProductSearch, setQuoteProductSearch] = useState('');
  const [quoteHistorySearch, setQuoteHistorySearch] = useState('');
  const [quoteHistoryStatus, setQuoteHistoryStatus] = useState('');
  const [quoteClientOpen, setQuoteClientOpen] = useState(false);
  const [quoteProductOpen, setQuoteProductOpen] = useState(false);
  const [quoteConvert, setQuoteConvert] = useState(null);
  /* SHINY_QUOTE_VIEW_R63 */
  const [quoteView, setQuoteView] = useState(null);
  const [quoteConvertBranch, setQuoteConvertBranch] = useState('');
  const [quotePage, setQuotePage] = useState(1);
  const [quoteWizardOpen, setQuoteWizardOpen] = useState(false);
  const [quoteWizardStep, setQuoteWizardStep] = useState(1);
  const [returnPage, setReturnPage] = useState(1);
  const [providerPage, setProviderPage] = useState(1);
  const [payablePurchasePage, setPayablePurchasePage] = useState(1);
  const [payablePage, setPayablePage] = useState(1);
  const [expensePage, setExpensePage] = useState(1);
  const [providerModal, setProviderModal] = useState(false);
  const [payableModal, setPayableModal] = useState(false);
  const [expenseModal, setExpenseModal] = useState(false);
  const [returnModal, setReturnModal] = useState(false);
  const [returnWizardStep, setReturnWizardStep] = useState(1);
  const [returnSearch, setReturnSearch] = useState('');
  const [returnStatusFilter, setReturnStatusFilter] = useState('');
  const [returnStockFilter, setReturnStockFilter] = useState('');
  const [returnAuthCapability, setReturnAuthCapability] = useState({ canAuthorize: false, loaded: false });
  const [returnGeneratedPin, setReturnGeneratedPin] = useState(null);
  const [returnPinBusy, setReturnPinBusy] = useState(false);
  const [returnApprovalOpen, setReturnApprovalOpen] = useState(false);
  const [returnApprovalPin, setReturnApprovalPin] = useState('');
  const [returnApprovalBusy, setReturnApprovalBusy] = useState(false);
  const [returnPendingPayload, setReturnPendingPayload] = useState(null);

  async function load() {
    setLoading(true);
    const settled = await Promise.allSettled(RESOURCES.map(async ([name, url]) => [name, await api(url)]));
    const nextErrors = {};
    for (const result of settled) {
      if (result.status !== 'fulfilled') continue;
      const [name, payload] = result.value;
      const data = payload?.data;
      if (name === 'health') setHealth(data);
      if (name === 'branches') setBranches(asArray(data));
      if (name === 'clients') setClients(asArray(data));
      if (name === 'products') setProducts(asArray(data));
      if (name === 'tcgInventory') setTcgInventory(asArray(data));
      if (name === 'providers') setProviders(asArray(data));
      if (name === 'quotes') setQuotes(asArray(data));
      if (name === 'payables') setPayables(asArray(data));
      if (name === 'expenses') setExpenses(asArray(data));
      if (name === 'returns') setReturns(asArray(data));
      if (name === 'purchases') setPurchases(asArray(data));
    }
    settled.forEach((result, index) => {
      if (result.status === 'rejected') nextErrors[RESOURCES[index][0]] = result.reason?.message || 'Error de carga';
    });
    setErrors(nextErrors);
    setLoading(false);
    setExpense((x) => {
      if (x.branchId || !branches.length) return x;
      return { ...x, branchId: branches[0]?.id_sucursal || '' };
    });
  }

  useEffect(() => {load();}, []);

  useEffect(() => {
    let active = true;
    api('/api/v1/commercial/returns/authorization/capability')
      .then((response) => {
        if (!active) return;
        setReturnAuthCapability({ ...(response?.data || {}), loaded: true });
      })
      .catch(() => {
        if (!active) return;
        setReturnAuthCapability({ canAuthorize: false, loaded: true });
      });
    return () => { active = false; };
  }, []);

  async function generateReturnAuthorizationPin() {
    if (returnPinBusy) return;
    setReturnPinBusy(true);
    setMessage('');
    try {
      const response = await api('/api/v1/commercial/returns/pin/generate', {
        method: 'POST',
        body: '{}'
      });
      setReturnGeneratedPin(response?.data || null);
    } catch (error) {
      setMessage(error?.message || 'No fue posible generar el código de autorización.');
    } finally {
      setReturnPinBusy(false);
    }
  }

  // Shiny_DEV_AUD_001B_RETURN_DEEPLINK
  // Permite abrir Gestión Comercial directamente desde un pedido PAGADO.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedTab = String(params.get('tab') || '').toLowerCase();
    if (standaloneReturns) setTab('returns');
    const orderId = String(params.get('orderId') || '').trim();

    if (requestedTab === 'returns') setTab('returns');
    if (!orderId) return;

    setReturnOrderId(orderId);
    setTab('returns');

    let cancelled = false;
    (async () => {
      try {
        const r = await api(`/api/v1/commercial/returns-order/${encodeURIComponent(orderId)}`);
        if (cancelled) return;
        setReturnOrder(r.data);
        setReturnQty({});
        setReturnCondition(Object.fromEntries((r.data?.detalles || []).map((d) => [d.id_detalle, 'VENDIBLE'])));
        setMessage('');
        // Al venir del POS preparamos devolución real, sin ejecutarla automáticamente.
        setReturnOptions((x) => ({
          ...x,
          reason: '',
          refund: false,
          refundMethod: String(r.data?.metodo_pago || 'EFECTIVO').toUpperCase() === 'MIXTO' ?
          'EFECTIVO' :
          String(r.data?.metodo_pago || 'EFECTIVO').toUpperCase(),
          refundReference: '',
          paymentId: '',
          notes: ''
        }));
      } catch (e) {
        if (!cancelled) setMessage(e.message);
      }
    })();

    return () => {cancelled = true;};
  }, []);
  useEffect(() => {
    if (!expense.branchId && branches[0]) setExpense((x) => ({ ...x, branchId: branches[0].id_sucursal }));
    if (!quote.branchId && branches[0]) setQuote((x) => ({ ...x, branchId: branches[0].id_sucursal }));
    if (!payable.branchId && branches[0]) setPayable((x) => ({ ...x, branchId: branches[0].id_sucursal }));
  }, [branches]);

  const failedCount = Object.keys(errors).length;
  const healthOk = health && Object.values(health).every((x) => x?.ok !== false);
  const commercialOp3Metrics = useMemo(() => {
    const activeProviders = providers.filter((p) => p.activo !== false).length;
    const pendingPayables = payables.filter((x) => Number(x.saldo || 0) > 0 && String(x.estado || '').toUpperCase() !== 'CANCELADA');
    const pendingPayablesTotal = pendingPayables.reduce((s,x) => s + Number(x.saldo || 0), 0);
    const expenseTotal = expenses.reduce((s,x) => s + Number(x.total || 0), 0);
    const paidPayables = payables.reduce((s,x) => s + Number(x.pagado || 0), 0);
    const quoteTotal = quotes.reduce((s,x) => s + Number(x.total || 0), 0);
    const returnTotal = returns.reduce((s,x) => s + Number(x.importe || 0), 0);
    const financeBase = Math.max(1, pendingPayablesTotal + paidPayables + expenseTotal);
    return {
      activeProviders,
      pendingPayables: pendingPayables.length,
      pendingPayablesTotal,
      expenseTotal,
      paidPayables,
      quoteTotal,
      returnTotal,
      financeBase,
      pendingPct: Math.round((pendingPayablesTotal / financeBase) * 100),
      paidPct: Math.round((paidPayables / financeBase) * 100),
      expensePct: Math.round((expenseTotal / financeBase) * 100),
      recentExpenses: [...expenses].sort((a,b) => new Date(b.fecha_gasto || 0) - new Date(a.fecha_gasto || 0)).slice(0,5)
    };
  }, [providers, payables, expenses, quotes, returns]);

  function useClient(id) {
    const c = clients.find((x) => String(x.id_cliente) === String(id));
    if (!c) return;
    setQuote((x) => ({ ...x, clientId: c.id_cliente || '', clientName: c.nombre || '', email: c.email || '', phone: c.telefono || '' }));
    setQuoteClientSearch(c.nombre || '');
    setQuoteClientOpen(false);
  }

  function addQuoteItem(key) {
    const [kind, id] = String(key || '').split(':', 2);
    if (kind === 'PRODUCT') {
      const p = products.find((x) => String(x.id) === String(id));if (!p) return;
      setQuote((x) => {
        const existing = x.items.findIndex((y) => y.itemType === 'PRODUCT' && String(y.productId) === String(p.id));
        if (existing >= 0) return { ...x, items: x.items.map((y, j) => j === existing ? { ...y, quantity: Number(y.quantity || 0) + 1 } : y) };
        return { ...x, items: [...x.items, { itemType: 'PRODUCT', productId: p.id, inventoryId: null, sku: p.sku, name: p.nombre, category: p.categoria || '', quantity: 1, price: Number(p.precio || 0) }] };
      });
    } else if (kind === 'TCG') {
      const v = tcgInventory.find((x) => String(x.id_inventario) === String(id) && (!quote.branchId || String(x.id_sucursal) === String(quote.branchId)));if (!v) return;
      setQuote((x) => {
        const existing = x.items.findIndex((y) => y.itemType === 'TCG' && String(y.inventoryId) === String(v.id_inventario));
        if (existing >= 0) return { ...x, items: x.items.map((y, j) => j === existing ? { ...y, quantity: Math.min(Number(v.stock || 999999), Number(y.quantity || 0) + 1) } : y) };
        return { ...x, items: [...x.items, { itemType: 'TCG', productId: null, inventoryId: v.id_inventario, idCarta: v.id_carta, sku: v.sku, name: v.carta, cardNumber: v.numero_completo || '', rarity: v.rareza || '', condition: v.condicion || '', language: v.idioma || '', finish: v.acabado || '', branchId: v.id_sucursal, branchName: v.sucursal || '', stock: Number(v.stock || 0), quantity: 1, price: Number(Number(v.precio_oferta || 0) > 0 ? v.precio_oferta : v.precio || 0) }] };
      });
    }
    setQuoteProductSearch('');setQuoteProductOpen(false);
  }

  const filteredQuoteClients = useMemo(() => {
    const q = quoteClientSearch.trim().toLowerCase();
    const base = q ? clients.filter((c) => [c.nombre, c.telefono, c.email, c.id_cliente].some((v) => String(v || '').toLowerCase().includes(q))) : clients;
    return base.slice(0, 30);
  }, [clients, quoteClientSearch]);

  const quoteCatalog = useMemo(() => {
    const productRows = products.map((p) => ({ key: `PRODUCT:${p.id}`, kind: 'PRODUCT', name: p.nombre || 'Producto', sku: p.sku || '', id: p.id, price: Number(p.precio || 0), secondary: [p.sku, p.categoria].filter(Boolean).join(' · '), search: [p.nombre, p.sku, p.id, p.categoria, p.codigo_barras].filter(Boolean).join(' ') }));
    const cardRows = tcgInventory.filter((v) => Number(v.stock || 0) > 0 && (!quote.branchId || String(v.id_sucursal) === String(quote.branchId))).map((v) => ({ key: `TCG:${v.id_inventario}`, kind: 'TCG', name: v.carta || 'Carta TCG', sku: v.sku || '', id: v.id_inventario, price: Number(Number(v.precio_oferta || 0) > 0 ? v.precio_oferta : v.precio || 0), stock: Number(v.stock || 0), secondary: [v.numero_completo, v.rareza ? `(${v.rareza})` : '', v.condicion, v.idioma, v.acabado].filter(Boolean).join(' · '), search: [v.carta, v.numero_completo, v.rareza, v.sku, v.id_inventario, v.condicion, v.idioma, v.acabado].filter(Boolean).join(' ') }));
    return [...productRows, ...cardRows].sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'));
  }, [products, tcgInventory, quote.branchId]);

  const filteredQuoteProducts = useMemo(() => {
    const q = quoteProductSearch.trim().toLowerCase();
    const base = q ? quoteCatalog.filter((p) => String(p.search || '').toLowerCase().includes(q)) : quoteCatalog;
    return base.slice(0, 50);
  }, [quoteCatalog, quoteProductSearch]);

  const filteredQuotes = useMemo(() => {
    const q = quoteHistorySearch.trim().toLowerCase();
    return quotes.filter((row) => {
      const statusOk = !quoteHistoryStatus || String(row.estado || '').toUpperCase() === quoteHistoryStatus;
      const textOk = !q || [row.id, row.cliente, row.email, row.telefono, row.estado].
      some((v) => String(v || '').toLowerCase().includes(q));
      return statusOk && textOk;
    });
  }, [quotes, quoteHistorySearch, quoteHistoryStatus]);

  const quoteSubtotal = useMemo(() => quote.items.reduce((s, x) => s + Number(x.quantity || 0) * Number(x.price || 0), 0), [quote.items]);
  const quoteTotal = Math.max(0, quoteSubtotal - Number(quote.discount || 0));

  async function run(task, success) {
    try {
      setMessage('');
      const r = await task();
      setMessage(success(r));
      await load();
      return r;
    } catch (e) {setMessage(e.message);throw e;}
  }

  function openQuoteWizard() {
    setQuoteWizardStep(1);
    setQuoteClientOpen(false);
    setQuoteProductOpen(false);
    setQuoteWizardOpen(true);
  }

  function closeQuoteWizard() {
    setQuoteClientOpen(false);
    setQuoteProductOpen(false);
    setQuoteWizardOpen(false);
    setQuoteWizardStep(1);
  }

  function nextQuoteWizard() {
    if (quoteWizardStep === 1 && !String(quote.clientName || '').trim()) {
      setMessage('Selecciona o captura un cliente antes de continuar.');
      return;
    }
    if (quoteWizardStep === 2 && !quote.items.length) {
      setMessage('Agrega al menos un producto antes de continuar.');
      return;
    }
    setMessage('');
    setQuoteWizardStep((step) => Math.min(4, step + 1));
  }

  function previousQuoteWizard() {
    setMessage('');
    setQuoteWizardStep((step) => Math.max(1, step - 1));
  }
  async function createQuote() {
    try {
      await run(() => api('/api/v1/commercial/quotes', { method: 'POST', body: JSON.stringify(quote) }),
      (r) => `Cotización ${r.data.id} creada por ${money(r.data.total)}.`);
      setQuote({ branchId: quote.branchId || branches[0]?.id_sucursal || '', clientId: '', clientName: '', email: '', phone: '', validityDays: 15, discount: 0, notes: '', items: [] });
      setQuoteWizardOpen(false);
      setQuoteWizardStep(1);
      setQuoteClientSearch('');
      setQuoteProductSearch('');
      setQuotePage(1);
    } catch {}
  }
  async function sendQuote(q) {
    if (!q.email) {
      setMessage('La cotización no tiene un correo de cliente.');
      return;
    }
    try {
      await run(
        () => api(`/api/v1/commercial/quotes/${q.row_id}/send`, { method: 'POST', body: '{}' }),
        (r) => `Cotización ${q.id} enviada correctamente a ${r.data.mail?.to || q.email}.`
      );
    } catch {}
  }
  async function quoteStatus(rowId, status) {
    try {await run(() => api(`/api/v1/commercial/quotes/${rowId}/status`, { method: 'POST', body: JSON.stringify({ status }) }), () => `Cotización actualizada a ${status}.`);} catch {}
  }
  async function openQuoteView(q) {
    try {
      const r=await api(`/api/v1/commercial/quotes/${q.row_id}`);
      setQuoteView(r.data||q);
    } catch (error) {
      setMessage(error?.message||'No fue posible abrir la cotizaciÃ³n.');
    }
  }
  function openQuoteConvert(q) {
    setQuoteConvert(q);
    setQuoteConvertBranch(branches[0]?.id_sucursal || '');
  }
  async function confirmQuoteConvert() {
    if (!quoteConvert || !quoteConvertBranch) return;
    try {
      await run(
        () => api(`/api/v1/commercial/quotes/${quoteConvert.row_id}/convert`, {
          method: 'POST', body: JSON.stringify({ branchId: quoteConvertBranch, paymentMethod: 'POR_DEFINIR' })
        }),
        (r) => `Pedido ${r.data.id_pedido} creado sin modificar inventario.`
      );
      setQuoteConvert(null);setQuoteConvertBranch('');
    } catch {}
  }
  const emptyProvider = { razon_social: '', nombre_comercial: '', rfc: '', contacto: '', telefono: '', email: '', direccion: '', ciudad: '', estado: '', cp: '', pais: 'México', terminos_pago: 'CONTADO', dias_credito: 0, moneda: 'MXN', banco: '', cuenta_referencia: '', notas: '', activo: true };
  function editProvider(p) {
    setProviderEditId(p.row_id);
    setProvider({ ...emptyProvider, ...p, telefono: String(p.telefono || '') });
  }
  function clearProviderForm() {setProviderEditId(null);setProvider(emptyProvider);}
  async function saveProvider() {
    try {
      const url = providerEditId ? `/api/v1/commercial/providers/${providerEditId}` : '/api/v1/commercial/providers';
      await run(() => api(url, { method: providerEditId ? 'PUT' : 'POST', body: JSON.stringify(provider) }),
      (r) => `Proveedor ${r.data.nombre_comercial || r.data.razon_social} ${providerEditId ? 'actualizado' : 'creado'}.`);
      clearProviderForm();
    } catch {}
  }
  async function toggleProvider(p) {
    try {await run(() => api(`/api/v1/commercial/providers/${p.row_id}`, { method: 'PUT', body: JSON.stringify({ ...p, activo: p.activo === false }) }), () => `Proveedor ${p.activo === false ? 'activado' : 'desactivado'}.`);} catch {}
  }
  async function createPayable() {
    try {
      await run(() => api('/api/v1/commercial/payables', { method: 'POST', body: JSON.stringify(payable) }), (r) => `CxP ${r.data.id} creada.`);
      setPayable((x) => ({ providerId: '', document: '', dueDate: '', total: 0, branchId: x.branchId || branches[0]?.id_sucursal || '', notes: '' }));
    } catch {}
  }
  async function payableFromPurchase(rowId) {
    try {await run(() => api(`/api/v1/commercial/payables/from-purchase/${rowId}`, { method: 'POST', body: '{}' }), (r) => `CxP ${r.data.id} ligada a compra.`);} catch {}
  }
  async function syncPayables() {
    try {await run(() => api('/api/v1/commercial/payables/sync-purchases', { method: 'POST', body: '{}' }), (r) => `${r.data.created} CxP creada(s) desde compras a crédito.`);} catch {}
  }
  async function openPayablePayment(x) {
    setPayablePayment(x);
    setPayablePaymentForm({ amount: Number(x.saldo || 0), paymentMethod: 'TRANSFERENCIA', reference: '', notes: '' });
    try {const r = await api(`/api/v1/commercial/payables/${x.id}/payments`);setPayablePayments(r.data || []);} catch {setPayablePayments([]);}
  }
  async function confirmPayablePayment() {
    if (!payablePayment) return;
    try {
      await run(() => api(`/api/v1/commercial/payables/${payablePayment.id}/pay`, {
        method: 'POST',
        body: JSON.stringify({ ...payablePaymentForm, branchId: payablePayment.id_sucursal || payable.branchId || branches[0]?.id_sucursal || '' })
      }), (r) => `Pago aplicado. Saldo ${money(r.data.saldo)}. Egreso ${r.data.id_gasto} registrado.`);
      setPayablePayment(null);setPayablePayments([]);
    } catch {}
  }
  async function createExpense() {
    try {await run(() => api('/api/v1/commercial/expenses', { method: 'POST', body: JSON.stringify(expense) }), (r) => `Gasto ${r.data.id_gasto} creado como PENDIENTE.`);} catch {}
  }
  async function payExpense(x) {
    try {await run(() => api(`/api/v1/commercial/expenses/${x.row_id}/pay`, { method: 'POST', body: '{}' }), () => `Gasto ${x.id_gasto} pagado.`);} catch {}
  }
  async function cancelExpense(x) {
    const reason = prompt('Motivo de cancelación:') || '';if (!reason) return;
    try {await run(() => api(`/api/v1/commercial/expenses/${x.row_id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }), () => `Gasto ${x.id_gasto} cancelado.`);} catch {}
  }
  async function loadReturnOrder() {
    const operationId = window.tcg_store_templateOperation?.start?.({
      title: 'Buscando pedido',
      detail: brandText("GMX está validando el pedido y el alcance de sucursal.")
    });
    try {
      const r = await api(`/api/v1/commercial/returns-order/${encodeURIComponent(returnOrderId)}`);
      setReturnOrder(r.data);setReturnQty({});setReturnCondition(Object.fromEntries((r.data?.detalles || []).map((d) => [d.id_detalle, 'VENDIBLE'])));setMessage('');
      if (operationId) window.tcg_store_templateOperation.complete(operationId, { title: 'Pedido encontrado', detail: 'El pedido está disponible para procesar una devolución.' });
    } catch (e) {
      setReturnOrder(null);setReturnQty({});setReturnCondition({});
      // El modal global traduce BRANCH_FORBIDDEN y demás códigos a mensajes claros.
      if (operationId) window.tcg_store_templateOperation.fail(operationId, e);else
      setMessage(e.message);
    }
  }
  function buildReturnPayload() {
    if (!returnOrder) return null;
    if (!returnOptions.reason.trim()) {
      setMessage('Captura el motivo de la devolución.');
      return null;
    }

    const items = (returnOrder.detalles || [])
      .filter((detail) => Number(returnQty[detail.id_detalle] || 0) > 0)
      .map((detail) => {
        const condition = String(returnCondition[detail.id_detalle] || 'VENDIBLE').toUpperCase();
        const destination =
          condition === 'VENDIBLE' ? 'INVENTARIO_DISPONIBLE' :
          condition === 'DANADO' ? 'MERMA' :
          condition === 'DEFECTUOSO' ? 'GARANTIA' :
          condition === 'INCOMPLETO' ? 'REVISION' :
          'NO_VENDIBLE';

        return {
          detailId: detail.id_detalle,
          quantity: Number(returnQty[detail.id_detalle]),
          condition,
          destination
        };
      });

    if (!items.length) {
      const hasReturnableItems = (returnOrder.detalles || [])
        .some((detail) => Number(detail.cantidad_disponible_devolver || 0) > 0);

      if (!hasReturnableItems) {
        const operationId = window.tcg_store_templateOperation?.start?.({
          title: 'Validando devolución',
          detail: brandText("GMX está validando las unidades disponibles para devolución.")
        });

        if (operationId) {
          window.tcg_store_templateOperation.fail(operationId, new Error('RETURN_NOTHING_AVAILABLE'));
        } else {
          setMessage('Todos los artículos de este pedido ya fueron devueltos. No hay unidades disponibles para devolución.');
        }
        return null;
      }

      setMessage('Selecciona al menos una partida con unidades disponibles para devolver.');
      return null;
    }

    return {
      orderId: returnOrder.id_pedido,
      items,
      ...returnOptions
    };
  }

  async function completeReturnPayload(payload, authorizationToken = '') {
    return run(
      () => api('/api/v1/commercial/returns/sale', {
        method: 'POST',
        body: JSON.stringify({
          ...payload,
          ...(authorizationToken ? { authorizationToken } : {})
        })
      }),
      (response) => `Devolución ${response.data.id} completada por ${money(response.data.importe)}.`
    );
  }

  function finishReturnCreation() {
    setReturnOrder(null);
    setReturnOrderId('');
    setReturnQty({});
    setReturnCondition({});
    setReturnModal(false);
    setReturnApprovalOpen(false);
    setReturnApprovalPin('');
    setReturnPendingPayload(null);
  }

  async function createReturn() {
    const payload = buildReturnPayload();
    if (!payload) return;

    try {
      await completeReturnPayload(payload);
      finishReturnCreation();
    } catch (error) {
      const code = String(error?.message || '').trim().toUpperCase();

      if (
        code.includes('RETURN_AUTHORIZATION_REQUIRED') ||
        code.includes('RETURN_AUTHORIZATION_FORBIDDEN')
      ) {
        setMessage('');
        setReturnPendingPayload(payload);
        setReturnApprovalPin('');
        setReturnApprovalOpen(true);
      }
    }
  }

  async function authorizeAndCompleteReturn() {
    if (returnApprovalBusy || !returnPendingPayload) return;

    const pin = String(returnApprovalPin || '').replace(/\D/g, '').slice(0, 4);
    if (!/^\d{4}$/.test(pin)) {
      setMessage('Captura el código de autorización de 4 dígitos.');
      return;
    }

    setReturnApprovalBusy(true);
    setMessage('');

    try {
      const auth = await api('/api/v1/commercial/returns/pin/authorize', {
        method: 'POST',
        body: JSON.stringify({
          orderId: returnPendingPayload.orderId,
          pin
        })
      });

      const token = String(auth?.data?.authorizationToken || '').trim();
      if (!token) throw new Error('No se recibió la autorización temporal.');

      await completeReturnPayload(returnPendingPayload, token);
      finishReturnCreation();
    } catch (error) {
      const code = String(error?.message || '').trim().toUpperCase();
      const messages = {
        RETURN_PIN_INVALID_FORMAT: 'El código debe contener exactamente 4 dígitos.',
        RETURN_PIN_INVALID_OR_EXPIRED: 'El código es incorrecto, venció o fue reemplazado.',
        RETURN_PIN_ALREADY_USED: 'Este código ya fue utilizado. Solicita uno nuevo.',
        RETURN_AUTHORIZATION_ALREADY_USED: 'La autorización ya fue utilizada. Solicita un código nuevo.',
        RETURN_AUTHORIZATION_BRANCH_FORBIDDEN: 'El código no autoriza devoluciones para esta sucursal.'
      };
      setMessage(messages[code] || error?.message || 'No fue posible validar el código.');
      setReturnApprovalPin('');
    } finally {
      setReturnApprovalBusy(false);
    }
  }

  return <div className={`commercial-page r23-view r23-commercial commercial-option3-r66 commercial-r71 ${standaloneReturns ? 'commercial-returns-standalone' : ''}`}>
    <section className="content-card commercial-r71-shell">
      <div className="section-head commercial-r71-head">
        <div><div className="eyebrow">OPERACIÓN LOCAL</div><h2>{standaloneReturns ? 'Devoluciones' : 'Gestión Comercial'}</h2></div>
        <div className="commercial-r71-head-actions">
          <span className="phase-pill">10.4.1</span>
          {tab === 'quotes' ? <button type="button" onClick={openQuoteWizard}>+ Nueva cotización</button> : null}
          {tab === 'returns' ? <button type="button" onClick={() => setReturnModal(true)}>+ Nueva devolución</button> : null}
          {tab === 'providers' ? <button type="button" onClick={() => {clearProviderForm();setProviderModal(true);}}>+ Nuevo proveedor</button> : null}
          {tab === 'payables' ? <button type="button" onClick={() => setPayableModal(true)}>+ Nueva CxP</button> : null}
          {tab === 'expenses' ? <button type="button" onClick={() => setExpenseModal(true)}>+ Nuevo egreso</button> : null}
        </div>
      </div>

      {message ? <div className="commercial-alert">{message}</div> : null}
      {failedCount ? <section className="commercial-errors"><strong>Diagnóstico de carga</strong><div>{Object.entries(errors).map(([k, v]) => <span key={k}><b>{k}</b>: {v}</span>)}</div></section> : null}

      <div className="purchase-context-note commercial-r71-context">Cotizaciones, proveedores, cuentas por pagar y gastos dentro de un mismo flujo operativo.</div>

      <div className="commercial-r71-overview">
        <article className="commercial-r71-metric blue"><CommercialIcon name="quote" /><div><span>Cotizaciones</span><strong>{quotes.length}</strong><small>{money(commercialOp3Metrics.quoteTotal)}</small></div></article>
        <article className="commercial-r71-metric violet"><CommercialIcon name="return" /><div><span>Devoluciones</span><strong>{returns.length}</strong><small>{money(commercialOp3Metrics.returnTotal)}</small></div></article>
        <article className="commercial-r71-metric amber"><CommercialIcon name="provider" /><div><span>Proveedores</span><strong>{commercialOp3Metrics.activeProviders}</strong><small>Activos</small></div></article>
        <article className="commercial-r71-metric orange"><CommercialIcon name="payable" /><div><span>CxP pendientes</span><strong>{commercialOp3Metrics.pendingPayables}</strong><small>{money(commercialOp3Metrics.pendingPayablesTotal)}</small></div></article>
        <article className="commercial-r71-metric green"><CommercialIcon name="expense" /><div><span>Gastos / Egresos</span><strong>{expenses.length}</strong><small>{money(commercialOp3Metrics.expenseTotal)}</small></div></article>
      </div>

      <nav className="commercial-r71-tabs" role="tablist" aria-label="Secciones de Gestión Comercial">
        {[
          ['quotes','Cotizaciones','Ofertas y seguimiento','quote',quotes.length,'blue'],
          ['providers','Proveedores','Directorio maestro','provider',commercialOp3Metrics.activeProviders,'amber'],
          ['payables','Cuentas por pagar','Compras y obligaciones','payable',commercialOp3Metrics.pendingPayables,'orange'],
          ['expenses','Gastos / Egresos','Movimientos financieros','expense',expenses.length,'green']
        ].map(([id,label,copy,icon,count,color]) => <button key={id} type="button" role="tab" aria-selected={tab===id} className={`${tab===id?'active ':''}${color}`} onClick={()=>setTab(id)}>
          <span className="commercial-r71-tab-icon"><CommercialIcon name={icon}/></span><span><strong>{label}</strong><small>{copy}</small></span><em>{count}</em>
        </button>)}
      </nav>

      <div className="commercial-r71-main">
    {tab === 'quotes' ? <section className="commercial-section quotes-r70">
      <div className="commercial-r71-section-title"><div><h3>Cotizaciones</h3><p>Crea nuevas cotizaciones y consulta el historial.</p></div></div>

      <article className="commercial-panel quote-history-panel r70-history-only">
        <div className="quote-history-head">
          <div>
            <h3>Historial de cotizaciones</h3>
            <p>Consulta y continúa el flujo sin ocupar espacio junto al formulario.</p>
          </div>
          <div className="quote-history-filters">
            <input
              value={quoteHistorySearch}
              onChange={(e) => {setQuoteHistorySearch(e.target.value);setQuotePage(1);}}
              placeholder="Buscar ID, cliente, email o teléfono..." />
            <select
              value={quoteHistoryStatus}
              onChange={(e) => {setQuoteHistoryStatus(e.target.value);setQuotePage(1);}}>
              <option value="">Todos los estados</option>
              <option>BORRADOR</option>
              <option>ENVIADA</option>
              <option>ACEPTADA</option>
              <option>RECHAZADA</option>
              <option>VENCIDA</option>
              <option>CONVERTIDA</option>
            </select>
          </div>
        </div>

        <DataTable empty="No hay cotizaciones que coincidan con los filtros." headers={['Fecha', 'ID', 'Cliente', 'Total', 'Estado', 'Acciones']}>
          {filteredQuotes.slice((quotePage-1)*5, quotePage*5).map((q) => <tr key={q.row_id}>
            <td>{q.fecha ? new Date(q.fecha).toLocaleDateString('es-MX') : '—'}</td>
            <td><b>{q.id}</b></td>
            <td>
              <b>{q.cliente}</b>
              <small className="table-subline">{q.email || q.telefono || ''}</small>
            </td>
            <td><b>{money(q.total)}</b></td>
            <td><Status value={q.estado} /></td>
            <td>
              <div className="row-actions">
              <button type="button" className="secondary compact quote-view-button-r63" onClick={() => openQuoteView(q)}>Ver</button>
                {q.estado === 'BORRADOR' ? <button className="secondary compact" disabled={!q.email} title={!q.email ? 'La cotización no tiene email de cliente' : 'Enviar cotización por correo'} onClick={() => sendQuote(q)}>Enviar por correo</button> : null}
                {q.estado === 'ENVIADA' ? <button className="secondary compact" disabled={!q.email} onClick={() => sendQuote(q)}>Reenviar correo</button> : null}
                {q.estado === 'ENVIADA' ? <button className="secondary compact" onClick={() => quoteStatus(q.row_id, 'ACEPTADA')}>Marcar aceptada</button> : null}
                {q.estado === 'ACEPTADA' ? <button className="compact" onClick={() => openQuoteConvert(q)}>Convertir a pedido</button> : null}
              </div>
            </td>
          </tr>)}
        </DataTable>

        <Pager page={quotePage} setPage={setQuotePage} total={filteredQuotes.length} pageSize={5} />
      </article>

      {quoteWizardOpen ? <div className="modal-backdrop r70-quote-backdrop" onMouseDown={closeQuoteWizard}>
        <div className="modal r70-quote-wizard" onMouseDown={(e) => e.stopPropagation()}>
          <div className="r70-wizard-titlebar">
            <h2>Nueva cotización</h2>
            <button className="icon-btn" onClick={closeQuoteWizard}>×</button>
          </div>

          <div className="r70-stepper">
            {[['1','Cliente'],['2','Productos'],['3','Condiciones'],['4','Resumen']].map(([n,label],idx) => {
              const step = idx + 1;
              return <div key={n} className={`r70-step ${quoteWizardStep === step ? 'active' : ''} ${quoteWizardStep > step ? 'done' : ''}`}>
                <span>{quoteWizardStep > step ? '✓' : n}</span>
                <b>{label}</b>
              </div>;
            })}
          </div>

          <div className="r70-wizard-body">
            {quoteWizardStep === 1 ? <section className="r70-wizard-step">
              <div className="r70-step-copy">
                <h3>Selecciona un cliente existente</h3>
                <p>Sus datos maestros solo se editan desde Clientes.</p>
              </div>

              <div className={`quote-search-shell ${quoteClientOpen ? 'is-open' : ''}`}>
                <label>Buscar / seleccionar cliente
                  <div className="quote-picker-input">
                    <input
                      value={quoteClientSearch}
                      onFocus={() => setQuoteClientOpen(true)}
                      onChange={(e) => {setQuoteClientSearch(e.target.value);setQuoteClientOpen(true);}}
                      placeholder="Selecciona un cliente o escribe para buscar..."
                      autoComplete="off" />
                    <button type="button" className="quote-picker-toggle" onClick={() => setQuoteClientOpen((v) => !v)} aria-label="Mostrar clientes">⌄</button>
                  </div>
                </label>

                {quoteClientOpen ? <div className="quote-suggestions r70-suggestions">
                  <div className="quote-suggestions-head">
                    <span>{quoteClientSearch.trim() ? 'Resultados' : 'Clientes registrados'}</span>
                    <strong>{filteredQuoteClients.length}</strong>
                  </div>
                  {filteredQuoteClients.length ?
                    filteredQuoteClients.map((c) => <button type="button" key={c.row_id || c.id_cliente} onMouseDown={(e) => e.preventDefault()} onClick={() => useClient(c.id_cliente)}>
                      <span><strong>{c.nombre || 'Sin nombre'}</strong><small>{c.id_cliente}</small></span>
                      <span className="quote-result-meta"><small>{c.telefono || 'Sin teléfono'}</small><small>{c.email || 'Sin email'}</small></span>
                    </button>) :
                    <div className="quote-no-results">No hay clientes que coincidan con la búsqueda.</div>}
                </div> : null}
              </div>

              <div className="commercial-fields cols-3 r70-client-fields">
                <label>Cliente / razón social
                  <input value={quote.clientName} readOnly={!!quote.clientId} onChange={(e) => setQuote((x) => ({...x,clientName:e.target.value}))} placeholder="Nombre del cliente" />
                </label>
                <label>Email
                  <input type="email" value={quote.email} readOnly={!!quote.clientId} onChange={(e) => setQuote((x) => ({...x,email:e.target.value}))} placeholder="cliente@correo.com" />
                </label>
                <label>Teléfono
                  <input inputMode="numeric" value={quote.phone} readOnly={!!quote.clientId} onChange={(e) => setQuote((x) => ({...x,phone:e.target.value.replace(/\D/g,'')}))} placeholder="Solo números" />
                </label>
              </div>
            </section> : null}

            {quoteWizardStep === 2 ? <section className="r70-wizard-step">
              <div className="r70-step-copy">
                <h3>Agrega productos</h3>
                <p>Selecciona sucursal y agrega productos o cartas TCG.</p>
              </div>

              <div className="r70-product-toolbar">
                <label>Sucursal para disponibilidad
                  <select value={quote.branchId} onChange={(e) => {
                    const branchId=e.target.value;
                    setQuote((x)=>({...x,branchId,items:x.items.filter((item)=>item.itemType!=='TCG'||String(item.branchId)===String(branchId))}));
                    setQuoteProductSearch('');
                    setQuoteProductOpen(false);
                  }}>
                    <option value="">Selecciona sucursal</option>
                    {branches.map((b)=><option key={b.row_id} value={b.id_sucursal}>{b.nombre_sucursal}</option>)}
                  </select>
                </label>
              </div>

              <div className={`quote-search-shell quote-product-search ${quoteProductOpen ? 'is-open' : ''}`}>
                <label>Buscar / agregar producto
                  <div className="quote-picker-input">
                    <input
                      value={quoteProductSearch}
                      onFocus={() => setQuoteProductOpen(true)}
                      onChange={(e) => {setQuoteProductSearch(e.target.value);setQuoteProductOpen(true);}}
                      placeholder={`Busca entre ${quoteCatalog.length} artículo(s)...`}
                      autoComplete="off" />
                    <button type="button" className="quote-picker-toggle" onClick={() => setQuoteProductOpen((v) => !v)}>⌄</button>
                  </div>
                </label>

                {quoteProductOpen ? <div className="quote-suggestions product-results r70-suggestions">
                  <div className="quote-suggestions-head">
                    <span>{quoteProductSearch.trim() ? 'Resultados' : 'Artículos disponibles'}</span>
                    <strong>{filteredQuoteProducts.length}</strong>
                  </div>
                  {filteredQuoteProducts.length ?
                    filteredQuoteProducts.map((p) => <button type="button" key={p.key} onMouseDown={(e) => e.preventDefault()} onClick={() => addQuoteItem(p.key)}>
                      <span><span className={`quote-kind-pill ${p.kind === 'TCG' ? 'tcg' : 'product'}`}>{p.kind === 'TCG' ? 'CARTA TCG' : 'PRODUCTO'}</span><strong>{p.name}</strong><small>{p.secondary || `ID ${p.id}`}</small></span>
                      <span className="quote-result-meta"><strong>{money(p.price)}</strong><small>{p.kind === 'TCG' ? `Stock ${p.stock}` : ''}</small></span>
                    </button>) :
                    <div className="quote-no-results">No hay artículos que coincidan con la búsqueda.</div>}
                </div> : null}
              </div>

              <div className="r70-items-list">
                {quote.items.length === 0 ? <div className="empty-box r70-empty-products">Agrega al menos un producto para continuar.</div> :
                  quote.items.map((x,idx)=><div className="r70-item-row" key={`${x.productId || x.inventoryId}-${idx}`}>
                    <div>
                      <strong>{x.name}</strong>
                      <small>{[x.sku,x.condition,x.language].filter(Boolean).join(' · ')}</small>
                    </div>
                    <label>Cant.
                      <input type="number" min="1" max={x.itemType==='TCG'?x.stock:undefined} value={x.quantity} onChange={(e)=>setQuote((q)=>({...q,items:q.items.map((y,j)=>j===idx?{...y,quantity:y.itemType==='TCG'?Math.min(y.stock,Math.max(1,Number(e.target.value)||1)):Math.max(1,Number(e.target.value)||1)}:y)}))}/>
                    </label>
                    <label>Precio
                      <input type="number" min="0" step=".01" value={x.price} onChange={(e)=>setQuote((q)=>({...q,items:q.items.map((y,j)=>j===idx?{...y,price:Math.max(0,Number(e.target.value)||0)}:y)}))}/>
                    </label>
                    <strong>{money(Number(x.quantity||0)*Number(x.price||0))}</strong>
                    <button type="button" className="danger compact" onClick={()=>setQuote((q)=>({...q,items:q.items.filter((_,j)=>j!==idx)}))}>Quitar</button>
                  </div>)}
              </div>
            </section> : null}

            {quoteWizardStep === 3 ? <section className="r70-wizard-step">
              <div className="r70-step-copy">
                <h3>Condiciones</h3>
                <p>Define vigencia, descuento y observaciones.</p>
              </div>
              <div className="commercial-fields cols-2 r70-condition-fields">
                <label>Validez (días)
                  <input type="number" min="1" max="365" value={quote.validityDays} onChange={(e)=>setQuote((x)=>({...x,validityDays:Math.max(1,Number(e.target.value)||1)}))}/>
                </label>
                <label>Descuento MXN
                  <input type="number" min="0" step=".01" value={quote.discount} onChange={(e)=>setQuote((x)=>({...x,discount:Math.max(0,Number(e.target.value)||0)}))}/>
                </label>
                <label className="span-2">Notas
                  <textarea rows="4" value={quote.notes} onChange={(e)=>setQuote((x)=>({...x,notes:e.target.value}))} placeholder="Condiciones especiales, tiempos de entrega, etc."/>
                </label>
              </div>
            </section> : null}

            {quoteWizardStep === 4 ? <section className="r70-wizard-step">
              <div className="r70-step-copy">
                <h3>Resumen de cotización</h3>
                <p>Verifica la información antes de guardar.</p>
              </div>

              <div className="r70-review-grid">
                <article>
                  <span>Cliente</span>
                  <strong>{quote.clientName || '—'}</strong>
                  <small>{quote.email || quote.phone || ''}</small>
                </article>
                <article>
                  <span>Partidas</span>
                  <strong>{quote.items.length}</strong>
                  <small>{quote.items.reduce((s,x)=>s+Number(x.quantity||0),0)} unidades</small>
                </article>
                <article>
                  <span>Subtotal</span>
                  <strong>{money(quoteSubtotal)}</strong>
                </article>
                <article>
                  <span>Descuento</span>
                  <strong>{money(quote.discount)}</strong>
                </article>
                <article className="total">
                  <span>Total</span>
                  <strong>{money(quoteTotal)}</strong>
                </article>
              </div>

              <div className="r70-review-items">
                {quote.items.map((x,idx)=><div key={`${x.productId || x.inventoryId}-${idx}`}>
                  <span>{x.name}</span>
                  <span>{x.quantity} × {money(x.price)}</span>
                  <strong>{money(Number(x.quantity||0)*Number(x.price||0))}</strong>
                </div>)}
              </div>
            </section> : null}
          </div>

          <div className="r70-wizard-actions">
            <button className="secondary" onClick={closeQuoteWizard}>Cancelar</button>
            <div>
              {quoteWizardStep > 1 ? <button className="secondary" onClick={previousQuoteWizard}>← Anterior</button> : null}
              {quoteWizardStep < 4 ?
                <button className="r70-next" onClick={nextQuoteWizard}>Siguiente →</button> :
                <button className="r70-save" disabled={!quote.items.length || !quote.clientName.trim()} onClick={createQuote}>Guardar cotización</button>}
            </div>
          </div>
        </div>
      </div> : null}
    </section> : null}
    {quoteView ? <div className="modal-backdrop" onMouseDown={() => setQuoteView(null)}>
      <div className="modal quote-view-modal-r63" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="eyebrow">COTIZACIÃ“N</div>
            <h2>{quoteView.id||'Detalle'}</h2>
            <p>{quoteView.cliente||'Cliente'}</p>
          </div>
          <button className="icon-btn" onClick={() => setQuoteView(null)}>Ã—</button>
        </div>

        <div className="quote-view-summary-r63">
          <span>Fecha<strong>{quoteView.fecha?new Date(quoteView.fecha).toLocaleDateString('es-MX'):'â€”'}</strong></span>
          <span>Estado<strong>{quoteView.estado||'â€”'}</strong></span>
          <span>Email<strong>{quoteView.email||'â€”'}</strong></span>
          <span>TelÃ©fono<strong>{quoteView.telefono||'â€”'}</strong></span>
          <span>Subtotal<strong>{money(quoteView.subtotal)}</strong></span>
          <span>Descuento<strong>{money(quoteView.descuento||quoteView.discount)}</strong></span>
          <span>Total<strong>{money(quoteView.total)}</strong></span>
        </div>

        {Array.isArray(quoteView.detalles||quoteView.items) && (quoteView.detalles||quoteView.items).length ?
          <div className="quote-view-items-r63">
            <table>
              <thead><tr><th>Producto</th><th>SKU</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead>
              <tbody>
                {(quoteView.detalles||quoteView.items).map((x,i)=><tr key={x.row_id||x.id||i}>
                  <td>{x.producto||x.nombre||x.descripcion||'â€”'}</td>
                  <td>{x.sku||'â€”'}</td>
                  <td>{x.cantidad??'â€”'}</td>
                  <td>{money(x.precio_unitario??x.precio)}</td>
                  <td>{money(x.subtotal)}</td>
                </tr>)}
              </tbody>
            </table>
          </div> : null}

        {quoteView.notas ? <div className="finance-rule-note">{quoteView.notas}</div> : null}
        <div className="modal-actions">
          <button onClick={() => setQuoteView(null)}>Cerrar</button>
        </div>
      </div>
    </div> : null}
{quoteConvert ? <div className="modal-backdrop" onMouseDown={() => setQuoteConvert(null)}>
      <div className="modal quote-convert-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div><div className="eyebrow">COTIZACIÓN → PEDIDO</div><h2>Convertir {quoteConvert.id}</h2><p className="section-copy">La conversión crea un pedido pendiente y no descuenta inventario todavía.</p></div>
          <button className="icon-btn" onClick={() => setQuoteConvert(null)}>×</button>
        </div>
        <label>Sucursal destino
          <select value={quoteConvertBranch} onChange={(e) => setQuoteConvertBranch(e.target.value)}>
            <option value="">Selecciona sucursal</option>
            {branches.map((b) => <option key={b.row_id} value={b.id_sucursal}>{b.nombre_sucursal}</option>)}
          </select>
        </label>
        <div className="quote-convert-summary">
          <span>Cliente <strong>{quoteConvert.cliente}</strong></span>
          <span>Total <strong>{money(quoteConvert.total)}</strong></span>
        </div>
        <div className="modal-actions">
          <button className="secondary" onClick={() => setQuoteConvert(null)}>Cancelar</button>
          <button disabled={!quoteConvertBranch} onClick={confirmQuoteConvert}>Crear pedido pendiente</button>
        </div>
      </div>
    </div> : null}

    {tab === 'providers' ? <section className="commercial-section commercial-r69-section">
      <div className="commercial-r71-section-title"><div><h3>Directorio de proveedores</h3><p>Consulta y administra la lista de proveedores.</p></div></div>
      <article className="commercial-panel r69-table-card">
        <DataTable empty="No hay proveedores." headers={['Proveedor', 'RFC', 'Contacto', 'Términos', 'Estado', 'Acciones']}>
          {providers.slice((providerPage-1)*5, providerPage*5).map((p) => <tr key={p.row_id}>
            <td><b>{p.nombre_comercial || p.razon_social}</b><small className="table-subline">{p.id_proveedor}</small></td>
            <td>{p.rfc || '—'}</td>
            <td>{[p.contacto, p.telefono, p.email].filter(Boolean).join(' · ') || '—'}</td>
            <td>{p.terminos_pago || '—'} {p.dias_credito ? `${p.dias_credito}d` : ''}</td>
            <td><Status value={p.activo === false ? 'INACTIVO' : 'ACTIVO'} /></td>
            <td><div className="row-actions"><button className="secondary compact" onClick={() => {editProvider(p);setProviderModal(true);}}>Editar</button><button className="secondary compact" onClick={() => toggleProvider(p)}>{p.activo === false ? 'Activar' : 'Desactivar'}</button></div></td>
          </tr>)}
        </DataTable>
        <Pager page={providerPage} setPage={setProviderPage} total={providers.length} pageSize={5} />
      </article>
      {providerModal ? <div className="modal-backdrop" onMouseDown={() => {setProviderModal(false);clearProviderForm();}}>
        <div className="modal r69-modal" onMouseDown={(e) => e.stopPropagation()}>
          <div className="modal-head"><div><div className="eyebrow">PROVEEDORES</div><h2>{providerEditId ? 'Editar proveedor' : 'Nuevo proveedor'}</h2></div><button className="icon-btn" onClick={() => {setProviderModal(false);clearProviderForm();}}>×</button></div>
          <div className="commercial-fields cols-2">
            <label>Razón social<input value={provider.razon_social} onChange={(e) => setProvider((x) => ({...x,razon_social:e.target.value}))}/></label>
            <label>Nombre comercial<input value={provider.nombre_comercial} onChange={(e) => setProvider((x) => ({...x,nombre_comercial:e.target.value}))}/></label>
            <label>RFC<input value={provider.rfc} onChange={(e) => setProvider((x) => ({...x,rfc:e.target.value.toUpperCase()}))}/></label>
            <label>Contacto<input value={provider.contacto} onChange={(e) => setProvider((x) => ({...x,contacto:e.target.value}))}/></label>
            <label>Teléfono<input inputMode="numeric" value={provider.telefono} onChange={(e) => setProvider((x) => ({...x,telefono:e.target.value.replace(/\D/g,'')}))}/></label>
            <label>Email<input type="email" value={provider.email} onChange={(e) => setProvider((x) => ({...x,email:e.target.value}))}/></label>
            <label>Términos<select value={provider.terminos_pago} onChange={(e) => setProvider((x) => ({...x,terminos_pago:e.target.value,dias_credito:e.target.value==='CONTADO'?0:x.dias_credito}))}><option value="CONTADO">Contado</option><option value="CREDITO">Crédito</option></select></label>
            <label>Días crédito<input type="number" min="0" disabled={provider.terminos_pago!=='CREDITO'} value={provider.dias_credito} onChange={(e) => setProvider((x) => ({...x,dias_credito:Number(e.target.value)}))}/></label>
            <label>Moneda<select value={provider.moneda} onChange={(e) => setProvider((x) => ({...x,moneda:e.target.value}))}><option>MXN</option><option>USD</option></select></label>
            <label>Banco<input value={provider.banco} onChange={(e) => setProvider((x) => ({...x,banco:e.target.value}))}/></label>
            <label className="span-2">Dirección<input value={provider.direccion} onChange={(e) => setProvider((x) => ({...x,direccion:e.target.value}))}/></label>
            <label>Ciudad<input value={provider.ciudad} onChange={(e) => setProvider((x) => ({...x,ciudad:e.target.value}))}/></label>
            <label>Estado<input value={provider.estado} onChange={(e) => setProvider((x) => ({...x,estado:e.target.value}))}/></label>
            <label>CP<input inputMode="numeric" value={provider.cp} onChange={(e) => setProvider((x) => ({...x,cp:e.target.value.replace(/\D/g,'')}))}/></label>
            <label>País<input value={provider.pais} onChange={(e) => setProvider((x) => ({...x,pais:e.target.value}))}/></label>
            <label className="span-2">Notas<input value={provider.notas} onChange={(e) => setProvider((x) => ({...x,notas:e.target.value}))}/></label>
          </div>
          <div className="modal-actions"><button className="secondary" onClick={() => {setProviderModal(false);clearProviderForm();}}>Cancelar</button><button onClick={async()=>{await saveProvider();setProviderModal(false);}}>{providerEditId?'Guardar cambios':'Guardar proveedor'}</button></div>
        </div>
      </div> : null}
    </section> : null}
{tab === 'payables' ? <section className="commercial-section commercial-r69-section">
      <div className="commercial-r71-section-title"><div><h3>Cuentas por pagar</h3><p>Compras pendientes y obligaciones.</p></div><button className="secondary compact" onClick={syncPayables}>Sincronizar compras</button></div>
      <div className="r69-two-cards">
        <article className="commercial-panel r69-table-card"><h3>Compras sin CxP ligada</h3>
          <DataTable dense empty="No hay compras pendientes de vincular." headers={['Compra','Proveedor','Total','Acción']}>
            {purchases.filter((p)=>!payables.some((x)=>String(x.id_compra||'')===String(p.id_compra))).slice((payablePurchasePage-1)*5,payablePurchasePage*5).map((p)=><tr key={p.row_id}><td>{p.id_compra}</td><td>{p.proveedor}</td><td>{money(p.total)}</td><td><button className="secondary compact" onClick={()=>payableFromPurchase(p.row_id)}>Crear CxP</button></td></tr>)}
          </DataTable>
          <Pager page={payablePurchasePage} setPage={setPayablePurchasePage} total={purchases.filter((p)=>!payables.some((x)=>String(x.id_compra||'')===String(p.id_compra))).length} pageSize={5}/>
        </article>
        <article className="commercial-panel r69-table-card"><h3>Obligaciones (CxP)</h3>
          <DataTable dense empty="No hay cuentas por pagar." headers={['Proveedor','Vence','Total','Saldo','Estado','Acción']}>
            {payables.slice((payablePage-1)*5,payablePage*5).map((x)=><tr key={x.row_id}><td><b>{x.proveedor}</b><small className="table-subline">{x.id}</small></td><td>{x.vencimiento||'—'}</td><td>{money(x.total)}</td><td><b>{money(x.saldo)}</b></td><td><Status value={x.estado}/></td><td>{Number(x.saldo)>0&&x.estado!=='CANCELADA'?<button className="compact" onClick={()=>openPayablePayment(x)}>Abonar</button>:null}</td></tr>)}
          </DataTable>
          <Pager page={payablePage} setPage={setPayablePage} total={payables.length} pageSize={5}/>
        </article>
      </div>
      {payableModal ? <div className="modal-backdrop" onMouseDown={()=>setPayableModal(false)}>
        <div className="modal r69-modal r69-modal-small" onMouseDown={(e)=>e.stopPropagation()}>
          <div className="modal-head"><div><div className="eyebrow">CUENTAS POR PAGAR</div><h2>Nueva CxP</h2></div><button className="icon-btn" onClick={()=>setPayableModal(false)}>×</button></div>
          <div className="commercial-fields cols-2">
            <label>Proveedor<select value={payable.providerId} onChange={(e)=>setPayable((x)=>({...x,providerId:e.target.value}))}><option value="">Selecciona...</option>{providers.filter((p)=>p.activo!==false).map((p)=><option key={p.row_id} value={p.id_proveedor}>{p.nombre_comercial||p.razon_social}</option>)}</select></label>
            <label>Sucursal<select value={payable.branchId} onChange={(e)=>setPayable((x)=>({...x,branchId:e.target.value}))}>{branches.map((b)=><option key={b.row_id} value={b.id_sucursal}>{b.nombre_sucursal}</option>)}</select></label>
            <label>Documento<input value={payable.document} onChange={(e)=>setPayable((x)=>({...x,document:e.target.value}))}/></label>
            <label>Vencimiento<input type="date" value={payable.dueDate} onChange={(e)=>setPayable((x)=>({...x,dueDate:e.target.value}))}/></label>
            <label>Total<input type="number" min="0" step=".01" value={payable.total} onChange={(e)=>setPayable((x)=>({...x,total:Number(e.target.value)}))}/></label>
            <label>Notas<input value={payable.notes} onChange={(e)=>setPayable((x)=>({...x,notes:e.target.value}))}/></label>
          </div>
          <div className="modal-actions"><button className="secondary" onClick={()=>setPayableModal(false)}>Cancelar</button><button disabled={!payable.providerId||!payable.branchId||Number(payable.total)<=0} onClick={async()=>{await createPayable();setPayableModal(false);}}>Guardar CxP</button></div>
        </div>
      </div>:null}
    </section> : null}
{tab === 'expenses' ? <section className="commercial-section commercial-r69-section">
      <div className="commercial-r71-section-title"><div><h3>Gastos / Egresos</h3><p>Resumen, actividad e historial en una vista compacta.</p></div><span className="commercial-counter">{expenses.length} movimientos</span></div>
      <div className="r69-expense-summary">
        <article className="commercial-panel r69-action-card"><div className="r69-action-icon">◆</div><div><h3>Registrar gasto / egreso</h3><p>Agrega gastos operativos de forma rápida.</p></div><button onClick={()=>setExpenseModal(true)}>Registrar ahora</button></article>
        <article className="commercial-panel"><h3>Resumen financiero del mes</h3><div className="r69-finance-lines"><span>Gastos / Egresos <b>{money(expenses.reduce((s,x)=>s+Number(x.total||0),0))}</b></span><span>Pendientes <b>{money(expenses.filter((x)=>x.estado==='PENDIENTE').reduce((s,x)=>s+Number(x.total||0),0))}</b></span><span>Pagados <b>{money(expenses.filter((x)=>x.estado==='PAGADO').reduce((s,x)=>s+Number(x.total||0),0))}</b></span></div></article>
        <article className="commercial-panel"><h3>Actividad reciente</h3><div className="r69-activity">{expenses.slice(0,4).map((x)=><div key={x.row_id}><span>{x.concepto||x.categoria}</span><b>{money(x.total)}</b><Status value={x.estado}/></div>)}</div></article>
      </div>
      <article className="commercial-panel r69-table-card"><div className="r69-card-head"><h3>Historial de egresos</h3></div>
        <DataTable dense empty="No hay gastos." headers={['Fecha','Concepto','Categoría','Método','Total','Estado','Acciones']}>
          {expenses.slice((expensePage-1)*5,expensePage*5).map((x)=><tr key={x.row_id}><td>{x.fecha_gasto?new Date(x.fecha_gasto).toLocaleDateString('es-MX'):'—'}</td><td><b>{x.concepto}</b><small className="table-subline">{x.id_gasto}</small></td><td>{x.categoria}</td><td>{x.metodo_pago}</td><td>{money(x.total)}</td><td><Status value={x.estado}/></td><td><div className="row-actions">{x.estado==='PENDIENTE'?<button className="compact" onClick={()=>payExpense(x)}>Pagar</button>:null}{x.estado!=='CANCELADO'&&!['CXP','COMPRA'].includes(String(x.origen_modulo||'').toUpperCase())?<button className="danger compact" onClick={()=>cancelExpense(x)}>Cancelar</button>:null}</div></td></tr>)}
        </DataTable>
        <Pager page={expensePage} setPage={setExpensePage} total={expenses.length} pageSize={5}/>
      </article>
      {expenseModal ? <div className="modal-backdrop" onMouseDown={()=>setExpenseModal(false)}>
        <div className="modal r69-modal r69-modal-small" onMouseDown={(e)=>e.stopPropagation()}>
          <div className="modal-head"><div><div className="eyebrow">GASTOS / EGRESOS</div><h2>Nuevo gasto / egreso</h2></div><button className="icon-btn" onClick={()=>setExpenseModal(false)}>×</button></div>
          <div className="commercial-fields cols-2">
            <label>Sucursal<select value={expense.branchId} onChange={(e)=>setExpense((x)=>({...x,branchId:e.target.value}))}>{branches.map((b)=><option key={b.row_id} value={b.id_sucursal}>{b.nombre_sucursal}</option>)}</select></label>
            <label>Fecha<input type="date" value={expense.expenseDate} onChange={(e)=>setExpense((x)=>({...x,expenseDate:e.target.value}))}/></label>
            <label>Categoría<select value={expense.category} onChange={(e)=>setExpense((x)=>({...x,category:e.target.value}))}><option>GENERAL</option><option>RENTA</option><option>SERVICIOS</option><option>PAPELERIA</option><option>LOGISTICA</option><option>MANTENIMIENTO</option><option>IMPUESTOS</option><option>COMISIONES</option><option>OTRO</option></select></label>
            <label>Subcategoría<input value={expense.subcategory} onChange={(e)=>setExpense((x)=>({...x,subcategory:e.target.value}))}/></label>
            <label className="span-2">Concepto<input value={expense.concept} onChange={(e)=>setExpense((x)=>({...x,concept:e.target.value}))}/></label>
            <label>Proveedor<select value={expense.providerId} onChange={(e)=>setExpense((x)=>({...x,providerId:e.target.value}))}><option value="">Sin proveedor</option>{providers.filter((p)=>p.activo!==false).map((p)=><option key={p.row_id} value={p.id_proveedor}>{p.nombre_comercial||p.razon_social}</option>)}</select></label>
            <label>Total<input type="number" min="0" step=".01" value={expense.total} onChange={(e)=>setExpense((x)=>({...x,total:Number(e.target.value),subtotal:Number(e.target.value)}))}/></label>
            <label>Método<select value={expense.paymentMethod} onChange={(e)=>setExpense((x)=>({...x,paymentMethod:e.target.value}))}><option>EFECTIVO</option><option>TRANSFERENCIA</option><option>TARJETA</option><option>OTRO</option></select></label>
            <label>Referencia<input value={expense.reference} onChange={(e)=>setExpense((x)=>({...x,reference:e.target.value}))}/></label>
          </div>
          <div className="finance-rule-note">Efectivo modifica Caja únicamente al pagar.</div>
          <div className="modal-actions"><button className="secondary" onClick={()=>setExpenseModal(false)}>Cancelar</button><button disabled={!expense.branchId||!expense.concept||Number(expense.total)<=0} onClick={async()=>{await createExpense();setExpenseModal(false);}}>Guardar</button></div>
        </div>
      </div>:null}
    </section> : null}
{tab === 'returns' ? (() => {
      const normalizedSearch = returnSearch.trim().toLowerCase();
      const filteredReturns = returns.filter((x) => {
        const hay = [x.id,x.referencia,x.cliente_proveedor,x.motivo,x.estado].filter(Boolean).join(' ').toLowerCase();
        const okSearch = !normalizedSearch || hay.includes(normalizedSearch);
        const okStatus = !returnStatusFilter || String(x.estado || '').toUpperCase() === returnStatusFilter;
        const okStock = !returnStockFilter || (returnStockFilter === 'SI' ? !!x.reintegra_stock : !x.reintegra_stock);
        return okSearch && okStatus && okStock;
      });
      const pageSize = 10;
      const approved = returns.filter((x) => ['COMPLETADA','APROBADA','REEMBOLSADA'].includes(String(x.estado || '').toUpperCase())).length;
      const pending = returns.filter((x) => ['PENDIENTE','PROCESANDO','BORRADOR'].includes(String(x.estado || '').toUpperCase())).length;
      const cancelled = returns.filter((x) => ['CANCELADA','CANCELADO','ERROR'].includes(String(x.estado || '').toUpperCase())).length;
      const amount = returns.reduce((a,x)=>a+Number(x.importe||0),0);
      const selectedItems = (returnOrder?.detalles || []).filter((d)=>Number(returnQty[d.id_detalle]||0)>0);
      const selectedAmount = selectedItems.reduce((a,d)=>a+(Number(returnQty[d.id_detalle]||0)*Number(d.precio_unitario||d.precio||0)),0);
      const resetReturnWizard = () => { setReturnModal(false);setReturnWizardStep(1);setReturnOrder(null);setReturnOrderId('');setReturnQty({});setReturnCondition({});setReturnOptions({ reason:'',refund:false,refundMethod:'EFECTIVO',refundReference:'',notes:'' }); };
      return <section className="commercial-section shiny-r73-returns">
        <div className="shiny-r73-title"><div><div className="eyebrow">MÓDULO</div><h2>Devoluciones</h2><p>Gestiona devoluciones de venta, motivos, reembolsos y el destino del producto. El impacto se refleja automáticamente en inventario.</p></div><div className="shiny-r73-trust"><span><ReturnUiIcon name="box"/><b>Inventario actualizado</b><small>Ajuste automático</small></span><span><ReturnUiIcon name="trace"/><b>Trazabilidad completa</b><small>Venta y documentos</small></span><span><ReturnUiIcon name="shield"/><b>Control y autorización</b><small>Reglas y motivos</small></span></div></div>
        <article className="commercial-panel shiny-r73-main">
          <div className="shiny-r73-panel-head"><h3>Pantalla principal · Devoluciones</h3></div>
          <div className="shiny-r73-kpis">
            <div className="violet"><ReturnUiIcon name="return"/><span><small>Devoluciones totales</small><strong>{returns.length}</strong><em>Todos los registros</em></span></div>
            <div className="green"><ReturnUiIcon name="check"/><span><small>Aprobadas</small><strong>{approved}</strong><em>{returns.length ? `${Math.round(approved*100/returns.length)}% del total` : 'Sin registros'}</em></span></div>
            <div className="orange"><ReturnUiIcon name="doc"/><span><small>Pendientes</small><strong>{pending}</strong><em>Por completar</em></span></div>
            <div className="blue"><ReturnUiIcon name="ban"/><span><small>Canceladas</small><strong>{cancelled}</strong><em>Anuladas / error</em></span></div>
            <div className="purple"><ReturnUiIcon name="money"/><span><small>Monto total</small><strong>{money(amount)}</strong><em>Importe acumulado</em></span></div>
          </div>
          <div className="shiny-r73-toolbar">
            <div className="shiny-r73-search"><ReturnUiIcon name="search"/><input value={returnSearch} onChange={(e)=>{setReturnSearch(e.target.value);setReturnPage(1);}} placeholder="Buscar por folio, cliente, referencia o motivo..."/></div>
            <select value={returnStatusFilter} onChange={(e)=>{setReturnStatusFilter(e.target.value);setReturnPage(1);}}><option value="">Todos los estados</option><option value="COMPLETADA">Completada</option><option value="PENDIENTE">Pendiente</option><option value="PROCESANDO">Procesando</option><option value="CANCELADA">Cancelada</option></select>
            <select value={returnStockFilter} onChange={(e)=>{setReturnStockFilter(e.target.value);setReturnPage(1);}}><option value="">Impacto inventario</option><option value="SI">Reintegra stock</option><option value="NO">No reintegra</option></select>
            <button className="shiny-r73-new" onClick={()=>{setReturnWizardStep(1);setReturnModal(true);}}>+ Nueva devolución</button>
          </div>
          <DataTable empty="No hay devoluciones con estos filtros." headers={['Fecha','Folio','Origen','Referencia','Cliente','Motivo','Estatus','Total','Inventario','Acciones']}>
            {filteredReturns.slice((returnPage-1)*pageSize,returnPage*pageSize).map((x)=><tr key={x.row_id||x.id}><td>{x.fecha?new Date(x.fecha).toLocaleString('es-MX'):'—'}</td><td><b>{x.id||'—'}</b></td><td><span className="shiny-r73-type">Venta</span></td><td>{x.referencia||'—'}</td><td>{x.cliente_proveedor||'—'}</td><td>{x.motivo||'—'}</td><td><Status value={x.estado}/></td><td><b>{money(x.importe)}</b></td><td><span className={x.reintegra_stock?'shiny-r73-stock yes':'shiny-r73-stock no'}>{x.reintegra_stock?'Reintegra':'No reintegra'}</span></td><td>{['PENDIENTE','PROCESANDO','BORRADOR'].includes(String(x.estado||'').toUpperCase())?<button type="button" className="shiny-r75-return-pos" onClick={()=>{try{localStorage.setItem('SHINY_POS_PENDING_RETURN',String(x.id||''));}catch{} window.location.assign(`/admin/pos?return=${encodeURIComponent(x.id||'')}`);}}>Cobrar en POS</button>:<span className="muted">—</span>}</td></tr>)}
          </DataTable>
          <Pager page={returnPage} setPage={setReturnPage} total={filteredReturns.length} pageSize={pageSize}/>
        </article>
        <div className="shiny-r73-impact">
          <div><span className="up">↑</span><p><b>Incremento de inventario</b><small>Vendible / buen estado → Inventario disponible. Las unidades regresan a existencias.</small></p></div>
          <div><span className="down">↓</span><p><b>No incrementa inventario disponible</b><small>Dañado → Merma · Defectuoso → Garantía · Incompleto → Revisión · No vendible → No vendible.</small></p></div>
          <div className="info"><span>i</span><p><b>Trazabilidad automática</b><small>La devolución conserva referencia, motivo, reembolso y movimiento de inventario.</small></p></div>
        </div>
        {returnModal ? <div className="modal-backdrop shiny-r73-backdrop" onMouseDown={resetReturnWizard}>
          <div className="modal shiny-r73-modal" onMouseDown={(e)=>e.stopPropagation()}>
            <div className="shiny-r73-modal-top"><div><div className="eyebrow">CREAR DEVOLUCIÓN · PASO {returnWizardStep} DE 4</div><h2>Nueva devolución</h2></div><button className="icon-btn" onClick={resetReturnWizard}>×</button></div>
            <div className="shiny-r73-steps">{[['1','Información general'],['2','Productos'],['3','Detalles y motivo'],['4','Resumen']].map(([n,t])=><div key={n} className={returnWizardStep===Number(n)?'active':returnWizardStep>Number(n)?'done':''}><span>{returnWizardStep>Number(n)?'✓':n}</span><b>{t}</b></div>)}</div>
            {returnWizardStep===1 ? <div className="shiny-r73-step"><h3>Información general</h3><p>Localiza la venta que originará la devolución.</p><div className="shiny-r73-form cols2"><label>Tipo de devolución<input value="De venta" disabled/></label><label>Pedido / referencia *<div className="shiny-r73-inline"><input autoFocus value={returnOrderId} onChange={(e)=>setReturnOrderId(e.target.value)} placeholder="Ej. PED-00037"/><button onClick={loadReturnOrder} disabled={!returnOrderId.trim()}>Buscar</button></div></label>{returnOrder?<><label>Cliente<input value={returnOrder.nombre_cliente||'—'} disabled/></label><label>Total de la venta<input value={money(returnOrder.total)} disabled/></label></>:null}</div><div className="modal-actions"><button className="secondary" onClick={resetReturnWizard}>Cancelar</button><button disabled={!returnOrder} onClick={()=>setReturnWizardStep(2)}>Siguiente</button></div></div>:null}
            {returnWizardStep===2 ? <div className="shiny-r73-step"><h3>Productos</h3><p>Selecciona las unidades que regresará el cliente y su condición física.</p><DataTable empty="El pedido no contiene partidas." headers={['Producto','SKU','Vendido','Disponible','Cant. devolver','Condición','Destino']} dense>{(returnOrder?.detalles||[]).map((d)=><tr key={d.id_detalle}><td><b>{d.producto}</b><small className="table-subline">{d.detalle||''}</small></td><td>{d.sku}</td><td>{d.cantidad}</td><td><b>{d.cantidad_disponible_devolver}</b></td><td><input className="qty-small" type="number" min="0" max={d.cantidad_disponible_devolver} disabled={Number(d.cantidad_disponible_devolver)<=0} value={returnQty[d.id_detalle]||0} onChange={(e)=>setReturnQty((x)=>({...x,[d.id_detalle]:Math.min(Number(d.cantidad_disponible_devolver),Math.max(0,Number(e.target.value)||0))}))}/></td><td><select value={returnCondition[d.id_detalle]||'VENDIBLE'} disabled={Number(d.cantidad_disponible_devolver)<=0} onChange={(e)=>setReturnCondition((x)=>({...x,[d.id_detalle]:e.target.value}))}><option value="VENDIBLE">Vendible / buen estado</option><option value="DANADO">Dañado</option><option value="DEFECTUOSO">Defectuoso</option><option value="INCOMPLETO">Incompleto</option><option value="NO_VENDIBLE">No vendible</option></select></td><td><span className="shiny-r73-destination">{(returnCondition[d.id_detalle]||'VENDIBLE')==='VENDIBLE'?'Inventario disponible':(returnCondition[d.id_detalle]||'')==='DANADO'?'Merma':(returnCondition[d.id_detalle]||'')==='DEFECTUOSO'?'Garantía':(returnCondition[d.id_detalle]||'')==='INCOMPLETO'?'Revisión':'No vendible'}</span></td></tr>)}</DataTable><div className="modal-actions"><button className="secondary" onClick={()=>setReturnWizardStep(1)}>Anterior</button><button disabled={!selectedItems.length} onClick={()=>setReturnWizardStep(3)}>Siguiente</button></div></div>:null}
            {returnWizardStep===3 ? <div className="shiny-r73-step"><h3>Detalles y motivo</h3><p>Define el motivo y, cuando corresponda, la forma de reembolso.</p><div className="shiny-r73-form cols2"><label className="span2">Motivo de devolución *<input value={returnOptions.reason} onChange={(e)=>setReturnOptions((x)=>({...x,reason:e.target.value}))} placeholder="Ej. Producto dañado, cambio de opinión..."/></label><label className="shiny-r73-check"><input type="checkbox" checked={returnOptions.refund} onChange={(e)=>setReturnOptions((x)=>({...x,refund:e.target.checked}))}/><span><b>Generar reembolso</b><small>Registra la salida asociada a esta devolución.</small></span></label>{returnOptions.refund?<><label>Método de reembolso<select value={returnOptions.refundMethod} onChange={(e)=>setReturnOptions((x)=>({...x,refundMethod:e.target.value}))}><option>EFECTIVO</option><option>TRANSFERENCIA</option><option>TARJETA</option><option>OTRO</option></select></label>{returnOptions.refundMethod!=='EFECTIVO'?<label className="span2">Referencia de reembolso<input value={returnOptions.refundReference} onChange={(e)=>setReturnOptions((x)=>({...x,refundReference:e.target.value}))}/></label>:null}</>:null}<label className="span2">Notas adicionales<textarea rows="3" value={returnOptions.notes} onChange={(e)=>setReturnOptions((x)=>({...x,notes:e.target.value}))}/></label></div><div className="modal-actions"><button className="secondary" onClick={()=>setReturnWizardStep(2)}>Anterior</button><button disabled={!returnOptions.reason.trim()} onClick={()=>setReturnWizardStep(4)}>Siguiente</button></div></div>:null}
            {returnWizardStep===4 ? <div className="shiny-r73-step"><h3>Resumen</h3><p>Revisa el impacto antes de confirmar la devolución.</p><div className="shiny-r73-summary"><div><span>Tipo</span><b>De venta</b><span>Pedido</span><b>{returnOrder?.id_pedido}</b><span>Cliente</span><b>{returnOrder?.nombre_cliente||'—'}</b><span>Motivo</span><b>{returnOptions.reason}</b><span>Reembolso</span><b>{returnOptions.refund?returnOptions.refundMethod:'No'}</b></div><DataTable empty="Sin partidas seleccionadas." headers={['Producto','Cant.','Condición','Destino','Subtotal']} dense>{selectedItems.map((d)=>{const c=returnCondition[d.id_detalle]||'VENDIBLE';return <tr key={d.id_detalle}><td>{d.producto}</td><td>{returnQty[d.id_detalle]}</td><td>{c}</td><td>{c==='VENDIBLE'?'Inventario disponible':c==='DANADO'?'Merma':c==='DEFECTUOSO'?'Garantía':c==='INCOMPLETO'?'Revisión':'No vendible'}</td><td><b>{money(Number(returnQty[d.id_detalle]||0)*Number(d.precio_unitario||d.precio||0))}</b></td></tr>})}</DataTable><div className="shiny-r73-total"><span>Total devolución</span><strong>{money(selectedAmount)}</strong></div></div><div className="modal-actions"><button className="secondary" onClick={()=>setReturnWizardStep(3)}>Anterior</button><button className="shiny-r73-confirm" disabled={!selectedItems.length||!returnOptions.reason.trim()} onClick={async()=>{await createReturn();resetReturnWizard();}}>✓ Confirmar devolución</button></div></div>:null}
          </div>
        </div>:null}
        {returnApprovalOpen ? <div className="modal-backdrop shiny-r77-pin-backdrop" onMouseDown={() => !returnApprovalBusy && setReturnApprovalOpen(false)}>
          <div className="modal shiny-r77-pin-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div><div className="eyebrow">AUTORIZACIÓN REQUERIDA</div><h2>Autorizar devolución</h2><p className="section-copy">Solicita a un administrador autorizado el código temporal de 4 dígitos.</p></div>
              <button className="icon-btn" type="button" disabled={returnApprovalBusy} onClick={() => setReturnApprovalOpen(false)}>×</button>
            </div>
            <div className="shiny-r77-pin-modal-info">
              <span>Pedido</span><strong>{returnPendingPayload?.orderId || returnOrder?.id_pedido || '—'}</strong>
            </div>
            <label className="shiny-r77-pin-modal-label">Código de autorización
              <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength="4" autoFocus autoComplete="one-time-code" value={returnApprovalPin} onChange={(event) => setReturnApprovalPin(event.target.value.replace(/\D/g, '').slice(0, 4))} onKeyDown={(event) => { if (event.key === 'Enter' && !returnApprovalBusy) authorizeAndCompleteReturn(); }} placeholder="••••"/>
            </label>
            <div className="modal-actions">
              <button type="button" className="secondary" disabled={returnApprovalBusy} onClick={() => setReturnApprovalOpen(false)}>Cancelar</button>
              <button type="button" disabled={returnApprovalBusy} onClick={authorizeAndCompleteReturn}>{returnApprovalBusy ? 'Validando…' : 'Autorizar devolución'}</button>
            </div>
          </div>
        </div> : null}

      </section>;
    })() : null}
    {payablePayment ? <div className="modal-backdrop" onMouseDown={() => setPayablePayment(null)}>
      <div className="modal commercial-payment-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head"><div><div className="eyebrow">CUENTAS POR PAGAR</div><h2>Registrar abono</h2><p>{payablePayment.id} · {payablePayment.proveedor}</p></div><button className="icon-btn" onClick={() => setPayablePayment(null)}>×</button></div>
        <div className="payment-summary-grid"><div><span>Total</span><strong>{money(payablePayment.total)}</strong></div><div><span>Pagado</span><strong>{money(payablePayment.pagado)}</strong></div><div><span>Saldo</span><strong>{money(payablePayment.saldo)}</strong></div></div>
        <div className="commercial-fields cols-2">
          <label>Monto<input type="number" min=".01" max={payablePayment.saldo} step=".01" value={payablePaymentForm.amount} onChange={(e) => setPayablePaymentForm((x) => ({ ...x, amount: Number(e.target.value) }))} /></label>
          <label>Método<select value={payablePaymentForm.paymentMethod} onChange={(e) => setPayablePaymentForm((x) => ({ ...x, paymentMethod: e.target.value }))}><option>TRANSFERENCIA</option><option>TARJETA</option><option>EFECTIVO</option><option>OTRO</option></select></label>
          <label>Referencia<input value={payablePaymentForm.reference} onChange={(e) => setPayablePaymentForm((x) => ({ ...x, reference: e.target.value }))} /></label>
          <label>Notas<input value={payablePaymentForm.notes} onChange={(e) => setPayablePaymentForm((x) => ({ ...x, notes: e.target.value }))} /></label>
        </div>
        {payablePaymentForm.paymentMethod === 'EFECTIVO' ? <div className="finance-rule-note">El pago usa la sucursal asignada a la CxP y requiere una caja abierta.</div> : null}
        {payablePayments.length ? <div className="payment-history-mini"><strong>Abonos anteriores</strong>{payablePayments.slice(0, 6).map((p) => <span key={p.row_id}>{new Date(p.fecha).toLocaleDateString('es-MX')} · {money(p.monto)} · {p.metodo_pago}</span>)}</div> : null}
        <div className="modal-actions"><button className="secondary" onClick={() => setPayablePayment(null)}>Cancelar</button><button disabled={Number(payablePaymentForm.amount) <= 0 || Number(payablePaymentForm.amount) > Number(payablePayment.saldo)} onClick={confirmPayablePayment}>Registrar abono</button></div>
      </div>
    </div> : null}

      </div>
    </section>
  </div>;
}

function CommercialIcon({ name }) {
  const common = { viewBox: '0 0 24 24', 'aria-hidden': true };
  if (name === 'quote') return <svg {...common}><path d="M6 3h9l3 3v15H6z"/><path d="M15 3v4h4M9 11h6M9 15h6"/></svg>;
  if (name === 'return') return <svg {...common}><path d="M9 7 5 11l4 4"/><path d="M5 11h8a6 6 0 1 1 0 12"/></svg>;
  if (name === 'provider') return <svg {...common}><path d="M4 21V8l8-4 8 4v13"/><path d="M8 11h2M14 11h2M8 15h2M14 15h2M10 21v-3h4v3"/></svg>;
  if (name === 'payable') return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/></svg>;
  return <svg {...common}><path d="M12 3 4 8l8 5 8-5-8-5Z"/><path d="M4 12l8 5 8-5M4 16l8 5 8-5"/></svg>;
}
function ReturnUiIcon({ name }) {
  const c={viewBox:'0 0 24 24','aria-hidden':true};
  if(name==='box')return <svg {...c}><path d="M4 7l8-4 8 4-8 4-8-4Z"/><path d="M4 7v10l8 4 8-4V7M12 11v10"/></svg>;
  if(name==='trace')return <svg {...c}><path d="M7 3h10v18H7zM10 7h4M10 11h4M10 15h4"/></svg>;
  if(name==='shield')return <svg {...c}><path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3Z"/><path d="m9 12 2 2 4-4"/></svg>;
  if(name==='check')return <svg {...c}><rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 3 3 5-6"/></svg>;
  if(name==='doc')return <svg {...c}><path d="M6 3h9l3 3v15H6zM15 3v4h4M9 11h6M9 15h6"/></svg>;
  if(name==='ban')return <svg {...c}><circle cx="12" cy="12" r="8"/><path d="m7 17 10-10"/></svg>;
  if(name==='money')return <svg {...c}><circle cx="12" cy="12" r="9"/><path d="M15 8.5c-.8-.7-1.7-1-3-1-1.7 0-3 .8-3 2s1 1.8 3 2.3 3 1.1 3 2.4-1.3 2.3-3 2.3c-1.4 0-2.5-.4-3.4-1.2M12 5v14"/></svg>;
  if(name==='search')return <svg {...c}><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg>;
  return <svg {...c}><path d="M9 7 5 11l4 4M5 11h8a6 6 0 1 1 0 12"/></svg>;
}
function Status({ value }) {
  const v = String(value || '—').toUpperCase();
  const cls = ['ACTIVO', 'PAGADA', 'COMPLETADA', 'ACEPTADA', 'ENVIADA'].includes(v) ? 'good' : ['CANCELADO', 'CANCELADA', 'RECHAZADA', 'INACTIVO'].includes(v) ? 'bad' : ['PENDIENTE', 'PARCIAL', 'BORRADOR'].includes(v) ? 'wait' : 'neutral';
  return <span className={`commercial-status ${cls}`}>{v}</span>;
}
function Pager({ page, setPage, total, pageSize = 5 }) {
  const pages = Math.max(1, Math.ceil(Number(total || 0) / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  const start = Math.max(1, Math.min(current - 2, pages - 4));
  const visible = Array.from({length: Math.min(5, pages)}, (_,i) => start + i);
  return <div className="r69-pager">
    <span>Mostrando {total ? (current-1)*pageSize+1 : 0} a {Math.min(current*pageSize,total)} de {total}</span>
    <div>
      <button disabled={current<=1} onClick={()=>setPage(Math.max(1,current-1))}>‹</button>
      {visible.map((n)=><button key={n} className={n===current?'active':''} onClick={()=>setPage(n)}>{n}</button>)}
      <button disabled={current>=pages} onClick={()=>setPage(Math.min(pages,current+1))}>›</button>
    </div>
  </div>;
}
function DataTable({ headers, children, empty, dense = false }) {
  const count = Array.isArray(children) ? children.length : children ? 1 : 0;
  return <div className={`commercial-table-wrap ${dense ? 'dense' : ''}`}><table><thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{count ? children : <tr><td colSpan={headers.length}><div className="empty-box">{empty}</div></td></tr>}</tbody></table></div>;
}
