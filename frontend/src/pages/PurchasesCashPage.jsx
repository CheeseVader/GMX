import { brandText } from "../config/brand.js";import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router';
import { api } from '../services/api.js';
import { R23DualBars, r23DayKey } from '../components/VisualKitR23.jsx';
import '../phase_shiny_exact_views_r23.css';


import '../cash_arqueo_option_b_r56.css';
import '../purchase_reception_flow_r72.css';
const money = (v) => Number(v || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const fiscalLabel = { FACTURADA: 'Facturada', PENDIENTE_FACTURA: 'Factura pendiente', NO_FACTURADA: 'No facturada', SIN_COMPROBANTE: 'Sin comprobante' };
const emptyPurchaseDocument = () => ({ fiscalStatus: 'PENDIENTE_FACTURA', documentType: 'REMISION', reference: '', uuid: '', documentDate: '', currency: 'MXN', paymentMethod: 'TRANSFERENCIA', documentTotal: '', ieps: 0, retentions: 0, otherCharges: 0, notes: '', documentName: '', documentMime: '', documentBase64: '', xmlName: '', xmlText: '' });

export default function PurchasesCashPage() {
  const location = useLocation();
  const routeTab = location.pathname.endsWith('/caja') ? 'caja' : 'compras';
  const [tab, setTab] = useState(routeTab),[branches, setBranches] = useState([]),[products, setProducts] = useState([]),[suppliers, setSuppliers] = useState([]),[purchases, setPurchases] = useState([]);
  const [branchId, setBranchId] = useState(''),[supplierId, setSupplierId] = useState(''),[items, setItems] = useState([]),[message, setMessage] = useState('');
  const [productSearch, setProductSearch] = useState(''),[newProduct, setNewProduct] = useState(false);
  const [tcgInventory, setTcgInventory] = useState([]),[catalogType, setCatalogType] = useState('TODOS'),[catalogOpen, setCatalogOpen] = useState(false);
  const [purchaseView, setPurchaseView] = useState('info');
  const [purchaseWizardOpen, setPurchaseWizardOpen] = useState(false);
  const [purchaseHistoryPage, setPurchaseHistoryPage] = useState(1);
  const [doc, setDoc] = useState(emptyPurchaseDocument);
  const [fiscalPurchase, setFiscalPurchase] = useState(null),[fiscalEdit, setFiscalEdit] = useState(null),[fiscalSaving, setFiscalSaving] = useState(false);
  const [receiveConfirm, setReceiveConfirm] = useState(null),[receiveSaving, setReceiveSaving] = useState(false);
  const [openCash, setOpenCash] = useState(null),[movements, setMovements] = useState([]),[sessions, setSessions] = useState([]),[openingFund, setOpeningFund] = useState(0),[movement, setMovement] = useState({ type: 'INGRESO', category: 'MANUAL', paymentMethod: 'EFECTIVO', amount: '', description: '' }),[counted, setCounted] = useState('');
  const [cashView, setCashView] = useState('cash');
  const [cashCloseNote, setCashCloseNote] = useState('');

  async function loadBase() {
    const [b, p, t, s, c] = await Promise.all([
    api('/api/v1/branches?includeInactive=false'),
    api('/api/v1/products?limit=1000'),
    api('/api/v1/tcg/inventory?limit=1000'),
    api('/api/v1/purchases/suppliers'),
    api('/api/v1/purchases?limit=200')]
    );
    setBranches(b.data || []);setProducts(p.data || []);setTcgInventory(t.data || []);setSuppliers(s.data || []);setPurchases(c.data || []);
    if (!branchId && b.data?.[0]) setBranchId(b.data[0].id_sucursal);if (!supplierId && s.data?.[0]) setSupplierId(s.data[0].id_proveedor);
  }
  async function loadCash(id = branchId) {
    if (!id) return;
    const [o, m, s] = await Promise.all([
      api(`/api/v1/cash/open/${encodeURIComponent(id)}`),
      api(`/api/v1/cash/movements?branchId=${encodeURIComponent(id)}&limit=300`),
      api(`/api/v1/cash/sessions?branchId=${encodeURIComponent(id)}&limit=100`)
    ]);
    setOpenCash(o?.data ?? null);
    setMovements(Array.isArray(m?.data) ? m.data : []);
    setSessions(Array.isArray(s?.data) ? s.data : []);
    setCounted('');
  }
  useEffect(() => {loadBase().catch((e) => setMessage(e.message));}, []);
  useEffect(() => setTab(routeTab), [routeTab]);
  useEffect(() => {
    if (tab !== 'caja' || !branchId) return;
    loadCash(branchId).catch((e) => setMessage(e.message));
  }, [tab, branchId]);

  const subtotal = useMemo(() => items.reduce((a, x) => a + Number(x.quantity || 0) * Number(x.unitCost || 0), 0), [items]);
  const discounts = useMemo(() => items.reduce((a, x) => a + Number(x.discount || 0), 0), [items]);
  const iva = useMemo(() => items.reduce((a, x) => {const base = Math.max(0, Number(x.quantity || 0) * Number(x.unitCost || 0) - Number(x.discount || 0));const rate = x.taxType === 'IVA16' ? .16 : x.taxType === 'IVA8' ? .08 : 0;return a + base * rate;}, 0), [items]);
  const total = Number(subtotal) - Number(discounts) + Number(iva) + Number(doc.ieps || 0) - Number(doc.retentions || 0) + Number(doc.otherCharges || 0);
  const diff = doc.documentTotal === '' ? null : total - Number(doc.documentTotal || 0);
  const receptionUnits = useMemo(() => items.reduce((sum, item) => sum + Number(item.quantity || 0), 0), [items]);
  const informationReady = Boolean(supplierId && branchId);
  const documentationAttached = Boolean(doc.xmlName || doc.xmlText || doc.documentName || doc.documentBase64);
  const documentationReady = doc.fiscalStatus === 'FACTURADA' ? documentationAttached : doc.fiscalStatus !== 'PENDIENTE_FACTURA' || documentationAttached;
  const receiveBlocker = !informationReady ? 'Completa proveedor y sucursal.' : !items.length ? 'Agrega al menos un artículo.' : doc.fiscalStatus === 'FACTURADA' && !documentationAttached ? 'Falta adjuntar documentación fiscal.' : '';
  const purchaseCatalog = useMemo(() => {
    const productRows = products.map((p) => ({
      key: `PRODUCT:${p.id}`, kind: 'PRODUCT', id: p.id, name: p.nombre || 'Producto',
      sku: p.sku || '', category: p.categoria || '', barcode: p.codigo_barras || '',
      cost: Number(p.costo || 0), price: Number(p.precio || 0), stock: Number(p.stock || 0),
      meta: [p.sku, p.categoria, p.codigo_barras].filter(Boolean).join(' · '),
      search: [p.nombre, p.sku, p.id, p.codigo_barras, p.categoria].filter(Boolean).join(' ').toLowerCase()
    }));

    const tcgRows = tcgInventory.map((v) => ({
      key: `TCG:${v.id_inventario}`, kind: 'TCG', id: v.id_inventario, inventoryId: v.id_inventario,
      cardId: v.id_carta, name: v.carta || 'Carta TCG', sku: v.sku || '',
      cost: Number(v.costo || 0), price: Number(Number(v.precio_oferta || 0) > 0 ? v.precio_oferta : v.precio || 0),
      stock: Number(v.stock || 0),
      rarity: v.rareza || '', condition: v.condicion || '', language: v.idioma || '', finish: v.acabado || '', edition: v.edicion || '',
      meta: [v.numero_completo, v.rareza ? `(${v.rareza})` : '', v.condicion, v.idioma, v.acabado, v.edicion].filter(Boolean).join(' · '),
      search: [v.carta, v.numero_completo, v.sku, v.id_inventario, v.rareza, v.condicion, v.idioma, v.acabado, v.edicion].filter(Boolean).join(' ').toLowerCase()
    }));

    return [...productRows, ...tcgRows].sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'));
  }, [products, tcgInventory]);

  const shownProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    return purchaseCatalog.
    filter((x) => catalogType === 'TODOS' || x.kind === catalogType).
    filter((x) => !q || x.search.includes(q)).
    slice(0, 60);
  }, [purchaseCatalog, productSearch, catalogType]);

  function addProduct(p) {
    if (items.some((x) => x.catalogKey === p.key)) return setMessage('Ese artículo ya está agregado a la compra.');
    setItems((a) => [...a, {
      catalogKey: p.key, itemType: p.kind, productId: p.kind === 'PRODUCT' ? p.id : '',
      inventoryId: p.kind === 'TCG' ? p.inventoryId : '', cardId: p.kind === 'TCG' ? p.cardId : '',
      name: p.name, sku: p.sku || '', variantMeta: p.meta || '', quantity: 1,
      unitCost: Number(p.cost || 0), discount: 0, taxType: 'IVA16'
    }]);
    setProductSearch('');
    setCatalogOpen(false);
  }
  function addNewProduct(x) {if (!x.name?.trim()) return setMessage('Captura el nombre del producto nuevo.');setItems((a) => [...a, { catalogKey: `NEW:${Date.now()}`, itemType: 'PRODUCT', productId: '', name: x.name, sku: x.sku || '', quantity: Number(x.quantity || 1), unitCost: Number(x.unitCost || 0), discount: 0, taxType: 'IVA16', newProduct: { name: x.name, sku: x.sku || '', barcode: x.barcode || '', category: x.category || '', price: Number(x.price || 0), minimumStock: Number(x.minimumStock || 0) } }]);setNewProduct(false);}
  function purchaseErrorMessage(error) {
    const code = String(error?.message || error || '').trim();
    const map = {
      SUPPLIER_REQUIRED: 'Selecciona un proveedor.',
      BRANCH_REQUIRED: 'Selecciona la sucursal que recibirá la mercancía.',
      EMPTY_PURCHASE: 'Agrega al menos un producto a la compra.',
      INVALID_PURCHASE_ITEM: 'Revisa cantidades y costos; la cantidad debe ser mayor a cero.',
      INVALID_LINE_DISCOUNT: 'El descuento no puede ser mayor al importe de la línea.',
      INVALID_FISCAL_STATUS: 'Selecciona un estado fiscal válido.',
      FISCAL_DOCUMENT_REQUIRED: 'Para registrar la compra como Facturada adjunta al menos el XML CFDI o el PDF de la factura. Si aún no los tienes, selecciona Factura pendiente o Sin comprobante.',
      CFDI_XML_INVALID: 'El XML seleccionado no corresponde a un CFDI válido.',
      CFDI_UUID_INVALID: 'El UUID del CFDI no tiene un formato válido.',
      PURCHASE_NOT_RECEIVABLE: 'La compra ya fue recibida o cancelada y no puede recibirse nuevamente.',
      BRANCH_NOT_FOUND: 'La sucursal seleccionada no está disponible.',
      SUPPLIER_NOT_FOUND: 'El proveedor seleccionado no está disponible.',
      INSUFFICIENT_CASH_BALANCE: 'Efectivo insuficiente en caja. El saldo disponible no alcanza para registrar esta salida.'
    };
    return map[code] || code || 'No fue posible completar la operación.';
  }

  async function fileData(file, kind) {
    if (!file) return;
    try {
      if (kind === 'xml') {
        const text = await file.text();
        const cfdi = parseCfdiXml(text);
        setDoc((d) => ({
          ...d,
          fiscalStatus: cfdi.stamped ? 'FACTURADA' : d.fiscalStatus,
          documentType: 'CFDI',
          xmlName: file.name,
          xmlText: text,
          uuid: cfdi.uuid || d.uuid || '',
          reference: cfdi.reference || d.reference || '',
          documentDate: cfdi.date || d.documentDate || '',
          documentTotal: cfdi.total ?? d.documentTotal
        }));
        setMessage(cfdi.stamped ?
        `CFDI detectado. UUID ${cfdi.uuid} cargado automáticamente.` :
        'XML CFDI leído; no se encontró UUID de timbrado.');
        return;
      }
      const text = await new Promise((ok, no) => {const r = new FileReader();r.onload = () => ok(String(r.result).split(',')[1] || '');r.onerror = no;r.readAsDataURL(file);});
      setDoc((d) => ({ ...d, documentName: file.name, documentMime: file.type || 'application/pdf', documentBase64: text }));
    } catch (e) {
      const msg = purchaseErrorMessage(e);
      setMessage(msg);
      window.tcg_store_templateNotify?.(msg, { type: 'warning' });
    }
  }

  function validatePurchaseBeforeSave(status = doc.fiscalStatus) {
    if (!supplierId) throw new Error('SUPPLIER_REQUIRED');
    if (!branchId) throw new Error('BRANCH_REQUIRED');
    if (!items.length) throw new Error('EMPTY_PURCHASE');
    if (items.some((x) => Number(x.quantity || 0) <= 0 || Number(x.unitCost || 0) < 0)) throw new Error('INVALID_PURCHASE_ITEM');
    if (String(status).toUpperCase() === 'FACTURADA' && !doc.xmlText && !doc.documentBase64) throw new Error('FISCAL_DOCUMENT_REQUIRED');
  }

  function receiveDocumentType(status) {
    const value = String(status || '').toUpperCase();
    if (value === 'FACTURADA') return 'CFDI';
    if (value === 'SIN_COMPROBANTE') return 'SIN_DOCUMENTO';
    if (value === 'NO_FACTURADA' && doc.documentType === 'CFDI') return 'REMISION';
    return doc.documentType || 'SIN_DOCUMENTO';
  }

  async function save(receiveNow = false, statusOverride = null) {
    try {
      const fiscalStatus = String(statusOverride || doc.fiscalStatus || 'SIN_COMPROBANTE').toUpperCase();
      validatePurchaseBeforeSave(fiscalStatus);
      await api('/api/v1/purchases', {
        method: 'POST',
        body: JSON.stringify({
          ...doc,
          fiscalStatus,
          documentType: receiveDocumentType(fiscalStatus),
          supplierId,
          branchId,
          receiveNow,
          items
        })
      });
      setItems([]);
      setMessage(receiveNow ? 'Compra recibida e inventario actualizado.' : 'Compra guardada como borrador.');
      const r = await api('/api/v1/purchases?limit=200');
      setPurchases(r.data || []);
      return true;
    } catch (e) {
      const msg = purchaseErrorMessage(e);
      setMessage(msg);
      window.tcg_store_templateNotify?.(msg, { type: 'warning' });
      return false;
    }
  }

  function openReceiveConfirmation() {
    try {
      validatePurchaseBeforeSave(doc.fiscalStatus);
      setReceiveConfirm({ fiscalStatus: doc.fiscalStatus });
    } catch (e) {
      const msg = purchaseErrorMessage(e);
      setMessage(msg);
      window.tcg_store_templateNotify?.(msg, { type: 'warning' });
    }
  }

  async function confirmReceive() {
    if (!receiveConfirm) return;
    const status = String(receiveConfirm.fiscalStatus || 'SIN_COMPROBANTE').toUpperCase();
    try {
      validatePurchaseBeforeSave(status);
      setReceiveSaving(true);
      const ok = await save(true, status);
      if (ok) {
        setReceiveConfirm(null);
        setPurchaseWizardOpen(false);
        setPurchaseView('info');
        setPurchaseHistoryPage(1);
      }
    } finally {
      setReceiveSaving(false);
    }
  }
  async function receive(p) {if (!(await window.tcg_store_templateConfirm(`¿Recibir ${p.id_compra} en ${branches.find((b) => b.id_sucursal === branchId)?.nombre_sucursal || 'la sucursal'}?`, { title: 'Confirmar recepción', confirmText: 'Recibir' }))) return;try {await api(`/api/v1/purchases/${p.row_id}/receive`, { method: 'POST', body: JSON.stringify({ branchId }) });setMessage('Compra recibida; inventario actualizado.');const r = await api('/api/v1/purchases?limit=200');setPurchases(r.data);} catch (e) {setMessage(e.message);}}
  async function manageFiscal(p) {
    try {
      const response = await api(`/api/v1/purchases/${p.row_id}`);
      const full = response.data || p;
      setFiscalPurchase(full);
      setFiscalEdit({
        fiscalStatus: full.estatus_fiscal || 'PENDIENTE_FACTURA',
        uuid: full.uuid_cfdi || '',
        reference: full.referencia_documento || '',
        documentTotal: full.total_documento ?? full.total ?? '',
        documentName: full.documento_nombre || '',
        documentMime: full.documento_mime || '',
        documentBase64: '',
        xmlName: full.xml_nombre || '',
        xmlText: '',
        xmlParsed: null
      });
    } catch (e) {
      setMessage(e.message);
      window.tcg_store_templateNotify?.(e.message, { type: 'warning' });
    }
  }

  function decodeBase64(base64, mime = 'application/octet-stream') {
    const clean = String(base64 || '').replace(/^data:[^,]+,/, '').trim();
    if (!clean) return null;
    const raw = atob(clean);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'application/octet-stream' });
  }

  function fiscalBlob(kind) {
    if (!fiscalPurchase) return null;
    if (kind === 'xml') {
      const text = String(fiscalEdit?.xmlText || fiscalPurchase.xml_cfdi || '');
      return text ? new Blob([text], { type: 'application/xml;charset=utf-8' }) : null;
    }
    return decodeBase64(
      fiscalEdit?.documentBase64 || fiscalPurchase.documento_base64 || '',
      fiscalEdit?.documentMime || fiscalPurchase.documento_mime || 'application/pdf'
    );
  }

  function viewFiscalDocument(kind) {
    try {
      const blob = fiscalBlob(kind);
      if (!blob) throw new Error(kind === 'xml' ? 'No hay XML guardado para esta compra.' : 'No hay PDF/documento guardado para esta compra.');
      const url = URL.createObjectURL(blob);
      const win = window.open(url, '_blank', 'noopener,noreferrer');
      if (!win) throw new Error('El navegador bloqueó la ventana. Habilita ventanas emergentes para visualizar el archivo.');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      setMessage(e.message);
      window.tcg_store_templateNotify?.(e.message, { type: 'warning' });
    }
  }

  function downloadFiscalDocument(kind) {
    try {
      const blob = fiscalBlob(kind);
      if (!blob) throw new Error(kind === 'xml' ? 'No hay XML guardado para esta compra.' : 'No hay PDF/documento guardado para esta compra.');
      const name = kind === 'xml' ?
      fiscalEdit?.xmlName || fiscalPurchase.xml_nombre || `${fiscalPurchase.id_compra}.xml` :
      fiscalEdit?.documentName || fiscalPurchase.documento_nombre || `${fiscalPurchase.id_compra}.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setMessage(e.message);
      window.tcg_store_templateNotify?.(e.message, { type: 'warning' });
    }
  }
  function parseCfdiXml(xmlText) {
    const xml = String(xmlText || '').trim();
    if (!xml) throw new Error('El XML está vacío.');
    const docXml = new DOMParser().parseFromString(xml, 'application/xml');
    if (docXml.querySelector('parsererror')) throw new Error('El archivo XML no tiene una estructura válida.');

    const root = docXml.documentElement;
    if (!root || String(root.localName || '').toLowerCase() !== 'comprobante') {
      throw new Error('El XML seleccionado no corresponde a un CFDI.');
    }

    const nodes = Array.from(docXml.getElementsByTagName('*'));
    const timbre = nodes.find((el) => String(el.localName || '').toLowerCase() === 'timbrefiscaldigital');
    const emisor = nodes.find((el) => String(el.localName || '').toLowerCase() === 'emisor');
    const uuid = String(timbre?.getAttribute('UUID') || timbre?.getAttribute('Uuid') || '').trim();
    const serie = String(root.getAttribute('Serie') || '').trim();
    const folio = String(root.getAttribute('Folio') || '').trim();
    const reference = [serie, folio].filter(Boolean).join('-');
    const totalRaw = String(root.getAttribute('Total') || '').trim();
    const subtotalRaw = String(root.getAttribute('SubTotal') || root.getAttribute('Subtotal') || '').trim();
    const total = totalRaw !== '' && Number.isFinite(Number(totalRaw)) ? Number(totalRaw) : null;
    const subtotal = subtotalRaw !== '' && Number.isFinite(Number(subtotalRaw)) ? Number(subtotalRaw) : null;

    return {
      version: String(root.getAttribute('Version') || '').trim(),
      uuid,
      serie,
      folio,
      reference,
      date: String(root.getAttribute('Fecha') || '').trim(),
      subtotal,
      total,
      issuerRfc: String(emisor?.getAttribute('Rfc') || emisor?.getAttribute('RFC') || '').trim(),
      issuerName: String(emisor?.getAttribute('Nombre') || '').trim(),
      stamped: Boolean(uuid)
    };
  }

  async function fiscalFile(file, kind) {
    if (!file) return;
    if (kind === 'xml') {
      try {
        const text = await file.text();
        const cfdi = parseCfdiXml(text);
        setFiscalEdit((x) => ({
          ...x,
          xmlName: file.name,
          xmlText: text,
          xmlParsed: cfdi,
          fiscalStatus: cfdi.stamped ? 'FACTURADA' : x.fiscalStatus || 'PENDIENTE_FACTURA',
          uuid: cfdi.uuid || x.uuid || '',
          reference: cfdi.reference || x.reference || '',
          documentTotal: cfdi.total ?? x.documentTotal
        }));
        setMessage(cfdi.stamped ?
        `CFDI detectado. UUID ${cfdi.uuid} cargado automáticamente.` :
        'XML CFDI leído. No se encontró UUID de timbrado; revisa el estado fiscal.');
      } catch (e) {
        setMessage(e.message);
        window.tcg_store_templateNotify?.(e.message, { type: 'warning' });
      }
      return;
    }
    const base64 = await new Promise((ok, no) => {const r = new FileReader();r.onload = () => ok(String(r.result).split(',')[1] || '');r.onerror = no;r.readAsDataURL(file);});
    setFiscalEdit((x) => ({ ...x, documentName: file.name, documentMime: file.type || 'application/pdf', documentBase64: base64 }));
  }
  async function saveFiscal() {
    if (!fiscalPurchase || !fiscalEdit) return;
    try {
      setFiscalSaving(true);
      const status = String(fiscalEdit.fiscalStatus || '').toUpperCase();
      if (status === 'FACTURADA' && !fiscalEdit.xmlText && !fiscalEdit.documentBase64 && !fiscalPurchase.xml_nombre && !fiscalPurchase.documento_nombre) throw new Error('Adjunta al menos el XML o PDF de la factura.');
      await api(`/api/v1/purchases/${fiscalPurchase.row_id}/fiscal-document`, { method: 'POST', body: JSON.stringify({ ...fiscalEdit, documentTotal: fiscalEdit.documentTotal === '' ? null : Number(fiscalEdit.documentTotal) }) });
      const r = await api('/api/v1/purchases?limit=200');setPurchases(r.data || []);setFiscalPurchase(null);setFiscalEdit(null);setMessage(status === 'FACTURADA' ? 'Factura adjuntada y compra marcada como facturada.' : 'Documentación fiscal actualizada.');
    } catch (e) {setMessage(e.message);} finally {setFiscalSaving(false);}
  }

  async function open() {try {await api('/api/v1/cash/open', { method: 'POST', body: JSON.stringify({ branchId, openingFund: Number(openingFund || 0) }) });setMessage('Caja abierta.');await loadCash();} catch (e) {setMessage(e.message);}}
  async function addMovement() {
    try {
      await api('/api/v1/cash/movements', { method: 'POST', body: JSON.stringify({ ...movement, branchId, amount: Number(movement.amount) }) });
      setMovement((x) => ({ ...x, amount: '', description: '' }));
      setMessage('Movimiento registrado.');
      await loadCash();
    } catch (e) {
      const msg = purchaseErrorMessage(e);
      setMessage(msg);
      window.tcg_store_templateNotify?.(msg, { type: 'warning' });
    }
  }
  async function close() {if (!(await window.tcg_store_templateConfirm('¿Cerrar la caja? Después no aceptará movimientos.', { title: 'Cerrar caja', confirmText: 'Cerrar caja' }))) return;try {await api('/api/v1/cash/close', { method: 'POST', body: JSON.stringify({ branchId, countedCash: Number(counted) }) });setMessage('Caja cerrada correctamente.');await loadCash();} catch (e) {setMessage(e.message);}}

  function selectPurchaseView(view) {
    setPurchaseView(view);
    setCatalogOpen(false);
  }

  function closePurchaseWizard() {
    setCatalogOpen(false);
    setPurchaseWizardOpen(false);
    setPurchaseView('info');
  }

  function purchaseNextStep() {
    if (purchaseView === 'info') {
      if (!supplierId || !branchId) {
        setMessage('Selecciona proveedor y sucursal antes de continuar.');
        return;
      }
      setMessage('');
      selectPurchaseView('items');
      return;
    }
    if (purchaseView === 'items') {
      if (!items.length) {
        setMessage('Agrega al menos un artículo antes de continuar.');
        return;
      }
      setMessage('');
      selectPurchaseView('docs');
      return;
    }
    if (purchaseView === 'docs') {
      if (doc.fiscalStatus === 'FACTURADA' && !documentationAttached) {
        setMessage('Adjunta XML o PDF para continuar como compra facturada.');
        return;
      }
      setMessage('');
      selectPurchaseView('summary');
    }
  }

  function purchasePreviousStep() {
    if (purchaseView === 'summary') return selectPurchaseView('docs');
    if (purchaseView === 'docs') return selectPurchaseView('items');
    if (purchaseView === 'items') return selectPurchaseView('info');
  }

  async function savePurchaseDraftAndClose() {
    const ok = await save(false);
    if (ok) {
      setPurchaseWizardOpen(false);
      setPurchaseView('info');
      setPurchaseHistoryPage(1);
    }
  }

  async function startNewReception() {
    const hasCapture = items.length || doc.reference || doc.uuid || documentationAttached || doc.documentTotal !== '' || doc.notes;
    if (hasCapture && !(await window.tcg_store_templateConfirm('Se limpiará la recepción que está en captura. ¿Deseas continuar?', { title: 'Nueva recepción', confirmText: 'Iniciar nueva' }))) return;
    setItems([]);
    setDoc(emptyPurchaseDocument());
    setProductSearch('');
    setCatalogType('TODOS');
    setCatalogOpen(false);
    setMessage('');
    setPurchaseView('info');
    setPurchaseWizardOpen(true);
  }

  const cashChartRows = (() => {
    const days = Array.from({ length: 7 }, (_, index) => { const date = new Date(); date.setDate(date.getDate() - (6 - index)); const key = date.toISOString().slice(0, 10); return { key, label: date.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' }), positive: 0, negative: 0 }; });
    const byDay = new Map(days.map((day) => [day.key, day]));
    (Array.isArray(movements) ? movements : []).forEach((row) => { const day = byDay.get(r23DayKey(row.fecha)); if (!day) return; const amount = Math.abs(Number(row.impacto_efectivo ?? row.importe ?? 0)); if (String(row.tipo || '').toUpperCase().includes('EGRES')) day.negative += amount; else day.positive += amount; });
    return days;
  })();

  return <div className={`ops-stack r23-view ${tab === 'compras' ? 'r23-purchases' : 'r23-cash'}`}><section className="content-card">
    <div className="section-head"><div><div className="eyebrow">OPERACIÓN LOCAL</div><h2>{tab === 'compras' ? 'Compras / Recepción' : 'Caja / Arqueo'}</h2></div>{tab === 'compras' ? <div className="purchase-head-actions"><span className="phase-pill">10.6.2.4.1.6</span><button type="button" onClick={startNewReception}>+ Nueva recepción</button></div> : <span className="phase-pill">10.6.2.4.1.6</span>}</div>
    {message ? <div className="message">{message}</div> : null}
    <div className="purchase-context-note">{tab === 'compras' ?
        'Recepción de mercancía, documentación fiscal e impacto de inventario.' :
        'Control exclusivo del efectivo físico de la sucursal: apertura, retiros, depósitos y arqueo.'}</div>

    {tab === 'compras' ? <div className="purchase-v16 purchase-option3 purchase-r72">
      <div className="purchase-r72-overview">
        <div className="purchase-r72-metric">
          <span>Compras registradas</span>
          <strong>{purchases.length}</strong>
          <small>Historial de compras y recepciones</small>
        </div>
        <div className="purchase-r72-metric">
          <span>Borradores</span>
          <strong>{purchases.filter((p) => String(p.estado || '').toUpperCase() === 'BORRADOR').length}</strong>
          <small>Pendientes de completar o recibir</small>
        </div>
        <div className="purchase-r72-metric">
          <span>Recibidas</span>
          <strong>{purchases.filter((p) => String(p.estado || '').toUpperCase() === 'RECIBIDA').length}</strong>
          <small>Recepciones aplicadas a inventario</small>
        </div>
        <div className="purchase-r72-metric">
          <span>Total registrado</span>
          <strong>{money(purchases.reduce((sum, p) => sum + Number(p.total || 0), 0))}</strong>
          <small>Importe acumulado del historial</small>
        </div>
        <div className="purchase-r72-metric purchase-r73-history-card">
          <span>Historial</span>
          <strong>▣</strong>
          <small>Consulta compras recientes, recibe borradores y administra su documentación fiscal.</small>
        </div>
      </div>

      <section className="purchase-r72-history">
        <div className="purchase-r72-history-head">
          <div>
            <h3>Historial de compras / recepciones</h3>
          </div>
        </div>

        <div className="table-wrap purchase-r72-table">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Compra</th>
                <th>Proveedor</th>
                <th>Sucursal</th>
                <th>Fiscal</th>
                <th>Unidades</th>
                <th>Total</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {purchases.slice((purchaseHistoryPage - 1) * 10, purchaseHistoryPage * 10).map((p) => <tr key={p.row_id}>
                <td>{p.fecha ? new Date(p.fecha).toLocaleString('es-MX') : '—'}</td>
                <td><strong>{p.id_compra}</strong></td>
                <td>{p.proveedor || '—'}</td>
                <td>{p.sucursal_recepcion || '—'}</td>
                <td><span className={`fiscal-mini fiscal-${String(p.estatus_fiscal || 'SIN_COMPROBANTE').toLowerCase()}`}>{fiscalLabel[p.estatus_fiscal] || p.estatus_fiscal}</span></td>
                <td>{p.unidades_recibidas || 0}/{p.unidades_solicitadas || 0}</td>
                <td><strong>{money(p.total)}</strong></td>
                <td>{p.estado}</td>
                <td>
                  <div className="purchase-r72-row-actions">
                    {!['RECIBIDA', 'CANCELADA'].includes(String(p.estado).toUpperCase()) ? <button className="secondary compact" onClick={() => receive(p)}>Recibir</button> : null}
                    <button className="secondary compact" onClick={() => manageFiscal(p)}>{String(p.estatus_fiscal || '').toUpperCase() === 'PENDIENTE_FACTURA' ? 'Adjuntar factura' : 'Gestionar'}</button>
                  </div>
                </td>
              </tr>)}
              {!purchases.length ? <tr><td colSpan="9"><div className="purchase-r72-empty">No hay compras registradas.</div></td></tr> : null}
            </tbody>
          </table>
        </div>

        <PurchasePager page={purchaseHistoryPage} setPage={setPurchaseHistoryPage} total={purchases.length} pageSize={10} />
      </section>

      {purchaseWizardOpen ? createPortal(
        <div className="purchase-r72-backdrop" role="dialog" aria-modal="true" aria-labelledby="purchase-r72-title" onMouseDown={(e) => {if (e.target === e.currentTarget) closePurchaseWizard();}}>
          <div className="purchase-r72-wizard" onMouseDown={(e) => e.stopPropagation()}>
            <div className="purchase-r72-wizard-head">
              <div>
                <div className="eyebrow">COMPRAS / RECEPCIÓN</div>
                <h2 id="purchase-r72-title">Nueva recepción</h2>
              </div>
              <button type="button" className="icon-btn" onClick={closePurchaseWizard}>×</button>
            </div>

            <div className="purchase-r72-stepper">
              {[
                ['info', '1', 'Información'],
                ['items', '2', 'Artículos'],
                ['docs', '3', 'Documentación'],
                ['summary', '4', 'Resumen']
              ].map(([id, number, label]) => {
                const order = { info: 1, items: 2, docs: 3, summary: 4 };
                const current = order[purchaseView] || 1;
                const step = order[id];
                return <div key={id} className={`purchase-r72-step ${purchaseView === id ? 'active' : ''} ${current > step ? 'done' : ''}`}>
                  <span>{current > step ? '✓' : number}</span>
                  <strong>{label}</strong>
                </div>;
              })}
            </div>

            <div className="purchase-r72-body">
              {purchaseView === 'info' ? <section className="purchase-r72-step-panel">
                <div className="purchase-r72-step-title">
                  <h3>Información general</h3>
                  <p>Define proveedor, sucursal y la situación fiscal de la recepción.</p>
                </div>
                <div className="purchase-v16-grid purchase-r72-form-grid">
                  <label>Proveedor<select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">Selecciona</option>{suppliers.map((x) => <option key={x.row_id} value={x.id_proveedor}>{x.nombre_comercial || x.razon_social || x.id_proveedor}</option>)}</select></label>
                  <label>Sucursal receptora<select value={branchId} onChange={(e) => setBranchId(e.target.value)}>{branches.map((x) => <option key={x.row_id} value={x.id_sucursal}>{x.nombre_sucursal}</option>)}</select></label>
                  <label>Comprobación<select value={doc.fiscalStatus} onChange={(e) => {const fiscalStatus = e.target.value;setDoc((d) => ({ ...d, fiscalStatus, documentType: fiscalStatus === 'FACTURADA' ? 'CFDI' : fiscalStatus === 'SIN_COMPROBANTE' ? 'SIN_DOCUMENTO' : d.documentType }));}}><option value="FACTURADA">CFDI / Facturada</option><option value="PENDIENTE_FACTURA">Pendiente de factura</option><option value="NO_FACTURADA">Remisión / Ticket no fiscal</option><option value="SIN_COMPROBANTE">Sin comprobante</option></select></label>
                  <label>Tipo documento<select value={doc.documentType} onChange={(e) => setDoc((d) => ({ ...d, documentType: e.target.value }))}><option>CFDI</option><option>REMISION</option><option>TICKET</option><option>SIN_DOCUMENTO</option></select></label>
                  <label>Folio / referencia<input value={doc.reference} onChange={(e) => setDoc((d) => ({ ...d, reference: e.target.value }))} /></label>
                  <label>UUID CFDI<input disabled={doc.fiscalStatus !== 'FACTURADA'} value={doc.uuid} onChange={(e) => setDoc((d) => ({ ...d, uuid: e.target.value }))} /></label>
                  <label>Moneda<select value={doc.currency} onChange={(e) => setDoc((d) => ({ ...d, currency: e.target.value }))}><option>MXN</option><option>USD</option></select></label>
                  <label>Método de pago<select value={doc.paymentMethod} onChange={(e) => setDoc((d) => ({ ...d, paymentMethod: e.target.value }))}><option>TRANSFERENCIA</option><option>EFECTIVO</option><option>TARJETA</option><option>CREDITO</option><option>OTRO</option></select></label>
                </div>
              </section> : null}

              {purchaseView === 'items' ? <section className="purchase-r72-step-panel purchase-r72-items">
                <div className="purchase-r72-step-title purchase-r72-step-title-actions">
                  <div><h3>Artículos de la compra</h3><p>Busca productos del catálogo general o variantes TCG y captura cantidades/costos.</p></div>
                  <button className="secondary compact" onClick={() => setNewProduct(true)}>+ Alta de producto</button>
                </div>

                <div className="purchase-catalog-tabs">
                  <button className={catalogType === 'TODOS' ? 'active' : ''} onClick={() => {setCatalogType('TODOS');setCatalogOpen(true);}}>Todos <span>{purchaseCatalog.length}</span></button>
                  <button className={catalogType === 'PRODUCT' ? 'active' : ''} onClick={() => {setCatalogType('PRODUCT');setCatalogOpen(true);}}>Productos <span>{products.length}</span></button>
                  <button className={catalogType === 'TCG' ? 'active' : ''} onClick={() => {setCatalogType('TCG');setCatalogOpen(true);}}>Cartas TCG <span>{tcgInventory.length}</span></button>
                </div>

                <div className={`purchase-catalog-picker ${catalogOpen ? 'is-open' : ''}`}>
                  <label className="purchase-search">Buscar / seleccionar artículo
                    <div className="purchase-picker-input">
                      <input value={productSearch}
                        onFocus={() => setCatalogOpen(true)}
                        onChange={(e) => {setProductSearch(e.target.value);setCatalogOpen(true);}}
                        placeholder="Nombre, SKU, ID, código de barras, carta, rareza, condición…"
                        autoComplete="off" />
                      <button type="button" onClick={() => setCatalogOpen((v) => !v)} aria-label="Mostrar catálogo">⌄</button>
                    </div>
                  </label>

                  {catalogOpen ? <div className="purchase-search-results purchase-search-results-v2 purchase-r72-search-results">
                    <div className="purchase-results-head">
                      <span>{productSearch.trim() ? 'Resultados' : 'Catálogo disponible'}</span>
                      <strong>{shownProducts.length}{purchaseCatalog.length > shownProducts.length ? ' mostrados' : ''}</strong>
                    </div>
                    {shownProducts.length ? shownProducts.map((p) => <button key={p.key} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => addProduct(p)}>
                      <span className="purchase-result-main">
                        <span className={`purchase-kind ${p.kind === 'TCG' ? 'tcg' : 'product'}`}>{p.kind === 'TCG' ? 'CARTA TCG' : 'PRODUCTO'}</span>
                        <strong>{p.name}{p.kind === 'TCG' && p.rarity ? ` (${p.rarity})` : ''}</strong>
                        <small>{p.meta || `ID ${p.id}`}</small>
                      </span>
                      <span className="purchase-result-side">
                        <strong>{p.cost > 0 ? `Costo ${money(p.cost)}` : 'Costo por capturar'}</strong>
                        <small>{p.kind === 'TCG' ? `Stock actual ${p.stock} · ${p.sku || p.id}` : `ID ${p.id} · Stock ${p.stock}`}</small>
                      </span>
                    </button>) : <div className="purchase-no-results">No hay artículos que coincidan con la búsqueda.</div>}
                  </div> : null}
                </div>

                <div className="purchase-r72-line-list">
                  {items.map((x, i) => <div className="purchase-r72-line" key={`${x.productId || 'new'}-${i}`}>
                    <div className="purchase-product">
                      <span className={`purchase-kind ${x.itemType === 'TCG' ? 'tcg' : 'product'}`}>{x.itemType === 'TCG' ? 'CARTA TCG' : x.newProduct ? 'PRODUCTO NUEVO' : 'PRODUCTO'}</span>
                      <strong>{x.name}</strong>
                      <span>{[x.sku, x.variantMeta].filter(Boolean).join(' · ') || 'Sin identificadores adicionales'}</span>
                    </div>
                    <label>Cant.<input type="number" min="1" value={x.quantity} onChange={(e) => setItems((a) => a.map((y, j) => j === i ? { ...y, quantity: Number(e.target.value) } : y))} /></label>
                    <label>Costo<input type="number" min="0" step=".01" value={x.unitCost} onChange={(e) => setItems((a) => a.map((y, j) => j === i ? { ...y, unitCost: Number(e.target.value) } : y))} /></label>
                    <label>Descuento<input type="number" min="0" step=".01" value={x.discount} onChange={(e) => setItems((a) => a.map((y, j) => j === i ? { ...y, discount: Number(e.target.value) } : y))} /></label>
                    <label>Impuesto<select value={x.taxType} onChange={(e) => setItems((a) => a.map((y, j) => j === i ? { ...y, taxType: e.target.value } : y))}><option value="IVA16">IVA 16%</option><option value="IVA8">IVA 8%</option><option value="IVA0">IVA 0%</option><option value="EXENTO">Exento</option><option value="NO_OBJETO">No objeto</option><option value="SIN_COMPROBANTE">Sin comprobante</option></select></label>
                    <strong className="purchase-r72-line-total">{money(Math.max(0, x.quantity * x.unitCost - x.discount) * (x.taxType === 'IVA16' ? 1.16 : x.taxType === 'IVA8' ? 1.08 : 1))}</strong>
                    <button type="button" className="danger compact" aria-label={`Eliminar ${x.name}`} onClick={() => setItems((a) => a.filter((_, j) => j !== i))}>×</button>
                  </div>)}
                  {!items.length ? <div className="purchase-items-empty"><span aria-hidden="true">＋</span><strong>Busca y agrega artículos a la recepción</strong><small>Las cantidades, costos e impuestos aparecerán aquí.</small></div> : null}
                </div>
              </section> : null}

              {purchaseView === 'docs' ? <section className="purchase-r72-step-panel">
                <div className="purchase-r72-step-title">
                  <h3>Documentación</h3>
                  <p>Adjunta comprobantes fiscales, cargos adicionales y notas.</p>
                </div>
                <div className="purchase-v16-grid purchase-r72-form-grid">
                  <label>XML CFDI<input type="file" accept=".xml,text/xml,application/xml" onChange={(e) => fileData(e.target.files?.[0], 'xml')} /><span>{doc.xmlName || 'Sin XML'}</span></label>
                  <label>PDF / remisión / ticket<input type="file" accept=".pdf,image/*" onChange={(e) => fileData(e.target.files?.[0], 'doc')} /><span>{doc.documentName || 'Sin archivo'}</span></label>
                  <label>IEPS<input type="number" min="0" step=".01" value={doc.ieps} onChange={(e) => setDoc((d) => ({ ...d, ieps: e.target.value }))} /></label>
                  <label>Retenciones<input type="number" min="0" step=".01" value={doc.retentions} onChange={(e) => setDoc((d) => ({ ...d, retentions: e.target.value }))} /></label>
                  <label>Otros cargos<input type="number" min="0" step=".01" value={doc.otherCharges} onChange={(e) => setDoc((d) => ({ ...d, otherCharges: e.target.value }))} /></label>
                  <label>Total del documento<input type="number" min="0" step=".01" value={doc.documentTotal} onChange={(e) => setDoc((d) => ({ ...d, documentTotal: e.target.value }))} /></label>
                  <label className="wide">Notas<textarea value={doc.notes} onChange={(e) => setDoc((d) => ({ ...d, notes: e.target.value }))} /></label>
                </div>
              </section> : null}

              {purchaseView === 'summary' ? <section className="purchase-r72-step-panel">
                <div className="purchase-r72-step-title">
                  <h3>Resumen de la recepción</h3>
                  <p>Verifica los datos antes de guardar o recibir la mercancía.</p>
                </div>

                <div className="purchase-r72-summary-grid">
                  <article><span>Proveedor</span><strong>{suppliers.find((x) => x.id_proveedor === supplierId)?.nombre_comercial || suppliers.find((x) => x.id_proveedor === supplierId)?.razon_social || supplierId || '—'}</strong></article>
                  <article><span>Sucursal</span><strong>{branches.find((x) => x.id_sucursal === branchId)?.nombre_sucursal || branchId || '—'}</strong></article>
                  <article><span>Artículos</span><strong>{items.length}</strong><small>{receptionUnits} unidades</small></article>
                  <article><span>Estado fiscal</span><strong>{fiscalLabel[doc.fiscalStatus]}</strong><small>{doc.documentType || '—'}</small></article>
                  <article className="total"><span>Total</span><strong>{money(total)}</strong></article>
                </div>

                <div className="purchase-r72-finance">
                  <div><span>Subtotal</span><strong>{money(subtotal)}</strong></div>
                  <div><span>Descuentos</span><strong>- {money(discounts)}</strong></div>
                  <div><span>IVA calculado</span><strong>{money(iva)}</strong></div>
                  <div><span>IEPS</span><strong>{money(doc.ieps)}</strong></div>
                  <div><span>Retenciones</span><strong>- {money(doc.retentions)}</strong></div>
                  <div><span>Otros cargos</span><strong>{money(doc.otherCharges)}</strong></div>
                  <div><span>Total documento</span><strong>{doc.documentTotal === '' ? '—' : money(doc.documentTotal)}</strong></div>
                  <div><span>Diferencia</span><strong>{diff == null ? '—' : money(diff)}</strong></div>
                </div>

                <div className={`purchase-validation-note purchase-r72-validation ${receiveBlocker ? 'warning' : 'ready'}`}>
                  <span aria-hidden="true">{receiveBlocker ? '!' : '✓'}</span>
                  <p>{receiveBlocker || 'Recepción lista para confirmar.'}</p>
                </div>
              </section> : null}
            </div>

            <div className="purchase-r72-wizard-actions">
              <button type="button" className="secondary" onClick={closePurchaseWizard}>Cancelar</button>
              <div>
                {purchaseView !== 'info' ? <button type="button" className="secondary" onClick={purchasePreviousStep}>← Anterior</button> : null}
                {purchaseView !== 'summary' ? <button type="button" className="purchase-r72-primary" onClick={purchaseNextStep}>Siguiente →</button> :
                  <>
                    <button type="button" className="secondary" onClick={savePurchaseDraftAndClose}>Guardar borrador</button>
                    <button type="button" className="purchase-r72-primary" disabled={Boolean(receiveBlocker)} onClick={openReceiveConfirmation}>Recibir compra</button>
                  </>}
              </div>
            </div>
          </div>
        </div>,
        document.body
      ) : null}

      {receiveConfirm ? createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="tcg_store_template-receive-title"
            style={{
              position: 'fixed', inset: 0, zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 24, background: 'rgba(15,23,42,.62)', backdropFilter: 'blur(3px)', overflow: 'auto'
            }}
            onMouseDown={(e) => {if (e.target === e.currentTarget && !receiveSaving) setReceiveConfirm(null);}}>
            
          <div style={{ width: 'min(720px,100%)', background: 'var(--surface,#fff)', borderRadius: 18, padding: 24, boxShadow: '0 24px 80px rgba(15,23,42,.28)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
              <div>
                <div className="eyebrow">CONFIRMACIÓN DE RECEPCIÓN</div>
                <h3 id="tcg_store_template-receive-title" style={{ margin: '4px 0 6px' }}>Recibir mercancía</h3>
                <p style={{ margin: 0, opacity: .75 }}>La recepción aumentará el inventario una sola vez. La documentación fiscal podrá completarse después.</p>
              </div>
              <button type="button" className="secondary compact" disabled={receiveSaving} onClick={() => setReceiveConfirm(null)}>×</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, marginTop: 20 }}>
              <div style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 12 }}><small>Proveedor</small><br /><strong>{suppliers.find((x) => x.id_proveedor === supplierId)?.nombre_comercial || suppliers.find((x) => x.id_proveedor === supplierId)?.razon_social || supplierId}</strong></div>
              <div style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 12 }}><small>Sucursal</small><br /><strong>{branches.find((x) => x.id_sucursal === branchId)?.nombre_sucursal || branchId}</strong></div>
              <div style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 12 }}><small>Unidades</small><br /><strong>{items.reduce((a, x) => a + Number(x.quantity || 0), 0)}</strong></div>
              <div style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 12 }}><small>{brandText("Total GMX")}</small><br /><strong>{money(total)}</strong></div>
            </div>

            <label style={{ display: 'grid', gap: 6, marginTop: 20 }}>
              <strong>Situación fiscal al momento de recibir</strong>
              <select value={receiveConfirm.fiscalStatus} onChange={(e) => setReceiveConfirm((x) => ({ ...x, fiscalStatus: e.target.value }))}>
                <option value="FACTURADA">Tengo factura / CFDI</option>
                <option value="PENDIENTE_FACTURA">Factura pendiente</option>
                <option value="NO_FACTURADA">Remisión / ticket no fiscal</option>
                <option value="SIN_COMPROBANTE">Sin comprobante</option>
              </select>
            </label>

            {receiveConfirm.fiscalStatus === 'FACTURADA' ?
              <div style={{ marginTop: 14, padding: 14, borderRadius: 12, background: '#fff7ed', border: '1px solid #fed7aa' }}>
                  <strong>Factura disponible</strong><br />
                  Para marcar la compra como Facturada debe existir al menos XML CFDI o PDF adjunto.
                  <div style={{ marginTop: 6, fontSize: 13 }}>XML: {doc.xmlName || 'No adjunto'} · PDF: {doc.documentName || 'No adjunto'}</div>
                </div> :
              <div style={{ marginTop: 14, padding: 14, borderRadius: 12, background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                  <strong>Recepción permitida sin XML/PDF</strong><br />{brandText("\n                  GMX recibirá la mercancía y conservará el estado fiscal seleccionado. Más adelante podrás usar Historial → Gestionar / Adjuntar factura sin volver a modificar inventario.\n                ")}

              </div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22, flexWrap: 'wrap' }}>
              <button type="button" className="secondary" disabled={receiveSaving} onClick={() => setReceiveConfirm(null)}>Cancelar</button>
              <button type="button"
                disabled={receiveSaving || receiveConfirm.fiscalStatus === 'FACTURADA' && !doc.xmlText && !doc.documentBase64}
                onClick={confirmReceive}>
                {receiveSaving ? 'Recibiendo…' : 'Confirmar recepción'}
              </button>
            </div>
          </div>
        </div>, document.body) : null}
      {newProduct ? <NewProductDialog onClose={() => setNewProduct(false)} onAdd={addNewProduct} /> : null}
      {fiscalPurchase && fiscalEdit ? createPortal(
          <div
            className="modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tcg_store_template-fiscal-modal-title"
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 100000,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '24px',
              background: 'rgba(15,23,42,.62)',
              backdropFilter: 'blur(3px)',
              overflow: 'auto'
            }}
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) {
                setFiscalPurchase(null);
                setFiscalEdit(null);
              }
            }}>
            
          <div
              className="modal-card"
              style={{
                width: 'min(860px, calc(100vw - 48px))',
                maxWidth: '860px',
                maxHeight: 'calc(100vh - 48px)',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                padding: 0,
                margin: 'auto',
                borderRadius: 18,
                background: '#fff',
                boxShadow: '0 28px 80px rgba(15,23,42,.35)',
                border: '1px solid rgba(148,163,184,.35)'
              }}
              onMouseDown={(e) => e.stopPropagation()}>
              
            <div
                className="modal-head"
                style={{
                  flex: '0 0 auto',
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 16,
                  padding: '22px 24px 18px',
                  borderBottom: '1px solid #e5e7eb',
                  background: '#fff'
                }}>
                
              <div>
                <div className="eyebrow">COMPRAS · DOCUMENTACIÓN FISCAL</div>
                <h3 id="tcg_store_template-fiscal-modal-title" style={{ margin: '4px 0 5px' }}>Adjuntar / actualizar factura</h3>
                <small>{fiscalPurchase.id_compra} · {fiscalPurchase.proveedor || 'Proveedor'}</small>
              </div>
              <button
                  type="button"
                  className="secondary compact"
                  aria-label="Cerrar"
                  onClick={() => {setFiscalPurchase(null);setFiscalEdit(null);}}
                  style={{
                    flex: '0 0 auto',
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    fontSize: 20
                  }}>
                  ×</button>
            </div>

            <div style={{ padding: '22px 24px', overflowY: 'auto', flex: '1 1 auto' }}>
              <div className="tcg_store_template-fiscal-grid" style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2,minmax(0,1fr))',
                  gap: '16px 18px'
                }}>
                <label style={{ display: 'grid', gap: 7 }}>Estado fiscal
                  <select value={fiscalEdit.fiscalStatus} onChange={(e) => setFiscalEdit((x) => ({ ...x, fiscalStatus: e.target.value }))}>
                    <option value="FACTURADA">CFDI / Facturada</option>
                    <option value="PENDIENTE_FACTURA">Pendiente de factura</option>
                    <option value="NO_FACTURADA">Remisión / Ticket no fiscal</option>
                    <option value="SIN_COMPROBANTE">Sin comprobante</option>
                  </select>
                </label>

                <label style={{ display: 'grid', gap: 7 }}>UUID CFDI
                  <input value={fiscalEdit.uuid} onChange={(e) => setFiscalEdit((x) => ({ ...x, uuid: e.target.value }))} placeholder="UUID de la factura" />
                </label>

                <label style={{ display: 'grid', gap: 7 }}>Factura / referencia
                  <input value={fiscalEdit.reference} onChange={(e) => setFiscalEdit((x) => ({ ...x, reference: e.target.value }))} placeholder="Folio o referencia" />
                </label>

                <label style={{ display: 'grid', gap: 7 }}>Total factura
                  <input type="number" min="0" step=".01" value={fiscalEdit.documentTotal} onChange={(e) => setFiscalEdit((x) => ({ ...x, documentTotal: e.target.value }))} />
                </label>
              </div>

              <div className="tcg_store_template-fiscal-files" style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2,minmax(0,1fr))',
                  gap: 18,
                  marginTop: 20
                }}>
                <label style={{
                    display: 'grid', gap: 8, padding: 16,
                    border: '1px solid #e5e7eb', borderRadius: 14, background: '#f8fafc'
                  }}>
                  <strong>XML CFDI</strong>
                  <small>Archivo XML emitido por el proveedor.</small>
                  <input type="file" accept=".xml,text/xml,application/xml" onChange={(e) => fiscalFile(e.target.files?.[0], 'xml')} />
                  <span style={{ fontSize: 13, fontWeight: 600, overflowWrap: 'anywhere' }}>
                    {fiscalEdit.xmlName || fiscalPurchase.xml_nombre || 'Sin XML adjunto'}
                  </span>
                  {fiscalEdit.xmlText || fiscalPurchase.xml_cfdi ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                    <button type="button" className="secondary compact" onClick={(e) => {e.preventDefault();viewFiscalDocument('xml');}}>Ver XML</button>
                    <button type="button" className="secondary compact" onClick={(e) => {e.preventDefault();downloadFiscalDocument('xml');}}>Descargar XML</button>
                  </div> : null}
                </label>

                <label style={{
                    display: 'grid', gap: 8, padding: 16,
                    border: '1px solid #e5e7eb', borderRadius: 14, background: '#f8fafc'
                  }}>
                  <strong>PDF factura</strong>
                  <small>PDF, remisión o imagen de respaldo.</small>
                  <input type="file" accept=".pdf,application/pdf,image/*" onChange={(e) => fiscalFile(e.target.files?.[0], 'doc')} />
                  <span style={{ fontSize: 13, fontWeight: 600, overflowWrap: 'anywhere' }}>
                    {fiscalEdit.documentName || fiscalPurchase.documento_nombre || 'Sin PDF adjunto'}
                  </span>
                  {fiscalEdit.documentBase64 || fiscalPurchase.documento_base64 ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                    <button type="button" className="secondary compact" onClick={(e) => {e.preventDefault();viewFiscalDocument('pdf');}}>Ver PDF</button>
                    <button type="button" className="secondary compact" onClick={(e) => {e.preventDefault();downloadFiscalDocument('pdf');}}>Descargar PDF</button>
                  </div> : null}
                </label>
              </div>

              {fiscalEdit.xmlParsed ? <div style={{
                  marginTop: 20,
                  padding: '14px 16px',
                  borderRadius: 12,
                  background: '#ecfdf3',
                  border: '1px solid #abefc6',
                  fontSize: 13,
                  lineHeight: 1.55
                }}>
                <strong>CFDI detectado automáticamente</strong><br />
                {fiscalEdit.xmlParsed.issuerName || fiscalEdit.xmlParsed.issuerRfc ?
                  <>Emisor: {fiscalEdit.xmlParsed.issuerName || '—'} · {fiscalEdit.xmlParsed.issuerRfc || '—'}<br /></> :
                  null}
                UUID: {fiscalEdit.xmlParsed.uuid || 'Sin UUID de timbrado'}<br />
                Folio: {fiscalEdit.xmlParsed.reference || '—'} · Total XML: {fiscalEdit.xmlParsed.total == null ? '—' : money(fiscalEdit.xmlParsed.total)}
              </div> : null}

              <div style={{
                  marginTop: 20,
                  padding: '13px 15px',
                  borderRadius: 12,
                  background: '#f8fafc',
                  border: '1px solid #e5e7eb',
                  fontSize: 13,
                  lineHeight: 1.5
                }}>
                Actualizar la documentación fiscal <strong>no vuelve a recibir mercancía</strong> ni modifica inventario; únicamente actualiza los datos y archivos fiscales de esta compra.
              </div>
            </div>

            <div
                className="modal-actions"
                style={{
                  flex: '0 0 auto',
                  padding: '16px 24px 20px',
                  borderTop: '1px solid #e5e7eb',
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 10,
                  background: '#fff'
                }}>
                
              <button className="secondary" onClick={() => {setFiscalPurchase(null);setFiscalEdit(null);}}>Cancelar</button>
              <button disabled={fiscalSaving} onClick={saveFiscal}>{fiscalSaving ? 'Guardando...' : 'Guardar documentación'}</button>
            </div>
          </div>

          <style>{`
            @media (max-width: 760px){
              .tcg_store_template-fiscal-grid,
              .tcg_store_template-fiscal-files{
                grid-template-columns:1fr !important;
              }
            }
          `}</style>
        </div>,
          document.body
        ) : null}
    </div> : null}

    {tab === 'caja' ? <div className="cash-ob">

  <aside className="cash-ob-nav">
    <button type="button" className={cashView==='cash'?'active':''} onClick={()=>setCashView('cash')}>
      <svg viewBox="0 0 24 24"><path d="M4 8h16v11H4zM7 8V5h10v3M8 12h8M8 15h5"/></svg>
      <span>Caja / Arqueo</span>
    </button>
    <button type="button" className={cashView==='movements'?'active':''} onClick={()=>setCashView('movements')}>
      <svg viewBox="0 0 24 24"><path d="M5 6h14M5 12h14M5 18h14"/><circle cx="8" cy="6" r="1"/><circle cx="8" cy="12" r="1"/><circle cx="8" cy="18" r="1"/></svg>
      <span>Movimientos</span>
    </button>
    <button type="button" className={cashView==='history'?'active':''} onClick={()=>setCashView('history')}>
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2M5 5l2 2"/></svg>
      <span>Historial de cajas</span>
    </button>
  </aside>

  <main className="cash-ob-content">
    <header className="cash-ob-head">
      <div>
        <small>EFECTIVO</small>
        <h2>Caja / Arqueo</h2>
      </div>
      <div className="cash-ob-head-actions">
        <label><span>Sucursal:</span><select value={branchId} onChange={(e)=>setBranchId(e.target.value)}>{branches.map(x=><option key={x.row_id} value={x.id_sucursal}>{x.nombre_sucursal}</option>)}</select></label>
        <button type="button" onClick={()=>loadCash(branchId).catch(e=>setMessage(e.message))}>
          <svg viewBox="0 0 24 24"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M18.5 9A7 7 0 0 0 6 6.5L4 9m2 6a7 7 0 0 0 12.5 2.5L20 15"/></svg>
          Actualizar
        </button>
      </div>
    </header>

    {message ? <div className="cash-ob-message">{message}</div> : null}

    {cashView==='cash' ? <>
      <section className="cash-ob-controlrow">
        <article className="cash-ob-card cash-ob-status">
          <div className="cash-ob-label">Estado de caja</div>
          <div className={`cash-ob-lock ${openCash?'open':'closed'}`}>
            <svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
          </div>
          <strong>{openCash?'Abierta':'Cerrada'}</strong>
          <small>{openCash?.id_caja || 'CAJA'}</small>
        </article>

        <article className="cash-ob-card">
          <div className="cash-ob-title green">
            <span><svg viewBox="0 0 24 24"><path d="M7 10V7a5 5 0 0 1 9.5-2M5 10h14v10H5z"/></svg></span>
            <b>Apertura</b>
          </div>
          <label><span>Efectivo inicial</span><input type="number" min="0" step=".01" value={openingFund} onChange={(e)=>setOpeningFund(e.target.value)} disabled={Boolean(openCash)} placeholder="$ 0.00"/></label>
          <button type="button" className="green-btn" disabled={Boolean(openCash)} onClick={open}>▢&nbsp; Abrir caja</button>
        </article>

        <article className="cash-ob-card cash-ob-adjust">
          <div className="cash-ob-title purple">
            <span><svg viewBox="0 0 24 24"><path d="M12 3v18M7 8l5-5 5 5M7 16l5 5 5-5"/></svg></span>
            <b>Ajustes</b>
          </div>
          <div className="cash-ob-types">
            <button type="button" className={movement.type==='INGRESO'?'in active':'in'} disabled={!openCash} onClick={()=>setMovement(x=>({...x,type:'INGRESO',category:x.category==='RETIRO'?'DEPOSITO':x.category}))}>↑ Entrada</button>
            <button type="button" className={movement.type==='EGRESO'?'out active':'out'} disabled={!openCash} onClick={()=>setMovement(x=>({...x,type:'EGRESO',category:x.category==='DEPOSITO'?'RETIRO':x.category}))}>↑ Salida</button>
          </div>
          <div className="cash-ob-adjustfields">
            <label><span>Monto</span><input type="number" min=".01" step=".01" value={movement.amount} onChange={(e)=>setMovement(x=>({...x,amount:e.target.value}))} disabled={!openCash} placeholder="$ 0.00"/></label>
            <label><span>Motivo</span><select value={movement.category} onChange={(e)=>setMovement(x=>({...x,category:e.target.value}))} disabled={!openCash}>
              {movement.type==='INGRESO'?<>
                <option value="DEPOSITO">Depósito / ingreso a caja</option>
                <option value="MANUAL">Ajuste manual justificado</option>
                <option value="AJUSTE">Ajuste de arqueo</option>
              </>:<>
                <option value="RETIRO">Retiro de efectivo</option>
                <option value="MANUAL">Ajuste manual justificado</option>
                <option value="AJUSTE">Ajuste de arqueo</option>
              </>}
            </select></label>
          </div>
          <label><span>Nota (opcional)</span><input value={movement.description} onChange={(e)=>setMovement(x=>({...x,description:e.target.value}))} disabled={!openCash} placeholder="Escribe una nota..."/></label>
          <button type="button" className="purple-btn" disabled={!openCash} onClick={addMovement}>▣&nbsp; Registrar ajuste</button>
        </article>

        <article className="cash-ob-card">
          <div className="cash-ob-title blue">
            <span><svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></span>
            <b>Cierre</b>
          </div>
          <label><span>Efectivo contado</span><input type="number" min="0" step=".01" value={counted} onChange={(e)=>setCounted(e.target.value)} disabled={!openCash} placeholder="$ 0.00"/></label>
          <button type="button" className="blue-btn" disabled={!openCash} onClick={close}>▢&nbsp; Cerrar caja</button>
        </article>
      </section>

      <section className="cash-ob-lower">
        <article className="cash-ob-tablecard">
          <div className="cash-ob-tablehead"><span className="purple-icon">▣</span><h3>Movimientos recientes</h3></div>
          <div className="cash-ob-tablewrap">
            <table>
              <thead><tr><th>FECHA</th><th>DESCRIPCIÓN</th><th>MOTIVO</th><th>MONTO</th></tr></thead>
              <tbody>
                {(Array.isArray(movements)?movements:[]).slice(0,7).map(m=>{
                  const isOut=String(m.tipo||'').toUpperCase().includes('EGRES');
                  return <tr key={m.row_id}>
                    <td>{m.fecha?new Date(m.fecha).toLocaleString('es-MX'):'—'}</td>
                    <td>{m.descripcion||'—'}</td>
                    <td>{m.categoria||'—'}</td>
                    <td className={isOut?'out-money':'in-money'}>{isOut?'- ':'+ '}{money(Math.abs(Number(m.impacto_efectivo??m.importe??0)))}</td>
                  </tr>
                })}
                {!movements.length?<tr><td colSpan="4" className="empty">No hay movimientos registrados.</td></tr>:null}
              </tbody>
            </table>
          </div>
          <button type="button" className="cash-ob-more" onClick={()=>setCashView('movements')}>Ver todos los movimientos ›</button>
        </article>

        <article className="cash-ob-tablecard">
          <div className="cash-ob-tablehead"><span className="blue-icon">◷</span><h3>Historial de cajas</h3></div>
          <div className="cash-ob-tablewrap">
            <table>
              <thead><tr><th>APERTURA</th><th>CIERRE</th><th>CAJA</th><th>DIF.</th><th>ESTADO</th></tr></thead>
              <tbody>{sessions.slice(0,7).map(s=><tr key={s.row_id}>
                <td>{s.fecha_apertura?new Date(s.fecha_apertura).toLocaleString('es-MX'):'—'}</td>
                <td>{s.fecha_cierre?new Date(s.fecha_cierre).toLocaleString('es-MX'):'—'}</td>
                <td>{s.id_caja}</td>
                <td>{money(s.diferencia)}</td>
                <td>{s.estado}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </article>
      </section>
    </> : null}

    {cashView==='movements' ? <section className="cash-ob-full">
      <div className="cash-ob-fullhead"><div><span className="purple-icon">▣</span><h3>Movimientos</h3></div><span>{movements.length} registros</span></div>
      <div className="cash-ob-tablewrap full">
        <table>
          <thead><tr><th>FECHA</th><th>TIPO</th><th>DESCRIPCIÓN</th><th>MOTIVO</th><th>MONTO</th></tr></thead>
          <tbody>{(Array.isArray(movements)?movements:[]).map(m=>{
            const isOut=String(m.tipo||'').toUpperCase().includes('EGRES');
            return <tr key={m.row_id}><td>{m.fecha?new Date(m.fecha).toLocaleString('es-MX'):'—'}</td><td>{m.tipo||'—'}</td><td>{m.descripcion||'—'}</td><td>{m.categoria||'—'}</td><td className={isOut?'out-money':'in-money'}>{isOut?'- ':'+ '}{money(Math.abs(Number(m.impacto_efectivo??m.importe??0)))}</td></tr>
          })}</tbody>
        </table>
      </div>
    </section> : null}

    {cashView==='history' ? <section className="cash-ob-full">
      <div className="cash-ob-fullhead"><div><span className="blue-icon">◷</span><h3>Historial de cajas</h3></div><span>{sessions.length} registros</span></div>
      <div className="cash-ob-tablewrap full">
        <table>
          <thead><tr><th>APERTURA</th><th>CIERRE</th><th>CAJA</th><th>ESPERADO</th><th>CONTADO</th><th>DIFERENCIA</th><th>ESTADO</th></tr></thead>
          <tbody>{sessions.map(s=><tr key={s.row_id}><td>{s.fecha_apertura?new Date(s.fecha_apertura).toLocaleString('es-MX'):'—'}</td><td>{s.fecha_cierre?new Date(s.fecha_cierre).toLocaleString('es-MX'):'—'}</td><td>{s.id_caja}</td><td>{money(s.saldo_esperado)}</td><td>{s.efectivo_contado??'—'}</td><td>{money(s.diferencia)}</td><td>{s.estado}</td></tr>)}</tbody>
        </table>
      </div>
    </section> : null}
  </main>

</div> : null}
  </section></div>;
}

function PurchasePager({ page, setPage, total, pageSize = 5 }) {
  const pages = Math.max(1, Math.ceil(Number(total || 0) / pageSize));
  const current = Math.min(Math.max(1, Number(page || 1)), pages);
  const first = Math.max(1, Math.min(current - 2, Math.max(1, pages - 4)));
  const visible = Array.from({ length: Math.min(5, pages) }, (_, index) => first + index);
  return <div className="purchase-r72-pager">
    <span>Mostrando {total ? (current - 1) * pageSize + 1 : 0} a {Math.min(current * pageSize, total)} de {total}</span>
    <div>
      <button type="button" disabled={current <= 1} onClick={() => setPage(1)}>«</button>
      <button type="button" disabled={current <= 1} onClick={() => setPage(Math.max(1, current - 1))}>‹</button>
      {visible.map((number) => <button type="button" key={number} className={number === current ? 'active' : ''} onClick={() => setPage(number)}>{number}</button>)}
      <button type="button" disabled={current >= pages} onClick={() => setPage(Math.min(pages, current + 1))}>›</button>
      <button type="button" disabled={current >= pages} onClick={() => setPage(pages)}>»</button>
    </div>
  </div>;
}

function NewProductDialog({ onClose, onAdd }) {
  const [x, setX] = useState({ name: '', sku: '', barcode: '', category: '', quantity: 1, unitCost: 0, price: 0, minimumStock: 0 });
  return <div className="modal-backdrop"><div className="modal-card purchase-new-product"><div className="modal-head"><h3>Producto nuevo dentro de la compra</h3><button className="secondary compact" onClick={onClose}>×</button></div><div className="form-grid">
    <label>Nombre *<input value={x.name} onChange={(e) => setX((v) => ({ ...v, name: e.target.value }))} /></label><label>Código / SKU *<input value={x.sku} placeholder="Escanear código o escribir SKU interno" onChange={(e) => { const code=e.target.value; setX((v) => ({ ...v, sku: code, barcode: /^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(String(code).trim()) ? String(code).trim() : '' })); }} /></label><label>Categoría<input value={x.category} onChange={(e) => setX((v) => ({ ...v, category: e.target.value }))} /></label><label>Cantidad<input type="number" min="1" value={x.quantity} onChange={(e) => setX((v) => ({ ...v, quantity: e.target.value }))} /></label><label>Costo unitario<input type="number" min="0" step=".01" value={x.unitCost} onChange={(e) => setX((v) => ({ ...v, unitCost: e.target.value }))} /></label><label>Precio venta<input type="number" min="0" step=".01" value={x.price} onChange={(e) => setX((v) => ({ ...v, price: e.target.value }))} /></label><label>Stock mínimo<input type="number" min="0" value={x.minimumStock} onChange={(e) => setX((v) => ({ ...v, minimumStock: e.target.value }))} /></label>
  </div><div className="modal-actions"><button className="secondary" onClick={onClose}>Cancelar</button><button onClick={() => onAdd(x)}>Agregar a compra</button></div></div></div>;
}

