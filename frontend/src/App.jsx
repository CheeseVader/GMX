import { Navigate,Route,Routes,useLocation } from 'react-router';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import AppShell from './layouts/AppShell.jsx';
import LoginPage from './pages/LoginPage.jsx';
import AdminRecoverAccessPage from './pages/AdminRecoverAccessPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import ProductsPage from './pages/ProductsPage.jsx';
import ExternalCardLookupBetaPage from './pages/ExternalCardLookupBetaPage.jsx';
import VisualSearchBetaPage from './pages/VisualSearchBetaPage.jsx';
import CategoriesPage from './pages/CategoriesPage.jsx';
import ClientsPage from './pages/ClientsPage.jsx';
import InventoryPage from './pages/InventoryPage.jsx';
import BranchesPage from './pages/BranchesPage.jsx';
import OrdersPage from './pages/OrdersPage.jsx';
import PurchasesCashPage from './pages/PurchasesCashPage.jsx';
import CommercialPage from './pages/CommercialPage.jsx';
import ReturnAuthorizationPage from './pages/ReturnAuthorizationPage.jsx';
import ContentMarketingPage from './pages/ContentMarketingPage.jsx';
import PromotionsLoyaltyPage from './pages/PromotionsLoyaltyPage.jsx';
import NotificationsPage from './pages/NotificationsPage.jsx';
import TCGPage from './pages/TCGPage.jsx';
import TCGOperationsPage from './pages/TCGOperationsPage.jsx';
import BuylistPage from './pages/BuylistPage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import SystemPage from './pages/SystemPage.jsx';
import MembershipsPage from './pages/MembershipsPage.jsx';
import TournamentsPage from './pages/TournamentsPage.jsx';
import StoreMembershipsPage from './pages/public/StoreMembershipsPage.jsx';
import StoreTournamentsPage from './pages/public/StoreTournamentsPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import GlobalTheme from './components/GlobalTheme.jsx';
import GlobalFeedback from './components/GlobalFeedback.jsx';
import GlobalInputGuard from './components/GlobalInputGuard.jsx';
import GlobalOperationProgress from './components/GlobalOperationProgress.jsx';
import PublicStoreLayout from './layouts/PublicStoreLayout.jsx';
import { PublicStoreProvider } from './contexts/PublicStoreContext.jsx';
import { CartProvider } from './contexts/CartContext.jsx';
import { ClientAuthProvider } from './contexts/ClientAuthContext.jsx';
import StoreHomePage from './pages/public/StoreHomePage.jsx';
import StoreCatalogPage from './pages/public/StoreCatalogPage.jsx';
import StoreProductPage from './pages/public/StoreProductPage.jsx';
import StoreTcgPage from './pages/public/StoreTcgPage.jsx';
import StoreTcgDetailPage from './pages/public/StoreTcgDetailPage.jsx';
import StoreSearchPage from './pages/public/StoreSearchPage.jsx';
import StorePromotionsPage from './pages/public/StorePromotionsPage.jsx';
import StoreCartPage from './pages/public/StoreCartPage.jsx';
import StoreCheckoutPage from './pages/public/StoreCheckoutPage.jsx';
import StoreOrderPage from './pages/public/StoreOrderPage.jsx';
import StoreAccountPage from './pages/public/StoreAccountPage.jsx';
import StoreReceiptPage from './pages/public/StoreReceiptPage.jsx';
import StoreVerifyEmailPage from './pages/public/StoreVerifyEmailPage.jsx';
import StoreCardResultPage from './pages/public/StoreCardResultPage.jsx';
import StoreTransferPage from './pages/public/StoreTransferPage.jsx';
import StoreRecoverAccountPage from './pages/public/StoreRecoverAccountPage.jsx';


