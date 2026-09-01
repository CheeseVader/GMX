import { brandText } from "../../config/brand.js";import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import PublicMedia from './PublicMedia.jsx';

function routeFor(slide) {return slide?.ruta_cta || '/tienda/catalogo';}

export default function StoreSlideshow({ slides = [], settings = {}, variant = 'hero' }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const current = slides[index] || null;
  const seconds = Math.max(2, Number(current?.intervalo_segundos || settings['public.carousel.interval_seconds'] || 6));
  const autoplay = String(settings['public.carousel.autoplay'] ?? 'true') === 'true' && current?.autoplay !== false;

  useEffect(() => {if (index >= slides.length && slides.length) setIndex(0);}, [index, slides.length]);
  useEffect(() => {
    if (slides.length < 2 || !autoplay || paused) return;
    const id = setInterval(() => setIndex((x) => (x + 1) % slides.length), seconds * 1000);
    return () => clearInterval(id);
  }, [slides.length, autoplay, paused, seconds]);

  if (!slides.length) return null;

  const mobileId = current?.id_media_mobile || current?.id_media_desktop;
  const desktopId = current?.id_media_desktop;
  const external = String(current?.media_source || 'LIBRARY').toUpperCase() === 'URL';
  const url = external ? current?.url_desktop || '' : null;

  return <section className={`public-slideshow ${variant}`} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
    <picture>
      {external && current?.url_mobile ? <source media="(max-width:700px)" srcSet={current.url_mobile} /> : null}
      {!external && mobileId ? <source media="(max-width:700px)" srcSet={`/api/public/media/${encodeURIComponent(mobileId)}`} /> : null}
      <PublicMedia mediaId={external ? null : desktopId} url={url} className="public-slide-image" alt={current.nombre || current.titulo || brandText("GMX")} />
    </picture>
    <div className="public-slide-overlay" style={{ opacity: Number(current?.overlay_opacity ?? .25) }} />
    {current?.titulo || current?.subtitulo || current?.texto_cta ? <div className={`public-slide-copy align-${String(current?.text_align || 'LEFT').toLowerCase()}`}>
      {variant === 'hero' ? <small>COLECCIONA · JUEGA · DISFRUTA</small> : null}
      {current?.titulo ? <h1>{current.titulo}</h1> : null}
      {current?.subtitulo ? <p>{current.subtitulo}</p> : null}
      {current?.texto_cta ? <Link className="public-cta" to={routeFor(current)}>{current.texto_cta}</Link> : null}
    </div> : null}
    {slides.length > 1 && current?.mostrar_flechas !== false ? <>
      <button className="public-slide-arrow prev" onClick={() => setIndex((x) => (x - 1 + slides.length) % slides.length)}>‹</button>
      <button className="public-slide-arrow next" onClick={() => setIndex((x) => (x + 1) % slides.length)}>›</button>
    </> : null}
    {slides.length > 1 && current?.mostrar_indicadores !== false ? <div className="public-slide-dots">
      {slides.map((_, i) => <button key={i} className={i === index ? 'active' : ''} onClick={() => setIndex(i)} />)}
    </div> : null}
  </section>;
}
