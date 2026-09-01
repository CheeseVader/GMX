import { brandText } from "../config/brand.js";import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api.js';
import VisionScannerModal from '../components/VisionScannerModal.jsx';
import VisionInternetResultsModal from '../components/VisionInternetResultsModal.jsx';
import VisionCandidatePicker from '../components/VisionCandidatePicker.jsx';
import { visionQueries, scoreVisionCandidate } from '../utils/vision.js';
import OrderDetailModal from '../components/OrderDetailModal.jsx';
import MixedPaymentsPanel from '../components/MixedPaymentsPanel.jsx';
import StoreSlideshow from '../components/public/StoreSlideshow.jsx';
import { R23BarList } from '../components/VisualKitR23.jsx';
import '../phase_shiny_exact_views_r23.css';
import '../pos_client_required_r5b.css';
import './OrdersPagePOSClassic.css';
import useAdminBrand from '../hooks/useAdminBrand.js';

import './OrdersPageOrdersR62.css';
import './OrdersPageR75Integration.css';
import '../return_pin_authorization_r77.css';
import './OrdersPagePOSRecommendedR78.css';
// GMX_POS_CARD_CATALOG_R1
const GMX_POS_BANKS = [
  ['BBVA','BBVA'],['BANAMEX','Banamex'],['BANORTE','Banorte'],['SANTANDER','Santander'],
  ['HSBC','HSBC'],['SCOTIABANK','Scotiabank'],['BANCO_AZTECA','Banco Azteca'],
  ['BANREGIO','Banregio'],['HEY_BANCO','Hey Banco'],['INBURSA','Inbursa'],['AFIRME','Afirme'],
  ['BANBAJIO','BanBajio'],['MIFEL','Banca Mifel'],['MULTIVA','Banco Multiva'],['INVEX','INVEX'],
  ['NU','Nu'],['KLAR','Klar'],['UALA','Uala'],['MERCADO_PAGO','Mercado Pago'],['STORI','Stori'],
  ['PLATA','Plata'],['RAPPI','RappiCard'],['AMEX','American Express'],['OTRO','Otro banco / emisor']
];
const GMX_POS_CARD_BRANDS = [['VISA','Visa'],['MASTERCARD','Mastercard'],['AMEX','American Express'],['CARNET','Carnet'],['OTRA','Otra']];
const GMX_POS_CARD_TYPES = [['CREDITO','Crédito'],['DEBITO','Débito'],['PREPAGO','Prepago'],['OTRO','Otro']];

function money(value) {
  if (value === null || value === '' || typeof value === 'undefined') return '—';
  return Number(value).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}

// POS-UX-006 — sanitización de captura para caja.
function sanitizeMoneyInput(value) {
  if (value === null || typeof value === 'undefined') return '';
  let text = String(value).replace(',', '.').replace(/[^0-9.]/g, '');
  const firstDot = text.indexOf('.');
  if (firstDot >= 0) {
    text = text.slice(0, firstDot + 1) + text.slice(firstDot + 1).replace(/\./g, '');
    const [whole, decimals = ''] = text.split('.');
    text = `${whole || '0'}.${decimals.slice(0, 2)}`;
  }
  return text.slice(0, 14);
}

function sanitizePaymentReference(value) {
  return String(value || '').replace(/[^a-zA-Z0-9 _./-]/g, '').slice(0, 80);
}

