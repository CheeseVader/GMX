import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { brandText } from '../../config/brand.js';
import { usePublicStore } from '../../contexts/PublicStoreContext.jsx';
import PublicIcon from '../../components/public/PublicIcon.jsx';

function valueLabel(promotion = {}) {
  const type = String(promotion.tipo || '').toUpperCase();
  if (type === 'PORCENTAJE') return `${Number(promotion.valor || 0)}% de descuento`;
  if (type === 'MONTO') return `$${Number(promotion.valor || 0).toLocaleString('es-MX')} de descuento`;
  if (type.includes('PUNTO')) return `${Number(promotion.valor || 2)}x puntos GMX`;
  return 'Beneficio exclusivo';
}

function expiryLabel(value) {
  if (!value) return 'Sin fecha de término';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Vigencia disponible en términos';
  return `Válida hasta ${date.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
}

function countdown(value) {
  const end = value ? new Date(value).getTime() : 0;
  const difference = Math.max(0, end - Date.now());
  return {
    days: String(Math.floor(difference / 86400000)).padStart(2, '0'),
    hours: String(Math.floor((difference / 3600000) % 24)).padStart(2, '0'),
    minutes: String(Math.floor((difference / 60000) % 60)).padStart(2, '0')
  };
}

export default function StorePromotionsPage() {
  const { store } = usePublicStore();
  const rows = store?.promotions || [];
  const [filter, setFilter] = useState('all');
  const [copied, setCopied] = useState('');
  const featured = rows[0] || null;
  const timer = countdown(featured?.fin);

  const visible = useMemo(() => rows.filter((promotion) => {
    const type = String(promotion.tipo || '').toUpperCase();
    if (filter === 'coupon') return Boolean(promotion.codigo);
    if (filter === 'discount') return type === 'PORCENTAJE' || type === 'MONTO';
    return true;
  }), [rows, filter]);

  async function copyCode(code) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      window.setTimeout(() => setCopied(''), 1600);
    } catch {
      setCopied('');
    }
  }

  return <main className="public-page shiny-promotions-page">
    <div className="public-page-head shiny-promotions-head"><small>{brandText('OFERTAS GMX')}</small><h1>Promociones</h1><p>Aprovecha beneficios exclusivos en cartas, accesorios y productos sellados.</p></div>

    <section className="shiny-featured-promotion">
      <div className="shiny-featured-copy">
        <span className="shiny-feature-badge">{featured ? valueLabel(featured) : 'Beneficios para coleccionistas'}</span>
        <h2>{featured?.nombre || 'Semana del coleccionista'}</h2>
        <p>{featured ? 'Campaña vigente administrada directamente desde Shiny.' : 'Explora el catálogo y descubre las próximas ofertas de la comunidad Shiny.'}</p>
        {featured?.fin ? <div className="shiny-countdown"><span><b>{timer.days}</b><small>Días</small></span><span><b>{timer.hours}</b><small>Horas</small></span><span><b>{timer.minutes}</b><small>Min</small></span></div> : null}
        <Link to="/tienda/catalogo">Ver productos <PublicIcon name="arrow" size={17}/></Link>
      </div>
      <div className="shiny-promo-art" aria-hidden="true"><div className="shiny-promo-deck"/><div className="shiny-promo-card one"/><div className="shiny-promo-card two"/><div className="shiny-promo-box">Shiny</div></div>
    </section>

    <section className="shiny-promo-benefits">
      <article><PublicIcon name="truck" size={34}/><span><b>Envío gratis desde $999</b><small>En compras elegibles a todo México.</small><Link to="/tienda/catalogo">Ver productos <PublicIcon name="arrow" size={13}/></Link></span></article>
      <article><PublicIcon name="tag" size={34}/><span><b>Accesorios seleccionados</b><small>Fundas, deck boxes y protección.</small><Link to="/tienda/catalogo">Ver accesorios <PublicIcon name="arrow" size={13}/></Link></span></article>
    </section>

    <section className="shiny-active-promotions">
      <div className="public-section-head"><div><small>BENEFICIOS VIGENTES</small><h2>Ofertas activas</h2></div><span className="shiny-public-result-count">{visible.length} promoción{visible.length === 1 ? '' : 'es'}</span></div>
      <div className="shiny-promotion-filters">
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Todas</button>
        <button className={filter === 'discount' ? 'active' : ''} onClick={() => setFilter('discount')}>Descuentos</button>
        <button className={filter === 'coupon' ? 'active' : ''} onClick={() => setFilter('coupon')}>Cupones</button>
      </div>

      {visible.length ? <div className="promo-public-grid shiny-promo-grid">{visible.map((promotion, index) => <article key={promotion.row_id || promotion.id || index} className="promo-public-card shiny-promo-card-item">
        <div className="shiny-promo-card-visual"><span>-{String(promotion.tipo || '').toUpperCase() === 'PORCENTAJE' ? `${Number(promotion.valor || 0)}%` : 'Shiny'}</span><div className="shiny-mini-deck"/></div>
        <div className="shiny-promo-card-body"><span className="promo-type">{promotion.tipo || 'PROMOCIÓN'}</span><h2>{promotion.nombre}</h2><strong>{valueLabel(promotion)}</strong><small>{expiryLabel(promotion.fin)}</small>
          {promotion.codigo ? <button className="shiny-inline-code" onClick={() => copyCode(promotion.codigo)}><span>{promotion.codigo}</span><PublicIcon name={copied === promotion.codigo ? 'check' : 'copy'} size={16}/></button> : null}
          <Link to="/tienda/catalogo">Ver productos <PublicIcon name="arrow" size={15}/></Link>
        </div>
      </article>)}</div> : <div className="shiny-empty-state shiny-promo-empty"><div className="shiny-empty-icon"><PublicIcon name="tag" size={29}/></div><h2>{rows.length ? 'No hay promociones de este tipo' : 'Próximamente habrá nuevas promociones'}</h2><p>{rows.length ? 'Selecciona otra categoría para consultar los beneficios vigentes.' : 'El catálogo sigue disponible y aquí publicaremos las siguientes campañas Shiny.'}</p><Link to="/tienda/catalogo">Explorar catálogo</Link></div>}
    </section>

    {rows.find((promotion) => promotion.codigo) ? (() => {
      const coupon = rows.find((promotion) => promotion.codigo);
      return <section className="shiny-coupon-band"><div className="shiny-coupon-icon"><PublicIcon name="tag" size={28}/></div><div><b>Cupón disponible</b><small>Utiliza el código durante el checkout, sujeto a la vigencia de la promoción.</small></div><code>{coupon.codigo}</code><button onClick={() => copyCode(coupon.codigo)}>{copied === coupon.codigo ? 'Código copiado' : 'Copiar código'}</button><small>{expiryLabel(coupon.fin)}</small></section>;
    })() : null}

    <section className="shiny-promo-bottom">
      <article><PublicIcon name="mail" size={34}/><div><h2>Recibe próximas promociones</h2><p>Crea tu cuenta para consultar beneficios y pedidos Shiny.</p><Link to="/tienda/cuenta">Ingresar / Crear cuenta</Link></div></article>
          <article><PublicIcon name="star" size={34}/><div><h2>Fidelidad GMX</h2><p>Compra, acumula puntos y obtÃ©n recompensas exclusivas.</p><div className="shiny-loyalty-progress"><i/></div><Link to="/tienda/cuenta">Conoce los beneficios</Link></div></article>
</section>
  </main>;
}
