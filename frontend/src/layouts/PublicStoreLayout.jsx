import { brandText } from '../config/brand.js';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useEffect, useState } from 'react';
import { usePublicStore } from '../contexts/PublicStoreContext.jsx';
import { useCart } from '../contexts/CartContext.jsx';
import { useClientAuth } from '../contexts/ClientAuthContext.jsx';
import { publicApi } from '../services/publicApi.js';
import PublicIcon from '../components/public/PublicIcon.jsx';
import '../shiny_storefront_client_r1.css';

export default function PublicStoreLayout() {
  const { store, loading, error } = usePublicStore();
  const cart = useCart();
  const clientAuth = useClientAuth();
  const nav = useNavigate();
  const [search, setSearch] = useState('');
  const [searchType, setSearchType] = useState('ALL');
  const [tcgGames, setTcgGames] = useState([]);
  const [preferredTcgIds,setPreferredTcgIds] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const s = store?.settings || {};
  const brand = s['public.appearance.brand_name'] || brandText("GMX");
  const logo = s['public.appearance.logo_text'] || 'G';

  function loadClientTcgPreferences() {
    if (!clientAuth.user) {
      setPreferredTcgIds(null);
      return;
    }

    const prefKey = `gmx-client-preferences:${clientAuth.user?.id_cliente || clientAuth.user?.email || 'guest'}`;

    try {
      const raw = localStorage.getItem(prefKey);

      if (!raw) {
        setPreferredTcgIds(null);
        return;
      }

      const parsed = JSON.parse(raw);
      const ids = Array.isArray(parsed?.tcg_favoritos)
        ? parsed.tcg_favoritos.map(x=>String(x))
        : [];

      setPreferredTcgIds(ids);
    } catch {
      setPreferredTcgIds(null);
    }
  }
  async function loadVisibleTcgGames() {
    try {
      const r = await publicApi(`/api/public/tcg/games?_=${Date.now()}`);
      setTcgGames(Array.isArray(r.data) ? r.data : []);
    } catch {
      setTcgGames([]);
    }
  }

  useEffect(() => {
    loadVisibleTcgGames();

    const refresh = () => loadVisibleTcgGames();
    const storage = (e) => {
      if (e.key === 'SHINY_TCG_VISIBILITY_VERSION') refresh();
    };
    const visibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    window.addEventListener('focus', refresh);
    window.addEventListener('storage', storage);
    window.addEventListener('shiny:tcg-visibility-changed', refresh);
    document.addEventListener('visibilitychange', visibility);

    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', storage);
      window.removeEventListener('shiny:tcg-visibility-changed', refresh);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);

  useEffect(() => {
    loadClientTcgPreferences();

    const refreshPreferences = () => loadClientTcgPreferences();

    window.addEventListener('storage',refreshPreferences);
    window.addEventListener('gmx:client-preferences-changed',refreshPreferences);

    return () => {
      window.removeEventListener('storage',refreshPreferences);
      window.removeEventListener('gmx:client-preferences-changed',refreshPreferences);
    };
  }, [clientAuth.user?.id_cliente,clientAuth.user?.email]);
  function submitSearch(e) {
    e.preventDefault();
    const q = search.trim();
    if (!q) {nav('/tienda/catalogo');return;}
    if (searchType === 'PRODUCT') nav(`/tienda/catalogo?q=${encodeURIComponent(q)}`);else
    if (searchType === 'TCG') nav(`/tienda/tcg?q=${encodeURIComponent(q)}`);else
    nav(`/tienda/buscar?q=${encodeURIComponent(q)}`);
  }

  const visibleTcgGamesForClient = preferredTcgIds === null
    ? tcgGames
    : tcgGames.filter(game=>preferredTcgIds.includes(String(game.id_juego)));

  const publicContactEmail = String(s['public.store.contact.email'] || '').trim();
  const publicContactPhone = String(s['public.store.contact.phone'] || '').trim();
  const publicContactWhatsApp = String(s['public.store.contact.whatsapp'] || '').trim();
  const publicContactHours = String(s['public.store.contact.hours'] || '').trim();

  const showPublicContactEmail = s['public.store.contact.show_email'] !== 'false' && Boolean(publicContactEmail);
  const showPublicContactPhone = s['public.store.contact.show_phone'] !== 'false' && Boolean(publicContactPhone);
  const showPublicContactWhatsApp = s['public.store.contact.show_whatsapp'] !== 'false' && Boolean(publicContactWhatsApp);
  const showPublicContactHours = s['public.store.contact.show_hours'] !== 'false' && Boolean(publicContactHours);

  const hasPublicContact =
    showPublicContactEmail ||
    showPublicContactPhone ||
    showPublicContactWhatsApp ||
    showPublicContactHours;

  const publicContactWhatsAppDigits = publicContactWhatsApp.replace(/\D/g,'');
  const publicContactPhoneHref = publicContactPhone.replace(/[^\d+]/g,'');
  const firstName = clientAuth.user?.nombre ? String(clientAuth.user.nombre).split(' ')[0] : '';

  return <div className="public-store" style={{
    '--ps-primary': s['public.appearance.primary'] || '#111827',
    '--ps-secondary': s['public.appearance.secondary'] || '#f59e0b',
    '--ps-accent': s['public.appearance.accent'] || '#8b5cf6',
    '--ps-surface': s['public.appearance.surface'] || '#111827',
    '--ps-bg': s['public.appearance.background'] || '#090e1a',
    '--ps-text': s['public.appearance.text'] || '#f8fafc',
    '--ps-muted': s['public.appearance.muted'] || '#94a3b8',
    '--ps-radius': `${Number(s['public.appearance.radius'] || 18)}px`
  }}>
    <header className="public-header shiny-client-header">
      <div className="public-header-main">
        <button className="shiny-mobile-menu" type="button" aria-label={menuOpen ? 'Cerrar menÃº' : 'Abrir menÃº'} onClick={() => setMenuOpen((value) => !value)}>
          <PublicIcon name={menuOpen ? 'close' : 'menu'} />
        </button>
        <NavLink to="/tienda" className="public-brand" aria-label={`${brand}, inicio`} onClick={() => setMenuOpen(false)}><b>{logo}</b><strong>{brand}</strong></NavLink>
        <form className="public-search" onSubmit={submitSearch}>
          <select aria-label="Tipo de bÃºsqueda" value={searchType} onChange={(e) => setSearchType(e.target.value)}>
            <option value="ALL">Todo</option><option value="PRODUCT">Productos</option><option value="TCG">TCG</option>
          </select>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar cartas, productos o sets..." />
          <button aria-label="Buscar"><PublicIcon name="search" size={18} /></button>
        </form>
        <nav className="public-account-nav">
          <NavLink to="/tienda/cuenta" className="shiny-account-link"><PublicIcon name="user" /><span>{firstName ? `Hola, ${firstName}` : 'Ingresar / Cuenta'}</span></NavLink>
          <NavLink to="/tienda/carrito" className="cart-link" aria-label={`Carrito, ${cart.count} productos`}><PublicIcon name="cart" /><span>{cart.count}</span></NavLink>
        </nav>
      </div>
      <nav className={`public-category-nav ${menuOpen ? 'is-open' : ''}`}>
        {visibleTcgGamesForClient.map((game) => <NavLink
          key={game.id_juego}
          onClick={() => setMenuOpen(false)}
          to={`/tienda/tcg?gameId=${encodeURIComponent(game.id_juego)}`}>
          {game.nombre}</NavLink>)}
        <NavLink onClick={() => setMenuOpen(false)} to="/tienda/catalogo">Productos</NavLink>
        <NavLink onClick={() => setMenuOpen(false)} to="/tienda/promociones">Promociones</NavLink>
        <NavLink onClick={() => setMenuOpen(false)} to="/tienda/torneos">Torneos</NavLink>
        <NavLink onClick={() => setMenuOpen(false)} to="/tienda/membresias">Membresias</NavLink>
      </nav>
    </header>

    {store?.promotions?.length ? <div className="public-promo-bar">
      <span><PublicIcon name="tag" size={15} /> {store.promotions[0].nombre}{store.promotions[0].codigo ? <> Â· CÃ³digo <b>{store.promotions[0].codigo}</b></> : null}</span>
      <NavLink to="/tienda/promociones">Ver promociÃ³n <PublicIcon name="arrow" size={14} /></NavLink>
    </div> : null}

    {loading ? <div className="public-system-message">Cargando tiendaâ€¦</div> : null}
    {error ? <div className="public-system-message error">{error}</div> : null}

    <Outlet />
    <footer className="public-footer shiny-client-footer">
      <div className="shiny-footer-brand">
        <NavLink to="/tienda" className="public-brand"><b>{logo}</b><strong>{brand}</strong></NavLink>
        <p>Tu tienda de TCG y coleccionables en M&eacute;xico.</p>
        <small>Compra segura &middot; Stock actualizado</small>
      </div>

      <div>
        <b>Comprar</b>
        <NavLink to="/tienda/catalogo">Todos los productos</NavLink>
        <NavLink to="/tienda/tcg">Cartas y TCG</NavLink>
        <NavLink to="/tienda/promociones">Ofertas</NavLink>
      </div>

      <div>
        <b>TCG</b>
        {visibleTcgGamesForClient.slice(0,4).map((game) =>
          <NavLink
            key={'footer-' + game.id_juego}
            to={'/tienda/tcg?gameId=' + encodeURIComponent(game.id_juego)}
          >
            {game.nombre}
          </NavLink>
        )}
      </div>

      <div>
        <b>Mi cuenta</b>
        <NavLink to="/tienda/cuenta">Ingresar / Crear cuenta</NavLink>
        <NavLink to="/tienda/cuenta">Mis pedidos</NavLink>
        <NavLink to="/tienda/cuenta">Lista de deseos</NavLink>
      </div>

      {hasPublicContact ? <div className="shiny-footer-contact">
        <b>Cont&aacute;ctanos</b>

        {showPublicContactWhatsApp
          ? <a
              href={'https://wa.me/' + publicContactWhatsAppDigits}
              target="_blank"
              rel="noreferrer"
            >
              WhatsApp: {publicContactWhatsApp}
            </a>
          : null}

        {showPublicContactPhone
          ? <a href={'tel:' + publicContactPhoneHref}>
              Tel&eacute;fono: {publicContactPhone}
            </a>
          : null}

        {showPublicContactEmail
          ? <a href={'mailto:' + publicContactEmail}>
              Correo: {publicContactEmail}
            </a>
          : null}

        {showPublicContactHours
          ? <span>Horario: {publicContactHours}</span>
          : null}
      </div> : null}

      <div>
        <b>Ayuda</b>
        <NavLink to="/tienda/carrito">Carrito</NavLink>
        <span>Env&iacute;os y entregas</span>
        <span>Cambios y devoluciones</span>
      </div>
    </footer>

    <div className="shiny-footer-legal">
      &copy; {new Date().getFullYear()} {brand} TCG &amp; Collectibles. Todos los derechos reservados.
    </div>
  </div>;
}


