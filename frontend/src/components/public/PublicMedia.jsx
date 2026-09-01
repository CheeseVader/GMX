import { brandText } from "../../config/brand.js";export default function PublicMedia({ mediaId, url, className = '', alt = '', style = {} }) {
  const src = url || (mediaId ? `/api/public/media/${encodeURIComponent(mediaId)}` : '');
  if (!src) return <div className={`public-image-placeholder ${className}`}>{brandText("GMX")}</div>;
  return <img src={src} className={className} alt={alt} style={style} loading="lazy" onError={(e) => {e.currentTarget.style.display = 'none';}} />;
}
