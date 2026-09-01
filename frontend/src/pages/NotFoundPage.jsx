import { brandText } from "../config/brand.js";import { Link } from 'react-router';

export default function NotFoundPage() {
  return (
    <section className="content-card placeholder-card">
      <div className="placeholder-symbol">404</div>
      <h2>Página no encontrada</h2>
      <p>{brandText("La ruta solicitada no existe dentro de GMX.")}</p>
      <Link to="/dashboard" className="button-link">Volver al dashboard</Link>
    </section>);

}