import SalesHistoryPage from './pages/SalesHistoryPage.jsx';
import TransferPaymentsAdminPage from './pages/TransferPaymentsAdminPage.jsx';
export default function App(){
  const location=useLocation();
  let currentUser={};
  try{currentUser=JSON.parse(localStorage.getItem('SHINY_AUTH_USER')||'{}');}catch{}
  const operatorAdmin=String(currentUser?.rol||'').toUpperCase()==='OPERADOR'&&location.pathname.startsWith('/admin');
  return <><GlobalTheme/>{operatorAdmin?null:<GlobalFeedback/>}<GlobalInputGuard/>{operatorAdmin?null:<GlobalOperationProgress/>}<Routes>
    {/* Public storefront */}
    <Route path="/" element={<Navigate to="/tienda" replace/>}/>
    <Route element={<PublicStoreProvider><ClientAuthProvider><CartProvider><PublicStoreLayout/></CartProvider></ClientAuthProvider></PublicStoreProvider>}>
      <Route path="/tienda" element={<StoreHomePage/>}/>
      <Route path="/tienda/catalogo" element={<StoreCatalogPage/>}/>
      <Route path="/tienda/producto/:rowId" element={<StoreProductPage/>}/>
      <Route path="/tienda/tcg" element={<StoreTcgPage/>}/>
      <Route path="/tienda/tcg/item/:rowId" element={<StoreTcgDetailPage/>}/>
      <Route path="/tienda/buscar" element={<StoreSearchPage/>}/>
      <Route path="/tienda/promociones" element={<StorePromotionsPage/>}/>
      <Route path="/tienda/membresias" element={<StoreMembershipsPage/>}/>
      <Route path="/tienda/torneos" element={<StoreTournamentsPage/>}/>
      <Route path="/tienda/carrito" element={<StoreCartPage/>}/>
      <Route path="/tienda/checkout" element={<StoreCheckoutPage/>}/>
      <Route path="/tienda/pedido/:token" element={<StoreOrderPage/>}/>
      <Route path="/tienda/cuenta" element={<StoreAccountPage/>}/>
      <Route path="/tienda/recuperar-cuenta" element={<StoreRecoverAccountPage/>}/>
      <Route path="/tienda/comprobante/:token" element={<StoreReceiptPage/>}/>
      <Route path="/tienda/verificar-email" element={<StoreVerifyEmailPage/>}/>
      <Route path="/tienda/pago/tarjeta/resultado" element={<StoreCardResultPage/>}/>
      <Route path="/tienda/pago/transferencia/:token" element={<StoreTransferPage/>}/>
    </Route>

    {/* Administrative authentication */}
    <Route path="/login" element={<LoginPage/>}/>
    <Route path="/admin/login" element={<Navigate to="/login" replace/>}/>
    <Route path="/admin/recuperar-acceso" element={<AdminRecoverAccessPage/>}/>

    {/* Canonical administrative namespace. Nothing under /admin is public. */}
    <Route element={<ProtectedRoute/>}>
      <Route path="/admin" element={<AppShell/>}>
        <Route index element={<Navigate to="dashboard" replace/>}/>
        <Route path="dashboard" element={<DashboardPage/>}/>
        <Route path="productos" element={<ProductsPage/>}/>
        <Route path="busqueda-visual-beta" element={<VisualSearchBetaPage/>}/>
        <Route path="alta-externa-beta" element={<ExternalCardLookupBetaPage/>}/>
        <Route path="categorias" element={<CategoriesPage/>}/>
        <Route path="clientes" element={<ClientsPage/>}/>
        <Route path="inventario" element={<InventoryPage/>}/>
        <Route path="sucursales" element={<BranchesPage/>}/>
        <Route path="pos" element={<OrdersPage mode="pos"/>}/>
        <Route path="pedidos" element={<OrdersPage mode="orders"/>}/>
        <Route path="transferencias" element={<TransferPaymentsAdminPage/>}/>
        <Route path="historial-ventas" element={<SalesHistoryPage/>}/>
        <Route path="compras" element={<PurchasesCashPage/>}/>
        <Route path="caja" element={<PurchasesCashPage/>}/>
        <Route path="devoluciones" element={<CommercialPage/>}/>
        <Route path="generar-codigo" element={<ReturnAuthorizationPage/>}/>
        <Route path="comercial" element={<CommercialPage/>}/>
        <Route path="contenido" element={<ContentMarketingPage/>}/>
        <Route path="promociones" element={<PromotionsLoyaltyPage/>}/>
        <Route path="membresias" element={<MembershipsPage/>}/>
        <Route path="torneos" element={<TournamentsPage/>}/>
        <Route path="notificaciones" element={<NotificationsPage/>}/>
        <Route path="tcg" element={<TCGPage/>}/>
        <Route path="tcg-operacion" element={<TCGOperationsPage/>}/>
        <Route path="buylist" element={<BuylistPage/>}/>
        <Route path="reportes" element={<ReportsPage/>}/>
        <Route path="administracion" element={<AdminPage/>}/>
        <Route path="sistema" element={<SystemPage/>}/>
        <Route path="*" element={<NotFoundPage/>}/>
      </Route>

      {/* Backward-compatible legacy URLs. These remain protected and only redirect. */}
      <Route path="/dashboard" element={<Navigate to="/admin/dashboard" replace/>}/>
      <Route path="/productos" element={<Navigate to="/admin/productos" replace/>}/>
      <Route path="/clientes" element={<Navigate to="/admin/clientes" replace/>}/>
      <Route path="/inventario" element={<Navigate to="/admin/inventario" replace/>}/>
      <Route path="/sucursales" element={<Navigate to="/admin/sucursales" replace/>}/>
      <Route path="/pedidos" element={<Navigate to="/admin/pedidos" replace/>}/>
      <Route path="/pos" element={<Navigate to="/admin/pos" replace/>}/>
      <Route path="/compras" element={<Navigate to="/admin/compras" replace/>}/>
      <Route path="/caja" element={<Navigate to="/admin/caja" replace/>}/>
      <Route path="/comercial" element={<Navigate to="/admin/comercial" replace/>}/>
      <Route path="/contenido" element={<Navigate to="/admin/contenido" replace/>}/>
      <Route path="/promociones" element={<Navigate to="/admin/promociones" replace/>}/>
      <Route path="/notificaciones" element={<Navigate to="/admin/notificaciones" replace/>}/>
      <Route path="/tcg" element={<Navigate to="/admin/tcg" replace/>}/>
      <Route path="/tcg-operacion" element={<Navigate to="/admin/tcg-operacion" replace/>}/>
      <Route path="/buylist" element={<Navigate to="/admin/buylist" replace/>}/>
      <Route path="/reportes" element={<Navigate to="/admin/reportes" replace/>}/>
      <Route path="/administracion" element={<Navigate to="/admin/administracion" replace/>}/>
      <Route path="/sistema" element={<Navigate to="/admin/sistema" replace/>}/>
    </Route>

    {/* Unknown URLs are never silently converted into the client portal. */}
    <Route path="*" element={<NotFoundPage/>}/>
  </Routes></>;
}