export default function OrdersPage({ mode = '' }) {
  // Shiny_POS_PAGO_MIXTO_001_V5_3
  const forcedMode = mode === 'orders' || mode === 'pos'
    ? mode
    : (typeof window !== 'undefined' && window.location.pathname.includes('/pedidos') ? 'orders' : 'pos');
  const [tab, setTab] = useState(forcedMode);
  const [orderStatusFilter, setOrderStatusFilter] = useState('ALL');
  const [orderPage, setOrderPage] = useState(1);
  const [orderPageSize, setOrderPageSize] = useState(10);
  const [branches, setBranches] = useState([]);
  const [clients, setClients] = useState([]);
  const [clientSearch, setClientSearch] = useState('');
  const [clientSearchOpen, setClientSearchOpen] = useState(false);
  const [clientLoading, setClientLoading] = useState(false);
  const [inventory, setInventory] = useState([]);
  const [orders, setOrders] = useState([]);
  const [branchId, setBranchId] = useState('');
  const [clientId, setClientId] = useState('');
  const [selectedPosClient, setSelectedPosClient] = useState(null);
  // GMX_POS_RESET_CLIENT_AFTER_SALE_R5J
  // GMX_POS_NEW_SALE_RESET_R5M
  function resetPosClientAfterSale() {
    setClientId('');
    setClientSearch('');
    setSelectedPosClient(null);
    setLoyalty(null);
    setPointsToRedeem(0);
    setClientSearchOpen(false);
    setClientModalOpen(false);

    setPaymentMethod('EFECTIVO');
    setPaymentReference('');
    setPayments([{ method: 'EFECTIVO', amount: 0, cashReceived: 0, reference: '' }]);
    setNotes('');
    setPromoCode('');
    setBenefitPreview(null);
    setManualDiscountType('PORCENTAJE');
    setManualDiscountValue(0);
    setManualDiscountReason('');
    setManualDiscountPin('');
    setDiscountModalOpen(false);
    setNotesModalOpen(false);
    setPromoModalOpen(false);
    setPointsModalOpen(false);
    setCheckoutModalOpen(false);
    setProductSearch('');
    setSaleAttempt({ key: '', fingerprint: '' });
    setPosSource(null);
    setCart([]);

    try {
      const current = new URL(window.location.href);
      current.searchParams.delete('client');
      current.searchParams.delete('membershipSku');
      window.history.replaceState({}, '', current.pathname + (current.searchParams.toString() ? '?' + current.searchParams.toString() : ''));
    } catch {}
  }
  const [paymentMethod, setPaymentMethod] = useState('EFECTIVO');
  // GMX_POS_SELECTED_CLIENT_INFO_R5B
  useEffect(() => {
    let alive = true;
    if (!clientId) {
      setSelectedPosClient(null);
      return () => { alive = false; };
    }
    api('/api/v1/clients?limit=20&search=' + encodeURIComponent(clientId))
      .then((body) => {
        if (!alive) return;
        const rows = Array.isArray(body?.data) ? body.data : [];
        const exact = rows.find((row) => String(row.id_cliente) === String(clientId)) || rows[0] || null;
        setSelectedPosClient(exact);
      })
      .catch(() => { if (alive) setSelectedPosClient(null); });
    return () => { alive = false; };
  }, [clientId]);
  const [paymentReference, setPaymentReference] = useState('');
  // GMX_POS_CARD_STATE_R1
  const [cardBank, setCardBank] = useState('');
  const [cardBrand, setCardBrand] = useState('');
  const [cardType, setCardType] = useState('');
  const [payments, setPayments] = useState([{ method: 'EFECTIVO', amount: 0, cashReceived: 0, reference: '' }]);
  const [notes, setNotes] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [orderSearch, setOrderSearch] = useState('');
  const [cart, setCart] = useState([]);
  const [message, setMessage] = useState('');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [completedOrder, setCompletedOrder] = useState(null);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [payOrder, setPayOrder] = useState(null);
  const [payMethod, setPayMethod] = useState('EFECTIVO');
  const [payReference, setPayReference] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [payBusy, setPayBusy] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [pointsToRedeem, setPointsToRedeem] = useState(0);
  const [benefitPreview, setBenefitPreview] = useState(null);
  // POS-007 — descuento manual
  const [currentUser, setCurrentUser] = useState(null);
  const [posFullscreen, setPosFullscreen] = useState(() => typeof document !== 'undefined' && Boolean(document.fullscreenElement));
  const [posSessionStarted, setPosSessionStarted] = useState(() => typeof document !== 'undefined' && Boolean(document.fullscreenElement));
  const [posExitOpen, setPosExitOpen] = useState(false);
  const [posExitPassword, setPosExitPassword] = useState('');
  const [posExitError, setPosExitError] = useState('');
  const [posExitBusy, setPosExitBusy] = useState(false);
  const posFullscreenEnteredRef = useRef(false);
  const posExitAuthorizedRef = useRef(false);
  const posLongPressRef = useRef(null);
  const membershipUrlLoadedRef = useRef(false);
  const [posStandalone, setPosStandalone] = useState(() => {
    if (typeof window === 'undefined') return false;
    return Boolean(window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator?.standalone);
  });
  const posKioskMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('kiosk') === '1';
  const isOperator = String(currentUser?.rol || '').toUpperCase() === 'OPERADOR';
  const operatorBranchId = String(currentUser?.sucursal_principal || currentUser?.branchScope?.principal || currentUser?.sucursales_permitidas?.[0] || '').trim();
  const fullscreenCapable = typeof document !== 'undefined' && Boolean(document.fullscreenEnabled && document.documentElement?.requestFullscreen);

  async function enterPosFullscreen() {
    if (!isOperator || posStandalone || posKioskMode || posFullscreen) return;
    if (!fullscreenCapable) {
      setMessage(brandText("Este navegador no permite pantalla completa desde la página. Abre GMX como aplicación/PWA o en modo kiosco."));
      return;
    }
    try {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      setPosSessionStarted(true);
      posFullscreenEnteredRef.current = true;
    } catch {
      try {
        await document.documentElement.requestFullscreen();
        setPosSessionStarted(true);
        posFullscreenEnteredRef.current = true;
      } catch {
        setMessage('No fue posible activar pantalla completa. Pulsa nuevamente o usa el modo aplicación/kiosco del dispositivo.');
      }
    }
  }

  function openProtectedPosExit() {
    if (!isOperator) return;
    setPosExitPassword('');
    setPosExitError('');
    setPosExitOpen(true);
  }

  function clearPosLongPress() {
    if (posLongPressRef.current) {
      window.clearTimeout(posLongPressRef.current);
      posLongPressRef.current = null;
    }
  }

  function startPosLongPress() {
    if (!isOperator) return;
    clearPosLongPress();
    posLongPressRef.current = window.setTimeout(() => {
      posLongPressRef.current = null;
      openProtectedPosExit();
    }, 5000);
  }

  async function cancelProtectedPosExit() {
    setPosExitOpen(false);
    setPosExitPassword('');
    setPosExitError('');
    if (isOperator && !posStandalone && !posKioskMode && !document.fullscreenElement && fullscreenCapable) {
      await enterPosFullscreen();
    }
  }

  async function authorizeProtectedPosExit(event) {
    event?.preventDefault?.();
    if (posExitBusy) return;
    if (!posExitPassword) {setPosExitError('Escribe tu contraseña.');return;}
    setPosExitBusy(true);
    setPosExitError('');
    try {
      await api('/api/auth/verify-password', { method: 'POST', body: JSON.stringify({ password: posExitPassword }) });
      posExitAuthorizedRef.current = true;
      try {if (document.fullscreenElement) await document.exitFullscreen();} catch {}
      try {await api('/api/auth/logout', { method: 'POST' });} catch {}
      localStorage.removeItem('Shiny_AUTH_TOKEN');
      localStorage.removeItem('Shiny_AUTH_USER');
      localStorage.removeItem('Shiny_AUTH_ACCESS');
      window.location.assign('/login');
    } catch (error) {
      setPosExitError(error?.message === 'INVALID_CREDENTIALS' ? 'Contraseña incorrecta.' : String(error?.message || 'No fue posible autorizar la salida.'));
    } finally {
      setPosExitBusy(false);
    }
  }
  const [manualDiscountType, setManualDiscountType] = useState('PORCENTAJE');
  const [manualDiscountValue, setManualDiscountValue] = useState(0);
  const [manualDiscountReason, setManualDiscountReason] = useState('');
  const [manualDiscountPin, setManualDiscountPin] = useState('');
  const [loyalty, setLoyalty] = useState(null);
  const [saleType, setSaleType] = useState('ALL');
  const [tcgGames, setTcgGames] = useState([]);
  const [tcgSets, setTcgSets] = useState([]);
  const [gameId, setGameId] = useState('');
  const [setId, setSetId] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [productCategories, setProductCategories] = useState([]);
  const [productCategory, setProductCategory] = useState('');
  const [visionOpen, setVisionOpen] = useState(false);
  const [visionCandidates, setVisionCandidates] = useState([]);
  const [visionPickerOpen, setVisionPickerOpen] = useState(false);
  const [visionInternetOpen, setVisionInternetOpen] = useState(false);
  const [visionInternetBusy, setVisionInternetBusy] = useState(false);
  const [visionInternetCandidates, setVisionInternetCandidates] = useState([]);
  const [visionInternetError, setVisionInternetError] = useState('');
  const [visionInternetQuery, setVisionInternetQuery] = useState('');
  const [catalogOpen, setCatalogOpen] = useState(false);
  // POS-UX-004 — selector de cliente en modal y catálogo/existencias unificados con filtro de sucursal.
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [membershipClientRequiredOpen, setMembershipClientRequiredOpen] = useState(false);
  const [catalogBranchId, setCatalogBranchId] = useState('');
  // POS-UX-002B — feedback inmediato al agregar artículos desde el catálogo.
  const [catalogAddFeedback, setCatalogAddFeedback] = useState(null);
  // POS-UX-003 — acciones del PDV mediante modales, sin paneles permanentes.
  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  const [notesModalOpen, setNotesModalOpen] = useState(false);
  const [promoModalOpen, setPromoModalOpen] = useState(false);
  const [pointsModalOpen, setPointsModalOpen] = useState(false);
  // POS-UX-005 — el cobro se captura únicamente al pulsar COBRAR.
  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false);
  // POS-UX-002A — búsqueda manual, lector físico y cámara separados.
  const [scanMode, setScanMode] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [orderLookupOpen, setOrderLookupOpen] = useState(false);
  const [orderLookupSearch, setOrderLookupSearch] = useState('');
  const [orderLookupResults, setOrderLookupResults] = useState([]);
  const [orderLookupBusy, setOrderLookupBusy] = useState(false);
  const [posSource, setPosSource] = useState(null);
  const [storefrontRuntime, setStorefrontRuntime] = useState({ zones: {}, settings: {}, promotions: [] });
  const posBrand = useAdminBrand();
  const posBrandName = String(posBrand?.name || 'GMX').trim() || 'GMX';
  const [returnLauncherOpen, setReturnLauncherOpen] = useState(false);
  const scanInputRef = useRef(null);
  const cameraVideoRef = useRef(null);
  const cameraStreamRef = useRef(null);

  // DEV-004B — devolución POS dentro del mismo punto de venta.
  // El token de autorización vive únicamente en memoria durante esta operación.
  const [returnFlow, setReturnFlow] = useState({
    open: false, stage: 'auth', order: null, password: '',
    authorizationToken: '', authorizationId: '', authorizer: null, items: [],
    reason: '', refund: false, refundMethod: 'EFECTIVO', refundReference: '',
    notes: '', reintegrateStock: true, busy: false, error: ''
  });

  // Shiny_POS_FIX_002
  // Si una respuesta se pierde, el mismo payload reutiliza la misma clave.
  // Si carrito/pagos cambian, se genera una clave nueva.
  const [saleAttempt, setSaleAttempt] = useState({ key: '', fingerprint: '' });

  async function loadBranches() {
    const body = await api('/api/v1/branches?includeInactive=false');
    setBranches(body.data);
    if (!branchId && body.data[0]) setBranchId(body.data[0].id_sucursal);
    if (!catalogBranchId && body.data[0]) setCatalogBranchId(body.data[0].id_sucursal);
  }

  // GMX_POS_LOAD_ALL_CLIENTS_R5C
  async function loadClients(term = '') {
    setClientLoading(true);
    try {
      const all = [];
      let offset = 0;
      for (let page = 0; page < 100; page += 1) {
        const params = new URLSearchParams({
          limit: '200',
          offset: String(offset),
          search: String(term || '').trim()
        });
        const body = await api(`/api/v1/clients?${params}`);
        const batch = Array.isArray(body.data) ? body.data : [];
        all.push(...batch);
        if (batch.length < 200) break;
        offset += 200;
      }
      setClients(all);
    } finally {
      setClientLoading(false);
    }
  }

  async function loadProductCategories() {
    const body = await api('/api/v1/products/meta/categories');
    setProductCategories(body.data || []);
  }


  async function loadInventory(selectedBranch = branchId, options = {}) {
    if (!selectedBranch) {setInventory([]);return;}
    const params = new URLSearchParams({
      branchId: selectedBranch,
      type: options.type ?? saleType,
      search: options.search ?? productSearch,
      gameId: options.gameId ?? gameId,
      setId: options.setId ?? setId,
      category: options.category ?? productCategory,
      limit: '180'
    });
    setCatalogLoading(true);
    try {
      const body = await api(`/api/v1/orders/pos/catalog?${params}`);
      setInventory(body.data || []);
    } finally {
      setCatalogLoading(false);
    }
  }

  async function loadTcgGames() {
    const body = await api('/api/v1/tcg/games');
    setTcgGames((body.data || []).filter((x) => x.activo !== false));
  }

  async function loadTcgSets(selectedGame = gameId) {
    if (!selectedGame) {setTcgSets([]);return;}
    const body = await api(`/api/v1/tcg/sets?gameId=${encodeURIComponent(selectedGame)}`);
    setTcgSets((body.data || []).filter((x) => x.activo !== false));
  }

  async function searchOrdersForPOS(term = '') {
    const search = String(term || '').trim();

    setOrderLookupBusy(true);
    setMessage('');

    try {
      const params = new URLSearchParams({
        limit: search ? '50' : '20',
        search
      });

      const [body, returnsBody] = await Promise.all([
      api(`/api/v1/orders?${params.toString()}`),
      api('/api/v1/commercial/returns?limit=1000').catch(() => ({ data: [] }))]
      );

      const returnByOrder = new Map();

      for (const r of returnsBody.data || []) {
        const orderId = String(r.referencia || '').trim();
        if (!orderId || returnByOrder.has(orderId)) continue;

        const sold = Number(r.unidades_vendidas_pedido || 0);
        const returned = Number(r.unidades_devueltas_pedido || 0);
        let returnStatus = '';

        if (returned > 0) {
          returnStatus = sold > 0 && returned >= sold ? 'DEVUELTO TOTAL' : 'DEVUELTO PARCIAL';
        }

        returnByOrder.set(orderId, {
          returnStatus,
          sold,
          returned
        });
      }

      const rows = (body.data || []).map((order) => {
        const ret = returnByOrder.get(String(order.id_pedido || ''));

        return {
          ...order,
          estado_devolucion: ret?.returnStatus || '',
          unidades_vendidas_originales: ret?.sold || Number(order.unidades || 0),
          unidades_devueltas: ret?.returned || 0
        };
      });

      setOrderLookupResults(rows);
    } catch (error) {
      setMessage(error.message || 'No se pudo buscar el pedido.');
      setOrderLookupResults([]);
    } finally {
      setOrderLookupBusy(false);
    }
  }


  function orderDetailsToPosCart(order) {
    return (Array.isArray(order?.detalles) ? order.detalles : []).map((detail, index) => {
      const itemType = String(detail.tipo || 'PRODUCT').toUpperCase() === 'TCG' ? 'TCG' : 'PRODUCT';
      const itemId = itemType === 'TCG' ? detail.id_inventario : detail.id_producto;
      const quantity = Math.max(1, Number(detail.cantidad || 1));
      return {
        item_type: itemType,
        item_id: itemId,
        product_id: itemType === 'PRODUCT' ? detail.id_producto : null,
        inventory_id: itemType === 'TCG' ? detail.id_inventario : null,
        name: detail.producto || 'Artículo',
        sku: detail.sku || '',
        price: Number(detail.precio_unitario ?? detail.precio ?? 0),
        stock: quantity,
        quantity,
        key: `${itemType}:${itemId || detail.id_detalle || index}`,
        source_detail_id: detail.id_detalle || ''
      };
    });
  }

  async function loadExternalPosContext() {
    if (typeof window === 'undefined' || forcedMode !== 'pos') return;
    const params = new URLSearchParams(window.location.search);
    const pendingOrderId = String(params.get('order') || localStorage.getItem('SHINY_POS_PENDING_ORDER') || '').trim();
    const pendingReturnId = String(params.get('return') || localStorage.getItem('SHINY_POS_PENDING_RETURN') || '').trim();
    if (!pendingOrderId && !pendingReturnId) return;

    try {
      if (pendingReturnId) {
        const returnBody = await api(`/api/v1/commercial/returns/${encodeURIComponent(pendingReturnId)}`);
        const returnData = returnBody.data;
        const reference = String(returnData?.referencia || '').trim();
        if (!reference) throw new Error('La devolución no tiene un pedido de origen.');

        const searchBody = await api(`/api/v1/orders?limit=50&search=${encodeURIComponent(reference)}`);
        const row = (searchBody.data || []).find((x) => String(x.id_pedido) === reference);
        if (!row?.row_id) throw new Error(`No se encontró el pedido ${reference} asociado a la devolución.`);

        const fullBody = await api(`/api/v1/orders/${row.row_id}`);
        const order = fullBody.data;
        setBranchId(order.id_sucursal || '');
        setClientId(order.id_cliente || '');
        setCart(orderDetailsToPosCart(order));
        setPosSource({ type: 'RETURN', id: pendingReturnId, reference, rowId: row.row_id, order, returnData });
        setMessage(`Devolución ${pendingReturnId} cargada en POS con ${order.detalles?.length || 0} partida(s).`);
        localStorage.removeItem('SHINY_POS_PENDING_RETURN');
        return;
      }

      const searchBody = await api(`/api/v1/orders?limit=50&search=${encodeURIComponent(pendingOrderId)}`);
      const row = (searchBody.data || []).find((x) => String(x.id_pedido) === pendingOrderId);
      if (!row?.row_id) throw new Error(`No se encontró el pedido ${pendingOrderId}.`);

      const fullBody = await api(`/api/v1/orders/${row.row_id}`);
      const order = fullBody.data;
      setBranchId(order.id_sucursal || '');
      setClientId(order.id_cliente || '');
      setCart(orderDetailsToPosCart(order));
      setNotes(order.notas || '');
      setPosSource({ type: 'ORDER', id: order.id_pedido, rowId: order.row_id, order });
      setMessage(`Pedido ${order.id_pedido} cargado en POS. Revisa los artículos y continúa con el cobro.`);
      localStorage.removeItem('SHINY_POS_PENDING_ORDER');
    } catch (error) {
      setMessage(error.message || 'No fue posible cargar la operación en POS.');
    }
  }

  async function loadOrders(term = orderSearch) {
    // Shiny_POS_HIST_DEV_001
    const params = new URLSearchParams({
      limit: '200',
      search: term
    });

    const [body, returnsBody] = await Promise.all([
    api(`/api/v1/orders?${params.toString()}`),
    api('/api/v1/commercial/returns?limit=1000').catch(() => ({ data: [] }))]
    );

    const returnByOrder = new Map();
    for (const r of returnsBody.data || []) {
      const orderId = String(r.referencia || '').trim();
      if (!orderId || returnByOrder.has(orderId)) continue;

      const sold = Number(r.unidades_vendidas_pedido || 0);
      const returned = Number(r.unidades_devueltas_pedido || 0);
      let returnStatus = '';
      if (returned > 0) {
        returnStatus = sold > 0 && returned >= sold ? 'DEVUELTO TOTAL' : 'DEVUELTO PARCIAL';
      }
      returnByOrder.set(orderId, {
        returnStatus,
        sold,
        returned
      });
    }

    setOrders((body.data || []).map((order) => {
      const ret = returnByOrder.get(String(order.id_pedido || ''));
      return {
        ...order,
        estado_devolucion: ret?.returnStatus || '',
        unidades_vendidas_originales: ret?.sold || Number(order.unidades || 0),
        unidades_devueltas: ret?.returned || 0
      };
    }));
  }

  useEffect(() => {
    Promise.all([loadBranches(), loadClients(''), loadOrders(''), loadTcgGames(), loadProductCategories()]).
    catch((error) => setMessage(error.message));
  }, []);
  useEffect(() => {
    setTab(forcedMode);
  }, [forcedMode]);
  useEffect(() => {
    if (forcedMode !== 'pos') return;
    loadExternalPosContext();
  }, [forcedMode]);
  // GMX_MEMBERSHIP_URL_CONTEXT_R3A
  useEffect(() => {
    if (typeof window === 'undefined' || forcedMode !== 'pos' || !branchId || membershipUrlLoadedRef.current) return;

    const params = new URLSearchParams(window.location.search);
    const requestedClientId = String(params.get('client') || '').trim();
    const requestedMembershipSku = String(params.get('membershipSku') || '').trim();

    if (!requestedClientId && !requestedMembershipSku) return;
    membershipUrlLoadedRef.current = true;

    (async () => {
      if (requestedClientId) {
        setClientId(requestedClientId);
        try {
          const clientBody = await api('/api/v1/clients?limit=20&search=' + encodeURIComponent(requestedClientId));
          const foundClient = (clientBody.data || []).find((x) => String(x.id_cliente) === requestedClientId) || (clientBody.data || [])[0];
          if (foundClient) {
            setClientSearch(foundClient.nombre || foundClient.email || foundClient.telefono || foundClient.id_cliente);
          }
        } catch {}
      }

      if (requestedMembershipSku) {
        const paramsCatalog = new URLSearchParams({
          branchId: String(branchId),
          type: 'ALL',
          search: requestedMembershipSku,
          gameId: '',
          setId: '',
          category: '',
          limit: '40'
        });
        const catalogBody = await api('/api/v1/orders/pos/catalog?' + paramsCatalog.toString());
        const rows = Array.isArray(catalogBody.data) ? catalogBody.data : [];
        const target = requestedMembershipSku.toUpperCase();
        const item = rows.find((x) => String(x.sku || '').trim().toUpperCase() === target);

        if (!item) {
          throw new Error('No se encontro el SKU de membresia ' + requestedMembershipSku + ' en el catalogo POS.');
        }

        addToCart(item);
        setProductSearch('');
        setMessage('Membresia ' + requestedMembershipSku + ' cargada para el cliente seleccionado.');
      }
    })().catch((error) => {
      membershipUrlLoadedRef.current = false;
      setMessage(error?.message || 'No fue posible cargar la membresia seleccionada en POS.');
    });
  }, [forcedMode, branchId]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onFullscreen = () => {
      const active = Boolean(document.fullscreenElement);
      setPosFullscreen(active);
      if (active) {
        posFullscreenEnteredRef.current = true;
        setPosSessionStarted(true);
        return;
      }
      if (isOperator && !posStandalone && posFullscreenEnteredRef.current && !posExitAuthorizedRef.current) {
        setPosSessionStarted(true);
        setPosExitPassword('');
        setPosExitError('');
        setPosExitOpen(true);
      }
    };
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => document.removeEventListener('fullscreenchange', onFullscreen);
  }, [isOperator, posStandalone]);

  useEffect(() => {
    if (!isOperator || typeof window === 'undefined') return undefined;
    const onKeyDown = (event) => {
      const key = String(event.key || '').toLowerCase();

      // Salida normal protegida de Shiny:
      // Ctrl + Alt + X abre el modal SIN abandonar Fullscreen.
      if (!(event.ctrlKey && event.altKey && key === 'x')) return;
      if (!posFullscreenEnteredRef.current && !posKioskMode || posExitAuthorizedRef.current) return;

      event.preventDefault();
      event.stopPropagation();
      setPosSessionStarted(true);
      setPosExitPassword('');
      setPosExitError('');
      setPosExitOpen(true);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isOperator, posKioskMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const media = window.matchMedia?.('(display-mode: standalone)');
    const sync = () => setPosStandalone(Boolean(media?.matches || window.navigator?.standalone));
    sync();
    media?.addEventListener?.('change', sync);
    return () => media?.removeEventListener?.('change', sync);
  }, []);

  useEffect(() => {
    if (!isOperator || typeof document === 'undefined') return undefined;
    document.documentElement.classList.add('tcg_store_template-operator-pos-document');
    document.body.classList.add('tcg_store_template-operator-pos-body');
    return () => {
      document.documentElement.classList.remove('tcg_store_template-operator-pos-document');
      document.body.classList.remove('tcg_store_template-operator-pos-body');
    };
  }, [isOperator]);

  useEffect(() => {
    api('/api/auth/me').
    then((r) => setCurrentUser(r.data?.user || null)).
    catch(() => setCurrentUser(null));
  }, []);

  useEffect(() => {
    api('/api/v1/cms/storefront-runtime?preview=true')
      .then((r) => setStorefrontRuntime(r.data || { zones: {}, settings: {}, promotions: [] }))
      .catch(() => setStorefrontRuntime({ zones: {}, settings: {}, promotions: [] }));
  }, []);

  useEffect(() => {
    if (!isOperator) return;
    if (!operatorBranchId) {
      setBranchId('');
      setCatalogBranchId('');
      setMessage('Usuario sin sucursal asignada. Contacta a un SUPERADMIN.');
      return;
    }
    const assigned = branches.find((b) => String(b.id_sucursal) === operatorBranchId);
    if (!assigned && branches.length) {
      setBranchId('');
      setCatalogBranchId('');
      setMessage('La sucursal asignada al operador no está disponible. Contacta a un SUPERADMIN.');
      return;
    }
    setBranchId(operatorBranchId);
    setCatalogBranchId(operatorBranchId);
  }, [isOperator, operatorBranchId, branches]);

  useEffect(() => {
    if (!branchId) return;
    setCart([]);
    setCatalogBranchId(branchId);
    loadInventory(branchId, { search: '', type: saleType, gameId, setId }).catch((error) => setMessage(error.message));
  }, [branchId]);

  useEffect(() => {
    if (!posSource?.order || !branchId) return;
    if (String(posSource.order.id_sucursal || '') !== String(branchId)) return;
    setCart(orderDetailsToPosCart(posSource.order));
  }, [branchId, posSource?.id]);

  useEffect(() => {
    setSetId('');
    if (gameId) loadTcgSets(gameId).catch((error) => setMessage(error.message));else
    setTcgSets([]);
  }, [gameId]);

  useEffect(() => {
    const selectedBranch = catalogOpen ? catalogBranchId || branchId : branchId;
    if (!selectedBranch) return;
    const timer = setTimeout(() => {
      loadInventory(selectedBranch).catch((error) => setMessage(error.message));
    }, 250);
    return () => clearTimeout(timer);
  }, [productSearch, saleType, gameId, setId, productCategory, catalogBranchId, catalogOpen]);

  const visibleInventory = inventory;


  const total = useMemo(() => {
    return cart.reduce(
      (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
      0
    );
  }, [cart]);


  useEffect(() => {
    const timer = setTimeout(() => {
      loadClients(clientSearch).catch((error) => setMessage(error.message));
    }, 250);
    return () => clearTimeout(timer);
  }, [clientSearch]);

  useEffect(() => {
    if (!clientId) {setLoyalty(null);setPointsToRedeem(0);return;}
    api(`/api/v1/benefits/clients/${clientId}`).
    then((r) => setLoyalty(r.data?.account || null)).
    catch(() => setLoyalty(null));
  }, [clientId]);

  async function previewBenefits({ promo = promoCode, points = pointsToRedeem, silent = false } = {}) {
    try {
      const normalizedPromo = String(promo || '').trim().toUpperCase();
      const normalizedPoints = Math.max(0, Number(points || 0));
      const r = await api('/api/v1/benefits/quote', {
        method: 'POST',
        body: JSON.stringify({
          clientId, subtotal: total, promoCode: normalizedPromo, points: normalizedPoints,
          channel: 'POS_LOCAL', branchId
        })
      });
      setPromoCode(normalizedPromo);
      setPointsToRedeem(normalizedPoints);
      setBenefitPreview(r.data);
      if (!silent) setMessage(normalizedPromo ? 'Promoción aplicada correctamente.' : 'Beneficios validados.');
      return r.data;
    } catch (e) {setBenefitPreview(null);setMessage(e.message);throw e;}
  }

  const itemKey = (item) => `${item.item_type || 'PRODUCT'}:${item.item_id || item.product_id || item.inventory_id}`;


  function stopCamera() {
    try {cameraStreamRef.current?.getTracks?.().forEach((track) => track.stop());} catch {}
    cameraStreamRef.current = null;
    if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null;
  }

  async function resolveScannedCode(rawCode, { source = 'LECTOR' } = {}) {
    const code = String(rawCode || '').trim();
    if (!code || !branchId) return;
    setScanBusy(true);
    setMessage('');
    try {
      const params = new URLSearchParams({ branchId, type: 'ALL', search: code, gameId: '', setId: '', category: '', limit: '40' });
      const body = await api(`/api/v1/orders/pos/catalog?${params}`);
      const rows = Array.isArray(body.data) ? body.data : [];
      const norm = (value) => String(value ?? '').trim().toUpperCase();
      const target = norm(code);
      const exact = rows.filter((item) => [item.sku, item.item_id, item.product_id, item.inventory_id, item.card_number].some((value) => norm(value) === target));
      const matches = exact.length ? exact : rows;
      if (matches.length === 1) {
        addToCart(matches[0]);setProductSearch('');setScanMode(true);
        setMessage(`${source}: ${code} agregado al carrito.`);
        setTimeout(() => scanInputRef.current?.focus(), 0);return;
      }
      if (matches.length > 1) {
        setInventory(matches);setProductSearch(code);setCatalogOpen(true);setScanMode(false);
        setMessage(`Se encontraron ${matches.length} coincidencias para ${code}. Selecciona el artículo.`);return;
      }
      // El mismo buscador también acepta códigos promocionales.
      try {
        const quote = await previewBenefits({ promo: code, points: 0, silent: true });
        const discount = Number(quote?.discountPromo || 0);
        if (discount > 0) {
          setProductSearch('');setScanMode(true);
          setMessage(`✓ Promoción ${code.toUpperCase()} aplicada: -${money(discount)}.`);
          setTimeout(() => scanInputRef.current?.focus(), 0);return;
        }
      } catch {}
      setMessage(`Código ${code} no encontrado como artículo o promoción disponible.`);
      setTimeout(() => scanInputRef.current?.focus(), 0);
    } catch (error) {setMessage(error.message || 'No se pudo procesar el código.');} finally
    {setScanBusy(false);}
  }

  async function handleVisionPosResult(result) {
    if (!branchId) throw new Error('No hay sucursal activa para la venta.');

    if (result?.barcode) {
      setVisionOpen(false);
      await resolveScannedCode(result.barcode, { source: 'VISION' });
      return;
    }

    const queries = visionQueries(result, { max: 6 });
    const found = new Map();

    for (const q of queries) {
      const params = new URLSearchParams({
        branchId,
        type: 'ALL',
        search: q,
        gameId: '',
        setId: '',
        category: '',
        limit: '60'
      });
      try {
        const r = await api(`/api/v1/orders/pos/catalog?${params}`);
        for (const item of r.data || []) {
          const score = scoreVisionCandidate(item, result);
          const key = `${item.item_type || 'PRODUCT'}:${item.item_id || item.product_id || item.inventory_id || item.sku}`;
          const previous = found.get(key);
          if (!previous || score > previous.score) found.set(key, { ...item, key, score });
        }
      } catch {}
    }

    const candidates = [...found.values()].
    filter((x) => x.score >= 0.20).
    sort((a, b) => b.score - a.score).
    slice(0, 8);

    setVisionCandidates(candidates);
    setVisionOpen(false);

    if (candidates.length === 1 && candidates[0].score >= 0.90) {
      addToCart(candidates[0]);
      setMessage(brandText(`${candidates[0].name || candidates[0].sku} reconocido por GMX Vision y agregado al carrito.`));
      return;
    }

    if (candidates.length > 0) {
      setVisionPickerOpen(true);
      return;
    }

    // VISION-002A INTERNET FALLBACK
    const internetQuery = result?.tcgHints?.passcode || result?.tcgHints?.setCode || result?.tcgHints?.name || queries[0] || result?.text || '';
    setVisionInternetQuery(internetQuery);
    setVisionInternetCandidates([]);
    setVisionInternetError('');
    setVisionInternetBusy(true);
    setVisionInternetOpen(true);

    try {
      const external = await api('/api/v1/tcg/vision/internet-discovery', {
        method: 'POST',
        body: JSON.stringify({
          text: result?.text || '',
          queries,
          hints: result?.tcgHints || {},
          limit: 8
        })
      });
      const externalRows = external?.data?.results || [];
      setVisionInternetCandidates(externalRows);
      if (!externalRows.length) {
        setVisionInternetError('No se encontraron coincidencias externas. Toma otra foto procurando que el nombre sea legible.');
      }
    } catch (e) {
      setVisionInternetError(e.message || 'No se pudo consultar el catalogo externo.');
    } finally {
      setVisionInternetBusy(false);
    }
  }

  async function resolveUniversalPosSearch(rawValue) {
    const value = String(rawValue || '').trim();
    if (!value || !branchId) return;

    const upper = value.toUpperCase();

    try {
      if (upper.startsWith('PED-')) {
        await searchOrdersForPOS(value);
        const params = new URLSearchParams({ search: value, limit: '25' });
        const result = await api(`/api/v1/orders?${params}`);
        const rows = Array.isArray(result.data) ? result.data : [];
        const exact = rows.find((row) => String(row.id_pedido || '').toUpperCase() === upper);
        const order = exact || rows[0];
        if (order?.row_id) {
          const full = await getFullOrder(order.row_id);
          if (String(full.id_sucursal || '') && String(full.id_sucursal) !== String(branchId)) {
            setBranchId(String(full.id_sucursal));
          }
          setClientId(String(full.id_cliente || ''));
          setPosSource({ type: 'ORDER', id: full.id_pedido, order: full });
          setCart(orderDetailsToPosCart(full));
          setProductSearch('');
          setMessage(`Pedido ${full.id_pedido} cargado en POS.`);
          return;
        }
      }

      if (upper.startsWith('DEV-')) {
        const response = await api(`/api/v1/commercial/returns/${encodeURIComponent(value)}`);
        const record = response.data || {};
        const reference = String(record.reference || record.referencia || record.id_pedido || record.order_id || '').trim();
        if (!reference) throw new Error('La devolución no contiene una referencia de pedido.');
        const orderResponse = await api(`/api/v1/commercial/returns-order/${encodeURIComponent(reference)}`);
        const order = orderResponse.data;
        if (!order) throw new Error('No se encontró el pedido relacionado con la devolución.');
        if (String(order.id_sucursal || '') && String(order.id_sucursal) !== String(branchId)) {
          setBranchId(String(order.id_sucursal));
        }
        setClientId(String(order.id_cliente || ''));
        setPosSource({ type: 'RETURN', id: value, order, returnRecord: record });
        setCart(orderDetailsToPosCart(order));
        setProductSearch('');
        setMessage(`Devolución ${value} cargada en POS.`);
        return;
      }

      await resolveScannedCode(value, { source: 'BÚSQUEDA' });
    } catch (error) {
      setMessage(error?.message || 'No se pudo procesar la búsqueda.');
    }
  }

  function openReturnLauncher() {
    setReturnLauncherOpen(true);
  }

  function startSaleReturnLookup() {
    setReturnLauncherOpen(false);
    setOrderLookupSearch('');
    setOrderLookupResults([]);
    setOrderLookupOpen(true);
    searchOrdersForPOS('');
  }

  function activateScanner() {
    setCatalogOpen(false);
    setScanMode(true);
    setProductSearch('');
    setMessage('Modo escáner activo. Escanea código de barras o QR y presiona Enter.');
    setTimeout(() => scanInputRef.current?.focus(), 0);
  }

  async function openCameraScanner() {
    setCatalogOpen(false);
    setScanMode(false);
    setCameraError('');
    setCameraOpen(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('La cámara no está disponible en este navegador.');
      if (!('BarcodeDetector' in window)) throw new Error('Este navegador no soporta lectura de código/QR por cámara. Usa Chrome/Edge actualizado o un lector físico.');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      cameraStreamRef.current = stream;
      setTimeout(async () => {
        const video = cameraVideoRef.current;
        if (!video) return;
        video.srcObject = stream;
        try {await video.play();} catch {}
      }, 0);
    } catch (error) {
      setCameraError(error.message || 'No se pudo abrir la cámara.');
      stopCamera();
    }
  }

  async function detectFromCamera() {
    const video = cameraVideoRef.current;
    if (!video || !('BarcodeDetector' in window)) return;
    setScanBusy(true);
    try {
      const detector = new window.BarcodeDetector({ formats: ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'itf'] });
      const found = await detector.detect(video);
      const value = String(found?.[0]?.rawValue || '').trim();
      if (!value) {setCameraError('No se detectó ningún código. Acerca el código a la cámara e inténtalo nuevamente.');return;}
      stopCamera();
      setCameraOpen(false);
      await resolveScannedCode(value, { source: 'CÁMARA' });
    } catch (error) {
      setCameraError(error.message || 'No se pudo leer el código.');
    } finally {
      setScanBusy(false);
    }
  }

  useEffect(() => () => stopCamera(), []);

  // Shiny_POS_PAGO_MIXTO_001_V4 + POS-007
  const totalBeforeManualDiscount = useMemo(() => {
    const raw = cart.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0), 0);
    const previewTotal = Number(benefitPreview?.total);
    return Number.isFinite(previewTotal) ? Number(previewTotal.toFixed(4)) : Number(raw.toFixed(4));
  }, [cart, benefitPreview]);

  const canUseManualDiscount = true;

  const manualDiscountError = useMemo(() => {
    const value = Number(manualDiscountValue || 0);
    if (value <= 0) return '';
    if (!/^\d{4}$/.test(String(manualDiscountPin || '').trim())) return 'Captura el código de autorización de 4 dígitos.';
    if (!['PORCENTAJE', 'MONTO'].includes(manualDiscountType)) return 'Selecciona un tipo de descuento válido.';
    if (manualDiscountType === 'PORCENTAJE' && value > 100) return 'El porcentaje no puede ser mayor a 100%.';
    if (manualDiscountType === 'MONTO' && value > totalBeforeManualDiscount) return 'El descuento no puede superar el total disponible.';
    if (!String(manualDiscountReason || '').trim()) return 'Captura el motivo del descuento manual.';
    return '';
  }, [manualDiscountValue, manualDiscountType, manualDiscountReason, manualDiscountPin, totalBeforeManualDiscount, canUseManualDiscount]);

  const manualDiscountAmount = useMemo(() => {
    const value = Number(manualDiscountValue || 0);
    if (value <= 0 || manualDiscountError) return 0;
    return manualDiscountType === 'PORCENTAJE' ?
    Number((totalBeforeManualDiscount * value / 100).toFixed(4)) :
    Number(value.toFixed(4));
  }, [manualDiscountValue, manualDiscountType, totalBeforeManualDiscount, manualDiscountError]);

  const saleTotal = useMemo(() => {
    return Number(Math.max(0, totalBeforeManualDiscount - manualDiscountAmount).toFixed(2));
  }, [totalBeforeManualDiscount, manualDiscountAmount]);

  useEffect(() => {
    setBenefitPreview(null);
  }, [cart]);

  useEffect(() => {
    if (!catalogAddFeedback) return;
    const timer = setTimeout(() => setCatalogAddFeedback(null), 1800);
    return () => clearTimeout(timer);
  }, [catalogAddFeedback]);


  function addToCart(item) {
    const price = Number(item.price);
    if (!Number.isFinite(price)) {
      setMessage('El artículo no tiene un precio de venta válido.');
      return false;
    }

    const key = itemKey(item);
    const existing = cart.find((row) => row.key === key);
    const stock = Math.max(0, Number(item.stock || 0));
    const nextQuantity = (existing?.quantity || 0) + 1;

    if (nextQuantity > stock) {
      setMessage(`No hay más existencia disponible de ${item.name || 'este artículo'} en esta sucursal.`);
      setCatalogAddFeedback({ key, name: item.name || 'Artículo', quantity: existing?.quantity || 0, blocked: true, stamp: Date.now() });
      return false;
    }

    if (existing) {
      setCart((current) => current.map((row) => row.key === key ? { ...row, quantity: nextQuantity } : row));
    } else {
      setCart((current) => [...current, { ...item, key, quantity: 1 }]);
    }

    setMessage(`${item.name || 'Artículo'} agregado al carrito. Cantidad: ${nextQuantity}.`);
    setCatalogAddFeedback({ key, name: item.name || 'Artículo', quantity: nextQuantity, blocked: false, stamp: Date.now() });
    return true;
  }

  function changeQuantity(key, value) {
    const quantity = Math.max(1, Math.trunc(Number(value) || 1));
    setCart((current) => current.map((item) => item.key === key ? {
      ...item, quantity: Math.min(quantity, Number(item.stock || 0))
    } : item));
  }

  function removeFromCart(key) {
    setCart((current) => current.filter((item) => item.key !== key));
  }

  function setPaymentsSafe(update) {
    setPayments((current) => {
      const next = typeof update === 'function' ? update(current) : update;
      return (Array.isArray(next) ? next : []).map((row) => ({
        ...row,
        amount: sanitizeMoneyInput(row?.amount),
        cashReceived: sanitizeMoneyInput(row?.cashReceived),
        reference: sanitizePaymentReference(row?.reference)
      }));
    });
  }

  function blockInvalidMoneyKey(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== 'number') return;
    if (['e', 'E', '+', '-'].includes(event.key)) event.preventDefault();
  }

  function blockInvalidMoneyPaste(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== 'number') return;
    const pasted = event.clipboardData?.getData('text') || '';
    if (!/^\d*(?:[.,]\d{0,2})?$/.test(pasted.trim())) event.preventDefault();
  }

  function checkout() {
    // GMX_MEMBERSHIP_CLIENT_POPUP_CHECKOUT_R5S4
    const membershipInCart = cart.some((item) => String(item.sku || '').trim().toUpperCase().startsWith('MEM-'));
    if (membershipInCart && !clientId) {
      setMessage('');
      setMembershipClientRequiredOpen(true);
      return;
    }


    // GMX_MEMBERSHIP_CHECKOUT_GUARD_R5
    const hasMembershipSku = cart.some((item) => String(item.sku || '').trim().toUpperCase().startsWith('MEM-'));
    if (hasMembershipSku && !clientId) { setMessage('Una membresia requiere seleccionar un cliente GMX existente antes de cobrar.'); return; }
    if (hasMembershipSku && cart.some((item) => String(item.sku || '').trim().toUpperCase().startsWith('MEM-') && Number(item.quantity || 0) !== 1)) { setMessage('Cada SKU de membresia debe venderse con cantidad 1.'); return; }
    setMessage('');
    if (!cart.length) {setMessage('El carrito está vacío.');return;}
    const availablePoints = Math.max(0, Number(loyalty?.puntos_disponibles || 0));
    if (clientId && availablePoints > 0 && Number(pointsToRedeem || 0) === 0) {
      setPointsModalOpen(true);return;
    }
    setCheckoutModalOpen(true);
  }

  async function performCheckout() {
    // GMX_MEMBERSHIP_CLIENT_POPUP_PERFORM_R5S4
    const membershipInCart = cart.some((item) => String(item.sku || '').trim().toUpperCase().startsWith('MEM-'));
    if (membershipInCart && !clientId) {
      setCheckoutModalOpen(false);
      setMembershipClientRequiredOpen(true);
      return;
    }


    setMessage('');
    if (!branchId) {
      setMessage('Selecciona una sucursal.');
      return;
    }

    if (!cart.length) {
      setMessage('El carrito está vacío.');
      return;
    }

    if (Number(manualDiscountValue || 0) > 0 && manualDiscountError) {
      setMessage(manualDiscountError);
      return;
    }

    // GMX_POS_CARD_VALIDATE_R1
    if (paymentMethod === 'TARJETA') {
      if (!String(cardBank || '').trim()) { setMessage('Selecciona el banco emisor.'); return; }
      if (!String(cardBrand || '').trim()) { setMessage('Selecciona la marca / red de la tarjeta.'); return; }
      if (!String(cardType || '').trim()) { setMessage('Selecciona el tipo de tarjeta.'); return; }
      if (!String(paymentReference || '').trim()) { setMessage('Captura la referencia / folio del pago.'); return; }
    }

    try {
      if (posSource?.type === 'ORDER' && posSource?.rowId) {
        const body = await api(`/api/v1/orders/${posSource.rowId}/pay`, {
          method: 'POST',
          body: JSON.stringify({
            paymentMethod,
            paymentReference: sanitizePaymentReference(paymentReference),
            notes
          })
        });
        setCompletedOrder(body.data);
        setMessage(`Pedido ${body.data.id_pedido} cobrado correctamente desde POS.`);
        setCheckoutModalOpen(false);
        setPosSource(null);
        setCart([]);
        // GMX_POS_RESET_AFTER_ORDER_PAYMENT_R5J
        resetPosClientAfterSale();        await Promise.all([loadOrders(''), loadInventory(branchId)]);
        return;
      }

      if (posSource?.type === 'RETURN') {
        setCheckoutModalOpen(false);
        openReturnFlow(posSource.order);
        setMessage(`Devolución ${posSource.id}: artículos cargados. Continúa con la autorización de devolución.`);
        return;
      }

      const salePayload = {
        branchId,
        clientId,
        paymentMethod,
        paymentReference: sanitizePaymentReference(paymentReference),
        payments: payments.map((row, index) => ({
          method: index === 0 ? paymentMethod : row.method,
          amount: Number(sanitizeMoneyInput(row.amount) || 0),
          cashReceived: (index === 0 ? paymentMethod : row.method) === 'EFECTIVO' ? Number(sanitizeMoneyInput(row.cashReceived) || 0) : null,
          reference: index === 0 ? paymentMethod === 'EFECTIVO' ? '' : sanitizePaymentReference(paymentReference) : sanitizePaymentReference(row.reference),
          // GMX_POS_CARD_PROVIDER_R1
          provider: (index === 0 ? paymentMethod : row.method) === 'TARJETA' ? `BANK=;BRAND=;TYPE=` : ''
        })),
        notes,
        promoCode,
        pointsToRedeem,
        manualDiscountType: Number(manualDiscountValue || 0) > 0 ? manualDiscountType : '',
        manualDiscountValue: Number(manualDiscountValue || 0),
        manualDiscountReason: Number(manualDiscountValue || 0) > 0 ? manualDiscountReason.trim() : '',
        manualDiscountPin: Number(manualDiscountValue || 0) > 0 ? String(manualDiscountPin || '').trim() : '',
        items: cart.map((item) => ({
          itemType: item.item_type,
          itemId: item.item_id,
          productId: item.product_id || '',
          inventoryId: item.inventory_id || '',
          quantity: item.quantity
        }))
      };

      const fingerprint = JSON.stringify(salePayload);
      const requestKey = saleAttempt.key && saleAttempt.fingerprint === fingerprint ?
      saleAttempt.key :
      `POSREQ-${Date.now()}-${globalThis.crypto?.randomUUID?.() || Math.random().toString(16).slice(2)}`;

      if (requestKey !== saleAttempt.key || fingerprint !== saleAttempt.fingerprint) {
        setSaleAttempt({ key: requestKey, fingerprint });
      }

      const body = await api('/api/v1/orders/pos', {
        method: 'POST',
        body: JSON.stringify({ ...salePayload, saleRequestId: requestKey })
      });

      setCheckoutModalOpen(false);
      setMessage(`Venta ${body.data.id_pedido} registrada correctamente.`);
      setCompletedOrder(body.data);
      // GMX_POS_RESET_AFTER_NEW_SALE_R5J
      resetPosClientAfterSale();      setSaleAttempt({ key: '', fingerprint: '' });
      setCart([]);
      setPaymentReference('');
      setPayments([{ method: 'EFECTIVO', amount: 0, cashReceived: 0, reference: '' }]);
      setNotes('');
      setPromoCode('');
      setPointsToRedeem(0);
      setBenefitPreview(null);
      setManualDiscountType('PORCENTAJE');
      setManualDiscountValue(0);
      setManualDiscountReason('');setManualDiscountPin('');

      await Promise.all([
      loadInventory(branchId),
      loadOrders('')]
      );
    } catch (error) {
      setMessage(error.message);
    }
  }

  // DEV-004B — la devolución permanece dentro del POS.
  async function openReturnFlow(order) {
    if (!order?.id_pedido) return;

    setReturnFlow({
      open: true, stage: 'auth', order, password: '',
      authorizationToken: '', authorizationId: '', authorizer: null, items: [],
      reason: '', refund: false, refundMethod: 'EFECTIVO', refundReference: '',
      notes: '', reintegrateStock: true, busy: true, error: ''
    });

    try {
      const auth = await api('/api/v1/commercial/returns/authorize-current', {
        method: 'POST',
        body: JSON.stringify({ orderId: order.id_pedido })
      });

      const data = auth?.data || {};
      const authorizationToken = String(
        data.authorizationToken || data.token || data.returnAuthorizationToken || ''
      ).trim();

      if (!authorizationToken) {
        throw new Error('RETURN_AUTHORIZATION_REQUIRED');
      }

      const detail = await api(`/api/v1/commercial/returns-order/${encodeURIComponent(order.id_pedido)}`);
      const detailData = detail?.data || detail;
      const items = normalizeReturnItems(detailData);

      if (!items.length) {
        throw new Error('El pedido no tiene artículos disponibles para devolución.');
      }

      setReturnFlow((current) => ({
        ...current,
        open: true,
        stage: 'return',
        order,
        password: '',
        authorizationToken,
        authorizationId: data.authorizationId || data.id_autorizacion || '',
        authorizer: data.authorizedBy || data.autorizador || null,
        items,
        busy: false,
        error: ''
      }));
    } catch (error) {
      const code = String(error?.message || error?.error || '').trim().toUpperCase();

      if (
        code.includes('RETURN_AUTHORIZATION_REQUIRED') ||
        code.includes('RETURN_AUTHORIZATION_FORBIDDEN')
      ) {
        setReturnFlow((current) => ({
          ...current,
          open: true,
          stage: 'auth',
          order,
          password: '',
          authorizationToken: '',
          authorizationId: '',
          authorizer: null,
          items: [],
          busy: false,
          error: ''
        }));
        return;
      }

      setReturnFlow((current) => ({
        ...current,
        open: true,
        stage: 'auth',
        order,
        busy: false,
        error: getReturnAuthorizationMessage(error)
      }));
    }
  }

  function closeReturnFlow() {
    if (returnFlow.busy) return;
    setReturnFlow((current) => ({ ...current, open: false, password: '', authorizationToken: '', error: '' }));
  }

  function normalizeReturnItems(data) {
    const source = Array.isArray(data?.detalles) ? data.detalles :
    Array.isArray(data?.items) ? data.items :
    Array.isArray(data?.details) ? data.details : [];
    return source.map((item, index) => {
      const sold = Math.max(0, Number(item.cantidad_vendida ?? item.cantidad ?? item.quantity ?? 0));
      const returned = Math.max(0, Number(item.devuelto ?? item.cantidad_devuelta ?? item.returnedQuantity ?? 0));
      return {
        ...item,
        _key: item.row_id || item.id_detalle_pedido || item.idDetallePedido || `${index}`,
        _detailId: item.id_detalle_pedido || item.idDetallePedido || item.id_detalle || '',
        _available: Math.max(0, sold - returned),
        _quantity: 0,
        _condition: item.condicion_articulo || item.condition || 'VENDIBLE',
        _destination: item.destino_articulo || item.destination || 'INVENTARIO_DISPONIBLE',
        _reintegrate: item.reintegra_stock !== false
      };
    }).filter((item) => item._available > 0);
  }

  function getReturnAuthorizationMessage(error) {
    const code = String(
      error?.code ||
      error?.error ||
      error?.data?.error ||
      error?.response?.data?.error ||
      error?.response?.data?.code ||
      error?.message ||
      ''
    ).trim().toUpperCase();

    const messages = {
      RETURN_AUTHORIZATION_REQUIRED: 'Esta devolución requiere autorización de un administrador.',
      RETURN_PIN_INVALID_FORMAT: 'El código debe contener exactamente 4 dígitos.',
      RETURN_PIN_INVALID_OR_EXPIRED: 'El código es incorrecto, venció o ya fue reemplazado.',
      RETURN_PIN_ALREADY_USED: 'Este código ya fue utilizado. Solicita uno nuevo.',
      RETURN_AUTHORIZATION_ALREADY_USED: 'Esta autorización ya fue utilizada. Solicita un código nuevo.',
      RETURN_AUTHORIZATION_FORBIDDEN: 'La cuenta que generó el código ya no tiene permiso para autorizar devoluciones.',
      RETURN_AUTHORIZATION_BRANCH_FORBIDDEN: 'El código no tiene autorización para la sucursal de este pedido.',
      RETURN_AUTHORIZATION_INVALID_OR_EXPIRED: 'La autorización venció o ya fue utilizada.',
      ORDER_NOT_FOUND: 'No se encontró el pedido.'
    };

    if (messages[code]) return messages[code];

    const raw = String(error?.message || error?.response?.data?.message || '').trim();
    return messages[String(raw).toUpperCase()] || raw || 'No fue posible autorizar la devolución.';
  }

  async function authorizeReturnInPOS() {
    const orderId = String(returnFlow.order?.id_pedido || '').trim();
    const pin = String(returnFlow.password || '').replace(/\D/g, '').slice(0, 4);

    if (!orderId) {
      setReturnFlow((current) => ({ ...current, error: 'No se encontró el pedido.' }));
      return;
    }

    if (!/^\d{4}$/.test(pin)) {
      setReturnFlow((current) => ({ ...current, error: 'Captura el código de autorización de 4 dígitos.' }));
      return;
    }

    setReturnFlow((current) => ({ ...current, busy: true, error: '' }));

    try {
      const auth = await api('/api/v1/commercial/returns/pin/authorize', {
        method: 'POST',
        body: JSON.stringify({ orderId, pin })
      });

      const data = auth?.data || {};
      const authorizationToken = String(
        data.authorizationToken || data.token || data.returnAuthorizationToken || ''
      ).trim();

      if (!authorizationToken) {
        throw new Error('La autorización fue aprobada pero no se recibió el token de operación.');
      }

      const detail = await api(`/api/v1/commercial/returns-order/${encodeURIComponent(orderId)}`);
      const detailData = detail?.data || detail;
      const items = normalizeReturnItems(detailData);

      if (!items.length) {
        throw new Error('El pedido no tiene artículos disponibles para devolución.');
      }

      setReturnFlow((current) => ({
        ...current,
        stage: 'return',
        password: '',
        authorizationToken,
        authorizationId: data.authorizationId || data.id_autorizacion || '',
        authorizer: data.authorizedBy || data.autorizador || null,
        items,
        busy: false,
        error: ''
      }));
    } catch (error) {
      setReturnFlow((current) => ({
        ...current,
        busy: false,
        password: '',
        error: getReturnAuthorizationMessage(error)
      }));
    }
  }

  function setReturnItemQuantity(key, value) {
    setReturnFlow((current) => ({ ...current, items: current.items.map((item) => {
        if (item._key !== key) return item;
        return { ...item, _quantity: Math.min(item._available, Math.max(0, Math.trunc(Number(value) || 0))) };
      }) }));
  }

  async function submitReturnInPOS() {
    const selected = returnFlow.items.filter((item) => Number(item._quantity || 0) > 0);
    if (!selected.length) {setReturnFlow((current) => ({ ...current, error: 'Selecciona al menos un artículo para devolver.' }));return;}
    if (!String(returnFlow.reason || '').trim()) {setReturnFlow((current) => ({ ...current, error: 'Indica el motivo de la devolución.' }));return;}

    setReturnFlow((current) => ({ ...current, busy: true, error: '' }));
    try {
      const payload = {
        reference: String(returnFlow.order?.id_pedido || ''),
        customerName: returnFlow.order?.nombre_cliente || 'Público general',
        reason: String(returnFlow.reason || '').trim(),
        refund: Boolean(returnFlow.refund),
        refundMethod: returnFlow.refund ? returnFlow.refundMethod : '',
        refundReference: returnFlow.refund ? sanitizePaymentReference(returnFlow.refundReference) : '',
        notes: String(returnFlow.notes || '').trim(),
        reintegrateStock: Boolean(returnFlow.reintegrateStock),
        items: selected.map((item) => ({
          detailId: item._detailId,
          quantity: Number(item._quantity || 0),
          condition: item._condition,
          destination: item._destination,
          reintegrateStock: Boolean(returnFlow.reintegrateStock && item._reintegrate),
          productId: item.id_producto || item.product_id || '',
          inventoryId: item.id_inventario || item.inventory_id || ''
        })),
        authorizationToken: returnFlow.authorizationToken
      };
      const body = await api('/api/v1/commercial/returns/sale', { method: 'POST', body: JSON.stringify(payload) });
      const returnId = body?.data?.id || body?.data?.id_devolucion || 'devolución';
      const amount = body?.data?.importe;
      setReturnFlow({
        open: false, stage: 'auth', order: null, password: '', authorizationToken: '',
        authorizationId: '', authorizer: null, items: [], reason: '', refund: false,
        refundMethod: 'EFECTIVO', refundReference: '', notes: '', reintegrateStock: true,
        busy: false, error: ''
      });
      setMessage(`Devolución ${returnId} completada${amount !== undefined ? ` · ${money(amount)}` : ''}.`);
      await Promise.all([loadOrders(orderSearch), searchOrdersForPOS(orderLookupSearch).catch(() => {})]);
    } catch (error) {
      setReturnFlow((current) => ({ ...current, busy: false, error: error.message || 'No fue posible completar la devolución.' }));
    }
  }

  function openPayOrder(order) {
    setPayOrder(order);
    setPayMethod('EFECTIVO');
    setPayReference('');
    setPayNotes('');
  }

  async function confirmPendingOrderPayment() {
    if (!payOrder) return;
    setPayBusy(true);
    try {
      const body = await api(`/api/v1/orders/${payOrder.row_id}/pay`, {
        method: 'POST',
        body: JSON.stringify({
          paymentMethod: payMethod,
          paymentReference: payReference,
          notes: payNotes
        })
      });

      setMessage(`Pedido ${body.data.id_pedido} pagado correctamente.`);
      setCompletedOrder(body.data);
      setPayOrder(null);
      setPayReference('');
      setPayNotes('');

      await Promise.all([
      loadOrders(orderSearch),
      loadInventory(branchId)]
      );

      if (selectedOrder?.row_id === body.data.row_id) {
        setSelectedOrder(body.data);
      }
    } catch (error) {
      setMessage(error.message);
    } finally {
      setPayBusy(false);
    }
  }

  function receiptHtml(order) {
    const moneyLocal = (v) => Number(v || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const details = Array.isArray(order?.detalles) ? order.detalles : [];
    const paymentRows = Array.isArray(order?.pagos) ? order.pagos : [];
    const discounts = Number(order?.descuento_promocion || 0) + Number(order?.descuento_puntos || 0);
    const rows = details.map((x) => `<tr><td><b>${esc(x.producto || 'Artículo')}</b>${x.sku ? `<small>${esc(x.sku)}</small>` : ''}${String(x.tipo || '').toUpperCase() === 'TCG' && x.detalle ? `<small>${esc(x.detalle)}</small>` : ''}</td><td class="center">${Number(x.cantidad || 0)}</td><td class="right">${moneyLocal(x.precio_unitario || x.precio)}</td><td class="right"><b>${moneyLocal(x.subtotal)}</b></td></tr>`).join('');
    return brandText(`<!doctype html><html><head><meta charset="utf-8"><title>GMX · ${esc(order?.id_pedido || 'Comprobante')}</title><style>
      *{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#111;margin:0;padding:18px}.ticket{max-width:760px;margin:auto}.brand{text-align:center}.brand h1{margin:0;font-size:24px}.muted{color:#666;font-size:12px}
      .meta{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:16px 0;padding:10px;border:1px solid #ddd;border-radius:8px}table{width:100%;border-collapse:collapse}th,td{padding:8px 5px;border-bottom:1px solid #ddd;font-size:12px;text-align:left}th{font-size:10px;text-transform:uppercase}.center{text-align:center}.right{text-align:right}small{display:block;color:#666;margin-top:2px}
      .totals{margin:16px 0 0 auto;max-width:300px}.totals div{display:flex;justify-content:space-between;padding:4px 0}.total{font-size:20px;border-top:2px solid #111;margin-top:4px;padding-top:9px!important}.pay{margin-top:16px;padding:10px;border:1px solid #ddd;border-radius:8px}.thanks{text-align:center;margin-top:20px;font-size:11px;color:#666}@media print{body{padding:0}.ticket{max-width:none}}@page{margin:10mm}
      </style></head><body><div class="ticket"><div class="brand"><h1>GMX</h1><div>Ticket / comprobante de venta</div><div class="muted">${esc(order?.id_pedido || '')}</div></div>
      <div class="meta"><div><b>Fecha</b><br>${order?.fecha ? new Date(order.fecha).toLocaleString('es-MX') : '—'}</div><div><b>Sucursal</b><br>${esc(order?.sucursal || '—')}</div><div><b>Cliente</b><br>${esc(order?.nombre_cliente || 'Público general')}</div><div><b>Estado</b><br>${esc(order?.estado_pedido || '')}</div></div>
      <table><thead><tr><th>Artículo</th><th class="center">Cant.</th><th class="right">Precio</th><th class="right">Importe</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="totals"><div><span>Subtotal</span><b>${moneyLocal(order?.subtotal)}</b></div>${discounts > 0 ? `<div><span>Descuentos</span><b>-${moneyLocal(discounts)}</b></div>` : ''}<div class="total"><b>Total</b><b>${moneyLocal(order?.total)}</b></div></div>
      <div class="pay"><b>Método de pago:</b> ${esc(order?.metodo_pago || '')}${order?.referencia_pago ? `<br><b>Referencia:</b> ${esc(order.referencia_pago)}` : ''}</div><div class="thanks">Gracias por tu compra.</div></div></body></html>`);
  }

  function printReceipt(order, { pdf = false } = {}) {
    const win = window.open('', '_blank', 'width=900,height=760');
    if (!win) {setMessage(brandText("El navegador bloqueó la ventana del comprobante. Permite ventanas emergentes para GMX."));return;}
    win.document.open();win.document.write(receiptHtml(order));win.document.close();win.focus();
    setTimeout(() => {if (pdf) setMessage('En el diálogo de impresión selecciona “Guardar como PDF”.');win.print();}, 250);
  }

  async function getFullOrder(rowId) {
    const body = await api(`/api/v1/orders/${rowId}`);
    return body.data;
  }

  async function printOrderFromHistory(rowId, options = {}) {
    try {printReceipt(await getFullOrder(rowId), options);} catch (error) {setMessage(error.message);}
  }

  async function emailReceipt(order) {
    if (!order?.email) {setMessage('El cliente no tiene un correo registrado.');return;}
    setReceiptBusy(true);
    try {
      const body = await api(`/api/v1/orders/${order.row_id}/receipt/email`, { method: 'POST', body: '{}' });
      setMessage(`Comprobante enviado correctamente a ${body.data.to}.`);
    } catch (error) {setMessage(error.message);} finally
    {setReceiptBusy(false);}
  }

  async function openOrder(rowId) {
    try {
      const body = await api(`/api/v1/orders/${rowId}`);
      setSelectedOrder(body.data);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function cancelOrder(order, reason) {
    if (!confirm(`¿Cancelar ${order.id_pedido} y devolver el stock?`)) return;

    try {
      const body = await api(`/api/v1/orders/${order.row_id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      });

      setSelectedOrder(body.data);
      setMessage(`Venta ${order.id_pedido} cancelada y stock restituido.`);

      await Promise.all([
      loadInventory(branchId),
      loadOrders(orderSearch)]
      );
    } catch (error) {
      setMessage(error.message);
    }
  }

  const orderMetrics = orders.reduce((result, order) => {
    const state = String(order.estado_pedido || order.estado || '').toUpperCase();
    if (state === 'PAGADO') result.paid += 1;
    else if (state === 'PENDIENTE') result.pending += 1;
    else if (state.includes('CANCEL') || state.includes('REEMB')) result.cancelled += 1;
    result.total += Number(order.total || 0);
    const branch = order.sucursal || order.id_sucursal || 'Sin sucursal';
    result.branches[branch] = (result.branches[branch] || 0) + Number(order.total || 0);
    return result;
  }, { paid: 0, pending: 0, cancelled: 0, total: 0, branches: {} });
  const orderUi = useMemo(() => {
    const normalize = (order) => String(order.estado_devolucion || order.estado_pedido || order.estado || '').toUpperCase();
    const pending = (s) => s.includes('PENDIENTE');
    const cancelled = (s) => s.includes('CANCEL') || s.includes('REEMB') || s.includes('DEVUELTO');
    const completed = (s) => s === 'PAGADO' || s.includes('COMPLET');
    const process = (s) => !pending(s) && !cancelled(s) && !completed(s);

    const filtered = orders.filter((order) => {
      const state = normalize(order);
      if (orderStatusFilter === 'PENDING') return pending(state);
      if (orderStatusFilter === 'PROCESS') return process(state);
      if (orderStatusFilter === 'COMPLETED') return completed(state);
      if (orderStatusFilter === 'CANCELLED') return cancelled(state);
      return true;
    });

    const todayKey = new Date().toLocaleDateString('en-CA');
    const today = orders.filter((order) => order.fecha && new Date(order.fecha).toLocaleDateString('en-CA') === todayKey);
    const todaySales = today.reduce((sum, order) => sum + Number(order.total || 0), 0);

    const counts = {
      all: orders.length,
      pending: orders.filter(o => pending(normalize(o))).length,
      process: orders.filter(o => process(normalize(o))).length,
      completed: orders.filter(o => completed(normalize(o))).length,
      cancelled: orders.filter(o => cancelled(normalize(o))).length
    };

    const pageCount = Math.max(1, Math.ceil(filtered.length / orderPageSize));
    const safePage = Math.min(orderPage, pageCount);
    const start = (safePage - 1) * orderPageSize;

    return {
      filtered,
      paged: filtered.slice(start, start + orderPageSize),
      pageCount,
      safePage,
      start,
      counts,
      todayCount: today.length,
      todaySales,
      todayAverage: today.length ? todaySales / today.length : 0,
      recent: [...orders].sort((a,b) => new Date(b.fecha || 0) - new Date(a.fecha || 0)).slice(0,5)
    };
  }, [orders, orderStatusFilter, orderPage, orderPageSize]);

  useEffect(() => { setOrderPage(1); }, [orderStatusFilter, orderPageSize]);

  function orderUiStatus(order) {
    const state = String(order.estado_devolucion || order.estado_pedido || order.estado || '').toUpperCase();
    if (state.includes('CANCEL') || state.includes('REEMB') || state.includes('DEVUELTO')) return ['cancelled','Cancelado'];
    if (state === 'PAGADO' || state.includes('COMPLET')) return ['completed','Completado'];
    if (state.includes('PENDIENTE')) return ['pending','Pendiente'];
    return ['process','En proceso'];
  }

  return (
    <div className={`pos-stack r23-view r23-orders ${isOperator ? 'operator-pos-page' : ''}`}>
      {forcedMode === 'pos' && isOperator && !posStandalone && !posKioskMode && !posFullscreen && !posSessionStarted && fullscreenCapable ? <div className="tcg_store_template-pos-fullscreen-gate" role="dialog" aria-modal="true" aria-label="Iniciar punto de venta">
        <div className="tcg_store_template-pos-fullscreen-card">
          <div className="tcg_store_template-pos-fullscreen-logo">{`${posBrandName} POS`}</div>
          <h2>Iniciar Punto de Venta</h2>
          <p>{brandText("GMX necesita una confirmación del operador para activar la pantalla completa del navegador.")}</p>
          <button type="button" onClick={enterPosFullscreen}>⛶ Iniciar POS</button>
          <small>{brandText("Desktop: Ctrl + Alt + X abre la salida protegida sin abandonar pantalla completa. Tablet/móvil: mantén presionado GMX POS durante 5 segundos. La salida requiere contraseña.")}</small>
        </div>
      </div> : null}
      {forcedMode === 'pos' && isOperator && posExitOpen ? <div
        className="tcg_store_template-pos-exit-lock"
        role="dialog"
        aria-modal="true"
        aria-label="Â¿Salir del punto de venta? del punto de venta"
        style={{
          position:'fixed',
          inset:0,
          zIndex:2147483000,
          display:'grid',
          placeItems:'center',
          padding:'24px',
          background:'rgba(4,10,22,.72)',
          backdropFilter:'blur(8px)',
          WebkitBackdropFilter:'blur(8px)'
        }}
      >
        <form
          className="tcg_store_template-pos-exit-card"
          onSubmit={authorizeProtectedPosExit}
          style={{
            width:'min(520px,calc(100vw - 32px))',
            maxHeight:'calc(100vh - 48px)',
            overflow:'auto',
            display:'grid',
            gap:'16px',
            margin:0,
            padding:'28px',
            border:'1px solid #d9e1ec',
            borderRadius:'20px',
            background:'#fff',
            color:'#172033',
            boxShadow:'0 30px 90px rgba(2,8,23,.36)'
          }}
        >
          <div className="tcg_store_template-pos-exit-shield">{`${posBrandName} POS`}</div>
          <h2>¿Salir del punto de venta?</h2>
          <p>Ingresa tu contraseña para cerrar la sesión.</p>
<label>Contraseña<input type="password" autoFocus autoComplete="current-password" value={posExitPassword} onChange={(e) => setPosExitPassword(e.target.value)} disabled={posExitBusy} />
          </label>
          {posExitError ? <div className="tcg_store_template-pos-exit-error">{posExitError}</div> : null}
          <div className="tcg_store_template-pos-exit-actions">
            <button type="button" className="secondary" onClick={cancelProtectedPosExit} disabled={posExitBusy}>Continuar en POS</button>
            <button type="submit" className="danger" disabled={posExitBusy || !posExitPassword}>Salir de sesión</button>
          </div>
</form>
      </div> : null}
      <section className={`content-card ${forcedMode === 'pos' ? 'tcg_store_template-pos-host' : ''}`}>
        {forcedMode === 'pos' ? <div className="section-head">
          <div>
            <div className="eyebrow">VENTAS · POS LOCAL</div>
            <h2>Punto de venta</h2>
          </div>
        </div> : null}

        {message ? <div className="message">{message}</div> : null}
        {completedOrder ? <div className="pos-sale-completed">
          <div><span className="eyebrow">VENTA COMPLETADA</span><strong>{completedOrder.id_pedido}</strong><small>{completedOrder.nombre_cliente || 'Público general'} · {money(completedOrder.total)}</small></div>
          <div className="pos-receipt-actions">
            <button type="button" className="secondary" onClick={() => printReceipt(completedOrder)}>Imprimir ticket</button>
            <button type="button" className="secondary" onClick={() => printReceipt(completedOrder, { pdf: true })}>Guardar PDF</button>
            <button type="button" disabled={receiptBusy || !completedOrder.email} title={!completedOrder.email ? 'Cliente sin correo registrado' : 'Enviar comprobante'} onClick={() => emailReceipt(completedOrder)}>{receiptBusy ? 'Enviando...' : 'Enviar comprobante por correo'}</button>
            <button type="button" className="ghost" onClick={() => setCompletedOrder(null)}>Cerrar</button>
          </div>
        </div> : null}



        {tab === 'pos' ?
        <div className="tcg_store_template-pos-terminal">
            {posSource ? <div className={`shiny-r75-pos-source ${posSource.type === 'RETURN' ? 'return' : 'order'}`}>
              <div className="shiny-r75-pos-source-icon">{posSource.type === 'RETURN' ? '↩' : '▤'}</div>
              <div><span>{posSource.type === 'RETURN' ? 'DEVOLUCIÓN CARGADA' : 'PEDIDO CARGADO'}</span><strong>{posSource.id}</strong><small>{posSource.order?.nombre_cliente || 'Público general'} · {(posSource.order?.detalles || []).length} partida(s) · {money(posSource.order?.total)}</small></div>
              <button type="button" onClick={()=>{setPosSource(null);setCart([]);window.history.replaceState({},'', '/admin/pos');}}>×</button>
            </div> : null}
            <div className="tcg_store_template-pos-topline">
              <div className="tcg_store_template-pos-brand tcg_store_template-pos-brand-protected" title={isOperator ? 'Mantén presionado 5 segundos para solicitar salida' : undefined} onPointerDown={isOperator ? startPosLongPress : undefined} onPointerUp={isOperator ? clearPosLongPress : undefined} onPointerCancel={isOperator ? clearPosLongPress : undefined} onPointerLeave={isOperator ? clearPosLongPress : undefined}>{posBrandName}</div>
              <div className="tcg_store_template-pos-topmeta">
                <span>Caja local</span>
                {isOperator ?
              <div className="tcg_store_template-pos-session-meta"><span>Sucursal</span><strong>{branches.find((b) => b.id_sucursal === branchId)?.nombre_sucursal || 'Sin sucursal asignada'}</strong></div> :
              <label className="tcg_store_template-pos-branch-inline">
                    <span>Sucursal</span>
                    <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                      <option value="">Selecciona</option>
                      {branches.map((branch) => <option key={branch.row_id} value={branch.id_sucursal}>{branch.nombre_sucursal}</option>)}
                    </select>
                  </label>}
                <div className="tcg_store_template-pos-session-meta"><span>Operador</span><strong>{currentUser?.nombre || currentUser?.email || 'Usuario'}</strong></div>
              </div>
            </div>

            <div className="tcg_store_template-pos-workspace">
              <main className="tcg_store_template-pos-left">
                <div className="tcg_store_template-pos-searchbar shiny-r78-universal-searchbar">
                  <div className={`tcg_store_template-pos-search-input-wrap shiny-r78-universal-search ${scanMode ? 'scan-active' : ''}`}>
                    <span className="tcg_store_template-pos-search-icon">⌕</span>
                    <input
                      ref={scanInputRef}
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        e.preventDefault();
                        resolveUniversalPosSearch(productSearch);
                      }}
                      placeholder="Buscar por SKU, nombre, carta, código, pedido, DEV, pedimento, folio o referencia…"
                      autoComplete="off" />
                    <button type="button" className="shiny-r78-search-camera" title="Cámara / QR" aria-label="Abrir cámara o QR" onClick={openCameraScanner}>⌗</button>
                    <VisionScannerModal
                      open={visionOpen}
                      title="Reconocer producto o carta"
                      onClose={() => setVisionOpen(false)}
                      onResult={handleVisionPosResult} />
                    <VisionInternetResultsModal
                      open={visionInternetOpen}
                      loading={visionInternetBusy}
                      items={visionInternetCandidates}
                      queryText={visionInternetQuery}
                      error={visionInternetError}
                      onClose={() => setVisionInternetOpen(false)}
                      onPick={(item) => {
                        setVisionInternetOpen(false);
                        setMessage(`Carta externa seleccionada: ${item.name}${item.setCode ? ` - ${item.setCode}` : ''}. Aun no se ha agregado al inventario.`);
                      }} />
                  </div>
                </div>

                <section className="tcg_store_template-pos-items-panel">
                  <div className="tcg_store_template-pos-panel-title">
                    <strong>ARTÍCULOS <span className="shiny-r78-count-badge">{cart.length}</span></strong>
                  </div>

                  <div className="tcg_store_template-pos-cart-table-wrap">
                    <table className="tcg_store_template-pos-cart-table">
                      <thead>
                        <tr><th>#</th><th>Artículo</th><th>Precio</th><th>Cant.</th><th>Subtotal</th><th></th></tr>
                      </thead>
                      <tbody>
                        {cart.map((item, index) => <tr key={item.key}>
                          <td>{index + 1}</td>
                          <td>
                            <div className="tcg_store_template-pos-cart-product">
                              <div className="tcg_store_template-pos-cart-thumb">{item.image_url ? <img src={item.image_url} alt="" /> : <span>{item.item_type === 'TCG' ? 'TCG' : brandText("GMX")}</span>}</div>
                              <div><strong>{item.name}</strong><small>{item.sku || item.item_id || ''}</small></div>
                            </div>
                          </td>
                          <td>{money(item.price)}</td>
                          <td>
                            <div className="tcg_store_template-pos-qty">
                              <button type="button" onClick={() => changeQuantity(item.key, Math.max(1, Number(item.quantity || 1) - 1))}>−</button>
                              <input type="number" min="1" max={item.stock} value={item.quantity} onChange={(e) => changeQuantity(item.key, e.target.value)} />
                              <button type="button" onClick={() => changeQuantity(item.key, Math.min(Number(item.stock || 9999), Number(item.quantity || 1) + 1))}>+</button>
                            </div>
                          </td>
                          <td><strong>{money(Number(item.price || 0) * Number(item.quantity || 0))}</strong></td>
                          <td><button type="button" className="tcg_store_template-pos-trash" onClick={() => removeFromCart(item.key)}>×</button></td>
                        </tr>)}
                        {Number(benefitPreview?.discountPromo || 0) > 0 ? <tr className="tcg_store_template-pos-adjustment-row promo"><td>🏷</td><td><strong>Promoción {promoCode || ''}</strong><small>Beneficio aplicado</small></td><td></td><td></td><td><strong>-{money(benefitPreview.discountPromo)}</strong></td><td><button type="button" className="tcg_store_template-pos-trash" onClick={() => {setPromoCode('');setBenefitPreview(null);}}>×</button></td></tr> : null}
                        {manualDiscountAmount > 0 ? <tr className="tcg_store_template-pos-adjustment-row manual"><td>🔒</td><td><strong>Descuento manual · {manualDiscountType === 'PORCENTAJE' ? `${manualDiscountValue}%` : money(manualDiscountValue)}</strong><small>{manualDiscountReason || 'Autorizado'}</small></td><td></td><td></td><td><strong>-{money(manualDiscountAmount)}</strong></td><td><button type="button" className="tcg_store_template-pos-trash" onClick={() => {setManualDiscountValue(0);setManualDiscountReason('');}}>×</button></td></tr> : null}
                      </tbody>
                    </table>
                    {!cart.length ? <div className="tcg_store_template-pos-empty shiny-r78-cart-empty">
                      <span className="shiny-r78-empty-cart-icon">⌑</span>
                      <strong>Carrito vacío</strong>
                      <span>Busca y agrega artículos para comenzar.</span>
                    </div> : null}
                  </div>

                  <div className="tcg_store_template-pos-items-footer">
                    <span>{cart.reduce((n, x) => n + Number(x.quantity || 0), 0)} artículo(s)</span>
                    <strong>{money(total)}</strong>
                  </div>
                  <div className="tcg_store_template-pos-duebar">
                    <strong>Por pagar: {money(saleTotal)}</strong>
                    <button type="button" className="secondary" disabled={!cart.length} onClick={() => {setCart([]);setBenefitPreview(null);}}>Vaciar</button>
                  </div>
                </section>
              </main>

              <aside className="tcg_store_template-pos-right">
                <section className="tcg_store_template-pos-side-card tcg_store_template-pos-summary-card tcg_store_template-pos-summary-v2">
                  <div className="tcg_store_template-pos-summary-head"><div className="tcg_store_template-pos-side-title">RESUMEN DE VENTA</div><span>{cart.reduce((n, x) => n + Number(x.quantity || 0), 0)} artículo(s)</span></div>
                  <div className="tcg_store_template-pos-summary-row"><span>Subtotal</span><strong>{money(total)}</strong></div>
                  {Number(benefitPreview?.discountPromo || 0) > 0 ? <div className="tcg_store_template-pos-summary-row discount"><span>Promociones</span><strong>-{money(Number(benefitPreview.discountPromo || 0))}</strong></div> : null}
                  {Number(benefitPreview?.loyaltyDiscount || 0) > 0 ? <div className="tcg_store_template-pos-summary-row discount"><span>Puntos</span><strong>-{money(Number(benefitPreview.loyaltyDiscount || 0))}</strong></div> : null}
                  {manualDiscountAmount > 0 ? <div className="tcg_store_template-pos-summary-row discount"><span>Descuento manual</span><strong>-{money(manualDiscountAmount)}</strong></div> : null}
                  <div className="tcg_store_template-pos-summary-total"><span>TOTAL</span><strong>{money(saleTotal)}</strong></div>
                  {Math.max(0, Number(total || 0) - Number(saleTotal || 0)) > 0 ? <div className="tcg_store_template-pos-savings"><span>🏷 Ahorro total</span><strong>-{money(Math.max(0, Number(total || 0) - Number(saleTotal || 0)))}</strong></div> : null}
                </section>

                <section className="shiny-r78-pos-hero-card">
                  {(storefrontRuntime?.zones?.HOME_HERO || []).length
                    ? <StoreSlideshow slides={storefrontRuntime.zones.HOME_HERO || []} settings={storefrontRuntime.settings || {}} variant="hero" />
                    : <div className="shiny-r78-pos-hero-fallback">
                        <span>{posBrandName} · BENEFICIOS</span>
                        <strong>Promociones de temporada</strong>
                        <p>El slideshow de la tienda aparecerá aquí cuando exista un Hero publicado.</p>
                      </div>}
                </section>
              </aside>
            </div>                                    <div className="tcg_store_template-pos-actions shiny-r78-pos-actions">
              <button type="button" className="tcg_store_template-pos-action" onClick={() => {setCatalogBranchId(branchId);setProductSearch('');setCatalogOpen(true);}}><span className="shiny-r78-action-icon">◇</span>Catálogo / Existencias</button>
              <button type="button" className="tcg_store_template-pos-action" onClick={() => {setClientSearch('');setClientSearchOpen(false);setClientModalOpen(true);}}><span className="shiny-r78-action-icon">◉</span>{clientId ? 'Cliente seleccionado' : 'Cliente'}</button>
              <button type="button" className="tcg_store_template-pos-action" disabled={!canUseManualDiscount} onClick={() => setDiscountModalOpen(true)}><span className="shiny-r78-action-icon">%</span>Descuento</button>
              <button type="button" className="tcg_store_template-pos-action" onClick={() => setPromoModalOpen(true)}><span className="shiny-r78-action-icon">◇</span>Promoción</button>
              <button type="button" className="tcg_store_template-pos-action" onClick={() => setNotesModalOpen(true)}><span className="shiny-r78-action-icon">▢</span>Observaciones</button>
              <button type="button" className="tcg_store_template-pos-action shiny-r78-return-action" onClick={openReturnLauncher}><span className="shiny-r78-action-icon">↩</span>Devoluciones</button>
              <button className="tcg_store_template-pos-charge" type="button" onClick={checkout} disabled={!cart.length || Boolean(manualDiscountError)}>
                <span>COBRAR</span><strong>{money(saleTotal)}</strong>
              </button>
            </div>

            {returnLauncherOpen ? <div className="modal-backdrop shiny-r78-return-launcher-backdrop" onMouseDown={() => setReturnLauncherOpen(false)}>
              <div className="modal shiny-r78-return-launcher" onMouseDown={(e) => e.stopPropagation()}>
                <div className="modal-head">
                  <div><div className="eyebrow">DEVOLUCIONES · POS</div><h2>¿Qué deseas devolver?</h2><p>Selecciona el origen de la operación.</p></div>
                  <button className="icon-btn" type="button" onClick={() => setReturnLauncherOpen(false)}>×</button>
                </div>
                <div className="shiny-r78-return-choice-grid">
                  <button type="button" onClick={startSaleReturnLookup}>
                    <span>↩</span><strong>Devolución de venta</strong><small>Productos vendidos desde POS o pedidos.</small>
                  </button>
                  <button type="button" className="disabled-choice" disabled title="El backend actual no tiene flujo de devolución a proveedor/compra.">
                    <span>▦</span><strong>Devolución de compra</strong><small>Recepción / proveedor · pendiente de flujo backend.</small>
                  </button>
                </div>
                <div className="shiny-r78-return-launcher-note">Las devoluciones de venta solicitarán el código de autorización de 4 dígitos únicamente cuando el perfil actual no tenga privilegios para autorizar.</div>
              </div>
            </div> : null}

            {checkoutModalOpen ? <div className="modal-backdrop tcg_store_template-pos-checkout-backdrop" onMouseDown={() => setCheckoutModalOpen(false)}><div className="modal tcg_store_template-pos-checkout-modal" onMouseDown={(e) => e.stopPropagation()} onKeyDownCapture={blockInvalidMoneyKey} onPasteCapture={blockInvalidMoneyPaste}>
              <div className="modal-head"><div><div className="eyebrow">COBRO</div><h2>Cobrar {money(saleTotal)}</h2><p>Selecciona cómo pagará el cliente.</p></div><button className="icon-btn" type="button" onClick={() => setCheckoutModalOpen(false)}>×</button></div>
              <div className="tcg_store_template-pos-pay-methods">
                {[['EFECTIVO', '💵', 'Efectivo'], ['TRANSFERENCIA', '🏦', 'Transferencia'], ['TARJETA', '💳', 'Tarjeta']].map(([value, icon, label]) => <button key={value} type="button" className={paymentMethod === value ? 'selected' : ''} onClick={() => {setPaymentMethod(value);setPayments((current) => current.length ? [{ ...current[0], method: value }, ...current.slice(1)] : [{ method: value, amount: 0, cashReceived: 0, reference: '' }]);}}><span>{icon}</span><strong>{label}</strong></button>)}
              </div>
              <div className="tcg_store_template-pos-checkout-help">Para dividir el pago, usa <b>+ Agregar método</b>. Si no, captura solamente el método principal.</div>
              <MixedPaymentsPanel total={saleTotal} primaryMethod={paymentMethod} payments={payments} setPayments={setPaymentsSafe} />
              {paymentMethod !== 'EFECTIVO' ? <label className="tcg_store_template-pos-primary-reference">Referencia / folio<input value={paymentReference} onChange={(e) => setPaymentReference(sanitizePaymentReference(e.target.value))} placeholder={paymentMethod === 'TRANSFERENCIA' ? 'Referencia bancaria' : 'Referencia'} /></label> : null}
              {paymentMethod === 'TARJETA' ? (
                <div className="gmx-pos-card-manual-r1" style={{display:'grid',gap:'10px',marginTop:'10px'}}>
                  <div style={{display:'grid',gridTemplateColumns:'1.25fr 1fr 1fr',gap:'10px'}}>
                    <label>Banco emisor
                      <select value={cardBank} onChange={(e) => setCardBank(e.target.value)}>
                        <option value="">Selecciona banco</option>
                        {GMX_POS_BANKS.map(([code,name]) => <option key={code} value={code}>{name}</option>)}
                      </select>
                    </label>
                    <label>Marca / red
                      <select value={cardBrand} onChange={(e) => setCardBrand(e.target.value)}>
                        <option value="">Selecciona tarjeta</option>
                        {GMX_POS_CARD_BRANDS.map(([code,name]) => <option key={code} value={code}>{name}</option>)}
                      </select>
                    </label>
                    <label>Tipo
                      <select value={cardType} onChange={(e) => setCardType(e.target.value)}>
                        <option value="">Selecciona tipo</option>
                        {GMX_POS_CARD_TYPES.map(([code,name]) => <option key={code} value={code}>{name}</option>)}
                      </select>
                    </label>
                  </div>
                  <div className="tcg_store_template-pos-card-warning">
                    El cobro se realiza en la terminal bancaria externa. GMX registra banco, marca, tipo y referencia / folio.
                  </div>
                </div>
              ) : null}
              <div className="tcg_store_template-pos-checkout-actions"><button type="button" className="secondary" onClick={() => setCheckoutModalOpen(false)}>Volver</button><button type="button" className="tcg_store_template-pos-confirm-charge" onClick={performCheckout}>CONFIRMAR COBRO · {money(saleTotal)}</button></div>
            </div></div> : null}

            {/* GMX_MEMBERSHIP_CLIENT_REQUIRED_POPUP_R5S4 */}
            {membershipClientRequiredOpen ? <div className="modal-backdrop" onMouseDown={() => setMembershipClientRequiredOpen(false)}>
              <div className="modal tcg_store_template-pos-action-modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
                <div className="modal-head">
                  <div>
                    <div className="eyebrow">MEMBRESIA</div>
                    <h2>Favor de asignar un cliente</h2>
                    <p>La membres&iacute;a debe quedar asociada a un cliente registrado en GMX.</p>
                  </div>
                  <button className="icon-btn" type="button" onClick={() => setMembershipClientRequiredOpen(false)}>X</button>
                </div>
                <div className="tcg_store_template-pos-checkout-help">
                  Selecciona un cliente para continuar. Las ventas normales pueden cobrarse como P&uacute;blico general.
                </div>
                <div className="tcg_store_template-pos-modal-actions">
                  <button type="button" className="secondary" onClick={() => setMembershipClientRequiredOpen(false)}>Cancelar</button>
                  <button type="button" onClick={() => {setMembershipClientRequiredOpen(false);setClientSearch('');setClientSearchOpen(false);loadClients('').catch((error) => setMessage(error.message));setClientModalOpen(true);}}>Seleccionar cliente</button>
                </div>
              </div>
            </div> : null}
            {clientModalOpen ? <div className="modal-backdrop" onMouseDown={() => setClientModalOpen(false)}><div className="modal tcg_store_template-pos-client-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="modal-head"><div><div className="eyebrow">CLIENTE</div><h2>Seleccionar cliente</h2></div><button className="icon-btn" type="button" onClick={() => setClientModalOpen(false)}>×</button></div>
              <div className="tcg_store_template-pos-client-search"><input autoFocus value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} placeholder="Buscar por nombre, teléfono, email o ID..." /></div>
              <div className="tcg_store_template-pos-client-list">
              {/* GMX_POS_ALL_CLIENTS_CAPTION_R5C */}
              <div className="tcg_store_template-pos-empty" style={{paddingTop:0}}>
                {clientLoading ? 'Cargando clientes...' : `${clients.length} clientes disponibles`}
              </div>
                {/* GMX_POS_PUBLIC_GENERAL_R5M */}
                <button type="button" className={`tcg_store_template-pos-client-row ${!clientId ? 'selected' : ''}`} onClick={() => {setClientId('');setClientSearch('');setSelectedPosClient(null);setLoyalty(null);setPointsToRedeem(0);setClientModalOpen(false);}}><strong>Publico general</strong><span>Venta sin cliente asociado</span></button>
                {clientLoading ? <div className="tcg_store_template-pos-empty">Buscando clientes…</div> : null}
                {!clientLoading && clients.map((client) => <button type="button" className={`tcg_store_template-pos-client-row ${clientId === client.id_cliente ? 'selected' : ''}`} key={client.row_id} onClick={() => {setClientId(client.id_cliente);setClientSearch(client.nombre || client.email || client.telefono || client.id_cliente);setClientModalOpen(false);}}>
                  <strong>{client.nombre || client.id_cliente}</strong><span>{[client.telefono, client.email, client.id_cliente].filter(Boolean).join(' · ')}</span>
                </button>)}
                {!clientLoading && !clients.length ? <div className="tcg_store_template-pos-empty">No hay clientes que coincidan.</div> : null}
              </div>
            </div></div> : null}

            {discountModalOpen ? <div className="modal-backdrop" onMouseDown={() => setDiscountModalOpen(false)}><div className="modal tcg_store_template-pos-action-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="modal-head"><div><div className="eyebrow">DESCUENTO MANUAL</div><h2>Aplicar descuento</h2></div><button className="icon-btn" type="button" onClick={() => setDiscountModalOpen(false)}>×</button></div>
              <div className="tcg_store_template-pos-modal-grid"><label>Tipo<select value={manualDiscountType} onChange={(e) => setManualDiscountType(e.target.value)}><option value="PORCENTAJE">Porcentaje (%)</option><option value="MONTO">Monto ($)</option></select></label><label>{manualDiscountType === 'PORCENTAJE' ? 'Porcentaje' : 'Monto'}<input type="number" onKeyDown={blockInvalidMoneyKey} onPaste={blockInvalidMoneyPaste} min="0" max={manualDiscountType === 'PORCENTAJE' ? '100' : undefined} step="0.01" value={manualDiscountValue} onChange={(e) => setManualDiscountValue(Math.max(0, Number(e.target.value || 0)))} /></label></div>
              <label>Motivo<input value={manualDiscountReason} onChange={(e) => setManualDiscountReason(e.target.value)} placeholder="Motivo obligatorio" /></label>
              <label>Código de autorización<input inputMode="numeric" autoComplete="one-time-code" maxLength={4} value={manualDiscountPin} onChange={(e) => setManualDiscountPin(String(e.target.value || '').replace(/\D/g,'').slice(0,4))} placeholder="4 dígitos" /></label>
              {Number(manualDiscountValue || 0) > 0 ? <div className="benefit-summary"><span>Base <b>{money(totalBeforeManualDiscount)}</b></span><span>Descuento <b>-{money(manualDiscountAmount)}</b></span><strong>Total final {money(saleTotal)}</strong>{manualDiscountError ? <span className="danger-text">{manualDiscountError}</span> : null}</div> : null}
              <div className="tcg_store_template-pos-modal-actions"><button type="button" className="secondary" onClick={() => {setManualDiscountValue(0);setManualDiscountReason('');setManualDiscountPin('');setDiscountModalOpen(false);}}>Quitar descuento</button><button type="button" disabled={Boolean(manualDiscountError) || Number(manualDiscountValue || 0) <= 0} onClick={() => setDiscountModalOpen(false)}>Aplicar</button></div>
            </div></div> : null}

            {promoModalOpen ? <div className="modal-backdrop" onMouseDown={() => setPromoModalOpen(false)}><div className="modal tcg_store_template-pos-action-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="modal-head"><div><div className="eyebrow">PROMOCIÓN</div><h2>Aplicar código promocional</h2></div><button className="icon-btn" type="button" onClick={() => setPromoModalOpen(false)}>×</button></div>
              <label>Código promocional<input autoFocus value={promoCode} onChange={(e) => setPromoCode(e.target.value.toUpperCase())} placeholder="Escanea o captura el código" onKeyDown={async (e) => {if (e.key === 'Enter') {e.preventDefault();try {await previewBenefits({ promo: promoCode, points: pointsToRedeem });setPromoModalOpen(false);} catch {}}}} /></label>
              <p className="muted">También puedes escanear el código directamente en el buscador universal del POS.</p>
              <div className="tcg_store_template-pos-modal-actions"><button type="button" className="secondary" onClick={() => {setPromoCode('');setBenefitPreview(null);setPromoModalOpen(false);}}>Quitar promoción</button><button type="button" onClick={async () => {try {await previewBenefits({ promo: promoCode, points: pointsToRedeem });setPromoModalOpen(false);} catch {}}}>Aplicar promoción</button></div>
            </div></div> : null}

            {notesModalOpen ? <div className="modal-backdrop" onMouseDown={() => setNotesModalOpen(false)}><div className="modal tcg_store_template-pos-action-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="modal-head"><div><div className="eyebrow">OBSERVACIONES</div><h2>Notas de la venta</h2></div><button className="icon-btn" type="button" onClick={() => setNotesModalOpen(false)}>×</button></div>
              <label>Observación<textarea rows="5" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Agrega una observación opcional…" /></label>
              <div className="tcg_store_template-pos-modal-actions"><button type="button" className="secondary" onClick={() => {setNotes('');setNotesModalOpen(false);}}>Limpiar</button><button type="button" onClick={() => setNotesModalOpen(false)}>Guardar observación</button></div>
            </div></div> : null}

            {pointsModalOpen ? <div className="modal-backdrop" onMouseDown={() => setPointsModalOpen(false)}><div className="modal tcg_store_template-pos-action-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="modal-head"><div><div className="eyebrow">PUNTOS DEL CLIENTE</div><h2>¿Deseas canjear puntos?</h2></div><button className="icon-btn" type="button" onClick={() => setPointsModalOpen(false)}>×</button></div>
              <p>Este cliente tiene <strong>{Number(loyalty?.puntos_disponibles || 0)} puntos</strong> disponibles.</p>
              <label>Puntos a canjear<input type="number" onKeyDown={blockInvalidMoneyKey} onPaste={blockInvalidMoneyPaste} min="0" max={Number(loyalty?.puntos_disponibles || 0)} value={pointsToRedeem} onChange={(e) => setPointsToRedeem(Math.min(Number(loyalty?.puntos_disponibles || 0), Math.max(0, Number(e.target.value || 0))))} /></label>
              <div className="tcg_store_template-pos-modal-actions"><button type="button" className="secondary" onClick={() => {setPointsToRedeem(0);setPointsModalOpen(false);setCheckoutModalOpen(true);}}>No usar puntos</button><button type="button" onClick={async () => {try {await previewBenefits({ promo: promoCode, points: pointsToRedeem, silent: true });setPointsModalOpen(false);setCheckoutModalOpen(true);} catch {}}}>Canjear y continuar</button></div>
            </div></div> : null}

            {orderLookupOpen ? <div className="modal-backdrop tcg_store_template-pos-order-backdrop" onMouseDown={() => setOrderLookupOpen(false)}>
              <div className="modal tcg_store_template-pos-order-modal" onMouseDown={(e) => e.stopPropagation()}>
                <div className="modal-head">
                  <div>
                    <div className="eyebrow">{'DEVOLUCIONES · POS'}</div>
                    <h2>Selecciona la venta a devolver</h2>
                    <p>Busca por pedido, cliente, teléfono o email.</p>
                  </div>
                  <button className="icon-btn" type="button" aria-label="Cerrar" onClick={() => setOrderLookupOpen(false)}>X</button>
                </div>

                <form
                className="tcg_store_template-pos-order-search"
                onSubmit={(e) => {
                  e.preventDefault();
                  searchOrdersForPOS(orderLookupSearch);
                }}>
                
                  <input
                  autoFocus
                  value={orderLookupSearch}
                  onChange={(e) => setOrderLookupSearch(e.target.value)}
                  placeholder={'PED-WEB-..., PED-LOCAL-..., cliente, tel\u00e9fono o email'} />
                
                  <button type="submit" disabled={orderLookupBusy}>
                    {orderLookupBusy ? 'Buscando?' : 'Buscar'}
                  </button>
                </form>

                <div className="tcg_store_template-pos-order-results">
                  {!orderLookupBusy && orderLookupResults.length > 0 ?
                <div className="tcg_store_template-pos-order-list-title">
                      {orderLookupSearch.trim() ? 'RESULTADOS' : 'PEDIDOS RECIENTES'}
                    </div> :
                null}

                  {orderLookupBusy ? <div className="tcg_store_template-pos-empty">Buscando pedidos...</div> : null}

                  {!orderLookupBusy && orderLookupResults.map((order) =>
                <article className="tcg_store_template-pos-order-result" key={order.row_id}>
                      <div className="tcg_store_template-pos-order-result-main">
                        <div>
                          <strong>{order.id_pedido}</strong>
                          <span>{order.nombre_cliente || 'P?blico general'}</span>
                        </div>
                        <strong>{money(order.total)}</strong>
                      </div>

                      <div className="tcg_store_template-pos-order-result-meta">
                        <span>{order.sucursal || order.id_sucursal || 'Sin sucursal'}</span>
                        <span>{order.metodo_pago || 'Sin m?todo'}</span>
                        <span>{order.estado_devolucion || order.estado_pedido || 'Sin estado'}</span>
                      </div>

                      <div className="tcg_store_template-pos-order-result-actions">
                        <button
                      type="button"
                      className="secondary compact"
                      onClick={() => {
                        setOrderLookupOpen(false);
                        openOrder(order.row_id);
                      }}>
                      
                          Ver
                        </button>

                        {String(order.estado_pedido || '').toUpperCase() === 'PENDIENTE' ?
                    <button
                      type="button"
                      className="compact"
                      onClick={() => {
                        setOrderLookupOpen(false);
                        openPayOrder(order);
                      }}>
                      
                              Registrar pago
                            </button> :
                    null}

                        {String(order.estado_pedido || '').toUpperCase() === 'PAGADO' ?
                    <button
                      type="button"
                      className="compact"
                      onClick={() => {setOrderLookupOpen(false);openReturnFlow(order);}}>
                      
                              Devolver / Reembolso
                            </button> :
                    null}
                      </div>
                    </article>
                )}

                  {!orderLookupBusy && orderLookupSearch.trim() && orderLookupResults.length === 0 ?
                <div className="tcg_store_template-pos-empty">No se encontraron pedidos.</div> :
                null}
                </div>
              </div>
            </div> : null}

            {cameraOpen ? <div className="modal-backdrop tcg_store_template-pos-camera-backdrop" onMouseDown={() => {stopCamera();setCameraOpen(false);}}>
              <div className="modal tcg_store_template-pos-camera-modal" onMouseDown={(e) => e.stopPropagation()}>
                <div className="modal-head">
                  <div><div className="eyebrow">ESCÁNER POR CÁMARA</div><h2>Código de barras / QR</h2></div>
                  <button className="icon-btn" type="button" onClick={() => {stopCamera();setCameraOpen(false);}}>×</button>
                </div>
                <div className="tcg_store_template-pos-camera-stage">
                  <video ref={cameraVideoRef} playsInline muted />
                  <div className="tcg_store_template-pos-camera-guide"></div>
                </div>
                {cameraError ? <div className="tcg_store_template-pos-camera-error">{cameraError}</div> : <p className="tcg_store_template-pos-camera-help">Coloca el código dentro del recuadro y pulsa Leer código.</p>}
                <div className="tcg_store_template-pos-camera-actions">
                  <button type="button" className="secondary" onClick={() => {stopCamera();setCameraOpen(false);}}>Cancelar</button>
                  <button type="button" onClick={detectFromCamera} disabled={scanBusy || Boolean(cameraError)}>{scanBusy ? 'Leyendo…' : 'Leer código'}</button>
                </div>
              </div>
            </div> : null}

            {catalogOpen ? <div className="modal-backdrop tcg_store_template-pos-catalog-backdrop" onMouseDown={() => setCatalogOpen(false)}>
              <div className="modal tcg_store_template-pos-catalog-modal" onMouseDown={(e) => e.stopPropagation()}>
                <div className="modal-head">
                  <div><div className="eyebrow">CATÁLOGO POS</div><h2>Agregar artículos</h2></div>
                  <button className="icon-btn" type="button" onClick={() => setCatalogOpen(false)}>×</button>
                </div>
                {catalogAddFeedback ? <div className={`tcg_store_template-pos-add-toast ${catalogAddFeedback.blocked ? 'blocked' : ''}`} role="status" aria-live="polite">
                  <strong>{catalogAddFeedback.blocked ? 'Sin existencia disponible' : '✓ Agregado al carrito'}</strong>
                  <span>{catalogAddFeedback.name}{catalogAddFeedback.quantity > 0 ? ` · Cantidad ${catalogAddFeedback.quantity}` : ''}</span>
                </div> : null}
                <div className="tcg_store_template-pos-modal-search"><input autoFocus value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder="Buscar por nombre, SKU, código de barras, carta..." /></div>
                <div className="tcg_store_template-pos-modal-filters">
                  {isOperator ?
                <div className="tcg_store_template-pos-branch-filter tcg_store_template-pos-branch-fixed"><span>Sucursal</span><strong>{branches.find((b) => b.id_sucursal === branchId)?.nombre_sucursal || 'Sin sucursal asignada'}</strong></div> :
                <label className="tcg_store_template-pos-branch-filter">Sucursal
                      <select value={catalogBranchId || branchId} onChange={(e) => setCatalogBranchId(e.target.value)}>
                        {branches.map((branch) => <option key={branch.row_id} value={branch.id_sucursal}>{branch.nombre_sucursal}</option>)}
                      </select>
                    </label>}
                  <div className="pos-sale-type"><div><button type="button" className={saleType === 'ALL' ? 'active' : ''} onClick={() => setSaleType('ALL')}>Todos</button><button type="button" className={saleType === 'TCG' ? 'active' : ''} onClick={() => {setSaleType('TCG');setProductCategory('');}}>Cartas TCG</button><button type="button" className={saleType === 'PRODUCT' ? 'active' : ''} onClick={() => {setSaleType('PRODUCT');setGameId('');setSetId('');}}>Productos</button></div></div>
                  {saleType === 'TCG' || saleType === 'ALL' ? <><label>TCG<select value={gameId} onChange={(e) => setGameId(e.target.value)}><option value="">Todos los TCG</option>{tcgGames.map((g) => <option key={g.id_juego} value={g.id_juego}>{g.nombre}</option>)}</select></label><label>Expansión<select value={setId} disabled={!gameId} onChange={(e) => setSetId(e.target.value)}><option value="">Todas</option>{tcgSets.map((x) => <option key={x.id_set} value={x.id_set}>{x.nombre}</option>)}</select></label></> : null}
                  {saleType === 'PRODUCT' || saleType === 'ALL' ? <label>Categoría<select value={productCategory} onChange={(e) => setProductCategory(e.target.value)}><option value="">Todas</option>{productCategories.map((c) => <option key={c.categoria} value={c.categoria}>{c.categoria} ({c.total})</option>)}</select></label> : null}
                </div>
                <div className="tcg_store_template-pos-modal-count">{catalogLoading ? 'Buscando…' : `${visibleInventory.length} resultado(s)`}</div>
                {!isOperator && catalogBranchId && branchId && catalogBranchId !== branchId ? <div className="tcg_store_template-pos-branch-note">Consulta de existencias en otra sucursal. Para vender, selecciona la sucursal activa del POS.</div> : null}
                <div className="tcg_store_template-pos-modal-grid">
                  {visibleInventory.map((item) => {
                  const key = itemKey(item);
                  const cartRow = cart.find((row) => row.key === key);
                  const qty = Number(cartRow?.quantity || 0);
                  const stock = Math.max(0, Number(item.stock || 0));
                  const exhausted = stock <= qty;
                  const viewingOtherBranch = !isOperator && Boolean(catalogBranchId && branchId && catalogBranchId !== branchId);
                  const fresh = catalogAddFeedback?.key === key && !catalogAddFeedback?.blocked;
                  return <article className={`tcg_store_template-pos-modal-item ${fresh ? 'just-added' : ''} ${qty > 0 ? 'in-cart' : ''}`} key={key}>
                      <div className="tcg_store_template-pos-modal-thumb">{item.image_url ? <img src={item.image_url} alt={item.name} /> : <span>{item.item_type === 'TCG' ? 'TCG' : brandText("GMX")}</span>}</div>
                      <div className="tcg_store_template-pos-modal-main"><small>{item.item_type === 'TCG' ? 'CARTA TCG' : 'PRODUCTO'}</small><strong>{item.name}</strong><span>{[item.sku, item.game_name, item.set_name, item.card_number].filter(Boolean).join(' · ')}</span><em>Existencia {item.stock ?? 0}{qty > 0 ? ` · En carrito ${qty}` : ''}</em></div>
                      <strong className="tcg_store_template-pos-modal-price">{money(item.price)}</strong>
                      <button
                      type="button"
                      className={fresh ? 'added' : ''}
                      disabled={exhausted || viewingOtherBranch}
                      onClick={() => addToCart(item)}>
                      {viewingOtherBranch ? 'Consulta otra sucursal' : exhausted ? `✓ En carrito: ${qty} · Agotado` : qty > 0 ? `✓ Cantidad: ${qty}` : '+ Agregar'}</button>
                    </article>;
                })}
                  {!catalogLoading && !visibleInventory.length ? <div className="tcg_store_template-pos-empty">No hay artículos disponibles con estos filtros.</div> : null}
                </div>
              </div>
            </div> : null}
          </div> :
        null}
        {forcedMode === 'orders' ? <div className="shiny-orders-r61">

          <div className="shiny-orders-pagehead">
            <span>VENTAS</span>
            <h2>Pedidos</h2>
            <p>Gestión de pedidos y ventas</p>
          </div>

          <div className="shiny-orders-shell">
            <div className="shiny-orders-darkhead">
              <strong>PEDIDOS</strong>
              <div>
                <label><span>Sucursal</span>
                  <select value={branchId} onChange={(e)=>setBranchId(e.target.value)}>
                    <option value="">Todas</option>
                    {branches.map(branch=><option key={branch.row_id} value={branch.id_sucursal}>{branch.nombre_sucursal}</option>)}
                  </select>
                </label>
                <span>Operador</span>
                <b>{currentUser?.nombre || currentUser?.email || 'Administrador Principal'}</b>
              </div>
            </div>

            <div className="shiny-orders-body">
              <div className="shiny-orders-toolbar">
                <form onSubmit={(e)=>{e.preventDefault();loadOrders(orderSearch).catch(error=>setMessage(error.message));}}>
                  <span>⌕</span>
                  <input value={orderSearch} onChange={(e)=>setOrderSearch(e.target.value)} placeholder="Buscar pedido por folio, cliente, estatus..." />
                </form>

                <button type="button" className={orderStatusFilter==='ALL'?'flt all active':'flt all'} onClick={()=>setOrderStatusFilter('ALL')}>☷ Todos los pedidos</button>
                <button type="button" className={orderStatusFilter==='PENDING'?'flt pending active':'flt pending'} onClick={()=>setOrderStatusFilter('PENDING')}>◷ Pendientes</button>
                <button type="button" className={orderStatusFilter==='PROCESS'?'flt process active':'flt process'} onClick={()=>setOrderStatusFilter('PROCESS')}>↻ En proceso</button>
                <button type="button" className={orderStatusFilter==='COMPLETED'?'flt completed active':'flt completed'} onClick={()=>setOrderStatusFilter('COMPLETED')}>✓ Completados</button>
                <button type="button" className={orderStatusFilter==='CANCELLED'?'flt cancelled active':'flt cancelled'} onClick={()=>setOrderStatusFilter('CANCELLED')}>× Cancelados</button>
                <button type="button" className="new-order" onClick={()=>window.location.assign('/admin/pos')}>＋ Nuevo pedido</button>
              </div>

              <div className="shiny-orders-layout">
                <main>
                  <div className="shiny-orders-kpis">
                    <article><i className="blue">▤</i><div><span>Todos los pedidos</span><strong>{orderUi.counts.all}</strong><small>Total</small></div></article>
                    <article><i className="amber">◷</i><div><span>Pendientes</span><strong>{orderUi.counts.pending}</strong><small>{orderUi.counts.all ? Math.round(orderUi.counts.pending/orderUi.counts.all*100) : 0}% del total</small></div></article>
                    <article><i className="blue">↻</i><div><span>En proceso</span><strong>{orderUi.counts.process}</strong><small>{orderUi.counts.all ? Math.round(orderUi.counts.process/orderUi.counts.all*100) : 0}% del total</small></div></article>
                    <article><i className="green">✓</i><div><span>Completados</span><strong>{orderUi.counts.completed}</strong><small>{orderUi.counts.all ? Math.round(orderUi.counts.completed/orderUi.counts.all*100) : 0}% del total</small></div></article>
                    <article><i className="red">×</i><div><span>Cancelados</span><strong>{orderUi.counts.cancelled}</strong><small>{orderUi.counts.all ? Math.round(orderUi.counts.cancelled/orderUi.counts.all*100) : 0}% del total</small></div></article>
                  </div>

                  <section className="shiny-orders-list">
                    <div className="shiny-orders-listtitle">Listado de pedidos ({orderUi.filtered.length})</div>
                    <div className="shiny-orders-tablewrap">
                      <table>
                        <thead><tr><th>Folio</th><th>Fecha</th><th>Cliente</th><th>Total</th><th>Estatus</th><th>Operador</th><th>Acciones</th></tr></thead>
                        <tbody>
                          {orderUi.paged.map(order=>{
                            const [cls,label]=orderUiStatus(order);
                            return <tr key={order.row_id}>
                              <td><strong>{order.id_pedido}</strong></td>
                              <td>{order.fecha?new Date(order.fecha).toLocaleString('es-MX'):'—'}</td>
                              <td>{order.nombre_cliente||'Público general'}</td>
                              <td><strong>{money(order.total)}</strong></td>
                              <td><span className={`shiny-order-status ${cls}`}>{label}</span></td>
                              <td>{order.nombre_usuario||order.operador||order.usuario||currentUser?.nombre||'—'}</td>
                              <td><div className="shiny-order-actions">
                                <button type="button" onClick={()=>openOrder(order.row_id)}>Ver</button>
                                {String(order.estado_pedido||'').toUpperCase()==='PENDIENTE' ?
                                  <button type="button" className="pay" onClick={()=>{
                                    try{localStorage.setItem('SHINY_POS_PENDING_ORDER',String(order.id_pedido||''));}catch{}
                                    window.location.assign(`/admin/pos?order=${encodeURIComponent(order.id_pedido||'')}`);
                                  }}>Cobrar en POS</button>:null}
                              </div></td>
                            </tr>
                          })}
                          {!orderUi.paged.length?<tr><td colSpan="7"><div className="shiny-orders-empty">
                            <span>▤</span>
                            <strong>No hay pedidos registrados</strong>
                            <p>Los pedidos que registres aparecerán aquí.</p>
                            <button type="button" onClick={()=>window.location.assign('/admin/pos')}>＋ Crear nuevo pedido</button>
                          </div></td></tr>:null}
                        </tbody>
                      </table>
                    </div>

                    <footer className="shiny-orders-pagination">
                      <span>Mostrando {orderUi.filtered.length ? orderUi.start+1 : 0} a {Math.min(orderUi.start+orderPageSize,orderUi.filtered.length)} de {orderUi.filtered.length} pedidos</span>
                      <div>
                        <button type="button" disabled={orderUi.safePage<=1} onClick={()=>setOrderPage(p=>Math.max(1,p-1))}>‹</button>
                        <button type="button" className="active">{orderUi.safePage}</button>
                        <button type="button" disabled={orderUi.safePage>=orderUi.pageCount} onClick={()=>setOrderPage(p=>Math.min(orderUi.pageCount,p+1))}>›</button>
                        <select value={orderPageSize} onChange={(e)=>setOrderPageSize(Number(e.target.value))}>
                          <option value="10">10 / página</option>
                          <option value="20">20 / página</option>
                          <option value="50">50 / página</option>
                        </select>
                      </div>
                    </footer>
                  </section>
                </main>

                <aside className="shiny-orders-side">
                  <section>
                    <h3>RESUMEN</h3>
                    <div><span>Pedidos hoy</span><b>{orderUi.todayCount}</b></div>
                    <div><span>Ventas hoy</span><b>{money(orderUi.todaySales)}</b></div>
                    <div><span>Ticket promedio</span><b>{money(orderUi.todayAverage)}</b></div>
                    <hr/>
                    <small>TOTAL VENTAS HOY</small>
                    <strong className="today-total">{money(orderUi.todaySales)}</strong>
                  </section>

                  <section className="recent">
                    <h3>▧ PEDIDOS RECIENTES</h3>
                    {orderUi.recent.length ? <div className="recent-list">
                      {orderUi.recent.map(order=><button type="button" key={order.row_id} onClick={()=>openOrder(order.row_id)}>
                        <div><strong>{order.id_pedido}</strong><small>{order.nombre_cliente||'Público general'}</small></div>
                        <span>{money(order.total)}</span>
                      </button>)}
                    </div>:<div className="recent-empty"><span>▱</span><strong>No hay pedidos recientes</strong><p>Los últimos pedidos aparecerán aquí.</p></div>}
                    <button type="button" className="view-all" onClick={()=>setOrderStatusFilter('ALL')}>Ver todos los pedidos ›</button>
                  </section>

                  <section>
                    <h3>INFORMACIÓN</h3>
                    <div><span>Sucursal</span><b>{branches.find(b=>b.id_sucursal===branchId)?.nombre_sucursal||'Todas'}</b></div>
                    <div><span>Operador</span><b>{currentUser?.nombre||currentUser?.email||'Administrador Principal'}</b></div>
                    <div><span>Fecha</span><b>{new Date().toLocaleString('es-MX')}</b></div>
                    <div><span>Estado</span><b className="system-ok">● Sistema operativo</b></div>
                  </section>
                </aside>
              </div>
            </div>
          </div>
        </div> : null}

      </section>

      {returnFlow.open ? <div className="modal-backdrop tcg_store_template-pos-return-backdrop" onMouseDown={closeReturnFlow}>
        <div className="modal tcg_store_template-pos-return-modal tcg_store_template-pos-return-dialog" onMouseDown={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <div><div className="eyebrow">DEVOLUCIÓN · POS</div><h2>{returnFlow.stage === 'auth' ? 'Autorización administrativa' : 'Procesar devolución'}</h2><p className="section-copy">{returnFlow.order?.id_pedido || 'Pedido'}</p></div>
            <button className="icon-btn" type="button" disabled={returnFlow.busy} onClick={closeReturnFlow}>×</button>
          </div>
          {returnFlow.error ? <div className="tcg_store_template-pos-return-error" role="alert">{returnFlow.error}</div> : null}

          {returnFlow.stage === 'auth' ? <div className="tcg_store_template-pos-return-auth shiny-r77-pin-auth">
            <div className="tcg_store_template-pos-return-security"><strong>Autorización requerida</strong><span>Solicita a un administrador autorizado un código temporal de 4 dígitos. El código es de un solo uso y vence en 5 minutos.</span></div>
            <div className="tcg_store_template-pos-return-order-summary">
              <div><span>Pedido</span><strong>{returnFlow.order?.id_pedido}</strong></div>
              <div><span>Cliente</span><strong>{returnFlow.order?.nombre_cliente || 'Público general'}</strong></div>
              <div><span>Sucursal</span><strong>{returnFlow.order?.sucursal || returnFlow.order?.id_sucursal || '—'}</strong></div>
              <div><span>Total</span><strong>{money(returnFlow.order?.total)}</strong></div>
            </div>
            <div className="tcg_store_template-pos-return-fields tcg_store_template-pos-return-auth-fields">
              <label className="tcg_store_template-pos-return-password-label shiny-r77-pin-label">Código de autorización
                <input className="tcg_store_template-pos-return-password-input shiny-r77-pin-input" type="text" inputMode="numeric" pattern="[0-9]*" maxLength="4" autoFocus autoComplete="one-time-code" value={returnFlow.password} onChange={(e) => setReturnFlow((c) => ({ ...c, password: e.target.value.replace(/\D/g, '').slice(0, 4), error: '' }))} onKeyDown={(e) => {if (e.key === 'Enter' && !returnFlow.busy) authorizeReturnInPOS();}} placeholder="••••" disabled={returnFlow.busy} />
              </label>
            </div>
            <div className="tcg_store_template-pos-return-actions"><button type="button" className="secondary" disabled={returnFlow.busy} onClick={closeReturnFlow}>Cancelar</button><button type="button" disabled={returnFlow.busy} onClick={authorizeReturnInPOS}>{returnFlow.busy ? 'Validando código…' : 'Autorizar devolución'}</button></div>
          </div> : <div className="tcg_store_template-pos-return-editor">
            <div className="tcg_store_template-pos-return-authorized"><span>✓ Autorización aprobada</span><strong>{returnFlow.authorizer?.nombre || returnFlow.authorizer?.email || 'Administrador autorizado'}</strong>{returnFlow.authorizationId ? <small>{returnFlow.authorizationId}</small> : null}</div>
            <div className="tcg_store_template-pos-return-items">
              <div className="tcg_store_template-pos-return-items-head"><span>Artículo</span><span>Disponible</span><span>Devolver</span><span>Importe</span></div>
              {returnFlow.items.map((item) => {
                const qty = Number(item._quantity || 0),price = Number(item.precio_unitario || item.precio || 0);
                return <div className="tcg_store_template-pos-return-item" key={item._key}>
                  <div><strong>{item.producto || item.name || 'Artículo'}</strong><small>{item.sku || item.id_producto || ''}</small></div>
                  <span>{item._available}</span>
                  <input type="number" min="0" max={item._available} step="1" value={qty} onChange={(e) => setReturnItemQuantity(item._key, e.target.value)} onKeyDown={(e) => ['e', 'E', '+', '-'].includes(e.key) && e.preventDefault()} />
                  <strong>{money(price * qty)}</strong>
                </div>;
              })}
            </div>
            <div className="tcg_store_template-pos-return-form">
              <label className="tcg_store_template-pos-return-field-label">Motivo<select className="tcg_store_template-pos-return-select" value={returnFlow.reason} onChange={(e) => setReturnFlow((c) => ({ ...c, reason: e.target.value, error: '' }))} disabled={returnFlow.busy}>
                <option value="">Seleccionar motivo</option><option value="PRODUCTO_DEFECTUOSO">Producto defectuoso</option><option value="PRODUCTO_INCORRECTO">Producto incorrecto</option><option value="CAMBIO_DE_OPINION">Cambio de opinión</option><option value="ERROR_EN_VENTA">Error en venta</option><option value="OTRO">Otro</option>
              </select></label>
              <label className="tcg_store_template-pos-return-check"><input type="checkbox" checked={returnFlow.reintegrateStock} onChange={() => {}} hidden /><span role="checkbox" aria-checked={returnFlow.reintegrateStock} tabIndex="0" className={returnFlow.reintegrateStock ? 'checked' : ''} onClick={() => setReturnFlow((c) => ({ ...c, reintegrateStock: !c.reintegrateStock }))}>✓</span><div><strong>Reintegrar al inventario</strong><small>Los artículos vendibles regresarán a existencia.</small></div></label>
              <label className="tcg_store_template-pos-return-refund-toggle"><span>Reembolso al cliente</span><input type="checkbox" checked={returnFlow.refund} onChange={(e) => setReturnFlow((c) => ({ ...c, refund: e.target.checked, error: '' }))} disabled={returnFlow.busy} /></label>
              {returnFlow.refund ? <div className="tcg_store_template-pos-return-refund-grid">
                <label className="tcg_store_template-pos-return-field-label">Método de reembolso<select className="tcg_store_template-pos-return-select" value={returnFlow.refundMethod} onChange={(e) => setReturnFlow((c) => ({ ...c, refundMethod: e.target.value, error: '' }))}><option value="EFECTIVO">Efectivo</option><option value="TARJETA">Tarjeta</option><option value="TRANSFERENCIA">Transferencia</option><option value="OTRO">Otro</option></select></label>
                <label className="tcg_store_template-pos-return-field-label">Referencia<input className="tcg_store_template-pos-return-text-input" value={returnFlow.refundReference} onChange={(e) => setReturnFlow((c) => ({ ...c, refundReference: e.target.value }))} placeholder="Referencia opcional" /></label>
              </div> : null}
              <label className="tcg_store_template-pos-return-field-label">Notas<textarea className="tcg_store_template-pos-return-textarea" rows="2" value={returnFlow.notes} onChange={(e) => setReturnFlow((c) => ({ ...c, notes: e.target.value }))} placeholder="Observaciones de la devolución (opcional)" disabled={returnFlow.busy} /></label>
            </div>
            <div className="tcg_store_template-pos-return-summary"><span>Total a devolver</span><strong>{money(returnFlow.items.reduce((sum, item) => sum + Number(item.precio_unitario || item.precio || 0) * Number(item._quantity || 0), 0))}</strong></div>
            <div className="tcg_store_template-pos-return-actions"><button type="button" className="secondary" disabled={returnFlow.busy} onClick={closeReturnFlow}>Cancelar</button><button type="button" disabled={returnFlow.busy} onClick={submitReturnInPOS}>{returnFlow.busy ? 'Procesando devolución…' : 'Confirmar devolución'}</button></div>
          </div>}
        </div>
      </div> : null}

      {payOrder ? <div className="modal-backdrop" onMouseDown={() => !payBusy && setPayOrder(null)}>
        <div className="modal pos-payment-modal" onMouseDown={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <div>
              <div className="eyebrow">PEDIDO PENDIENTE · COBRO</div>
              <h2>Registrar pago</h2>
              <p className="section-copy">{payOrder.id_pedido}</p>
            </div>
            <button className="icon-btn" disabled={payBusy} onClick={() => setPayOrder(null)}>×</button>
          </div>

          <div className="pos-payment-order-summary">
            <div><span>Cliente</span><strong>{payOrder.nombre_cliente || 'Público general'}</strong></div>
            <div><span>Sucursal</span><strong>{payOrder.sucursal || payOrder.id_sucursal || '—'}</strong></div>
            <div><span>Total a cobrar</span><strong>{money(payOrder.total)}</strong></div>
          </div>

          <div className="pos-payment-fields">
            <label>Método de pago
              <select value={payMethod} onChange={(e) => {setPayMethod(e.target.value);setPayReference('');}}>
                <option value="EFECTIVO">Efectivo</option>
                <option value="TARJETA">Tarjeta</option>
                <option value="TRANSFERENCIA">Transferencia</option>
                <option value="OTRO">Otro</option>
              </select>
            </label>

            {payMethod !== 'EFECTIVO' ? <label>Referencia / autorización
              <input value={payReference} onChange={(e) => setPayReference(e.target.value)} placeholder={payMethod === 'TARJETA' ? 'Folio o autorización' : payMethod === 'TRANSFERENCIA' ? 'Referencia bancaria' : 'Referencia opcional'} />
            </label> : null}

            <label className="span-2">Notas
              <textarea rows="2" value={payNotes} onChange={(e) => setPayNotes(e.target.value)} placeholder="Observaciones del cobro (opcional)" />
            </label>
          </div>

          <div className="pos-payment-warning">{brandText("\n            Al confirmar, GMX volverá a validar el stock, descontará el inventario y cambiará el pedido a PAGADO.\n          ")}

          </div>

          <div className="modal-actions">
            <button className="secondary" disabled={payBusy} onClick={() => setPayOrder(null)}>Cancelar</button>
            <button disabled={payBusy} onClick={confirmPendingOrderPayment}>
              {payBusy ? 'Registrando pago...' : `Cobrar ${money(payOrder.total)}`}
            </button>
          </div>
        </div>
      </div> : null}

      <OrderDetailModal
        open={Boolean(selectedOrder)}
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
        onCancel={cancelOrder} />
      
    </div>);

}
