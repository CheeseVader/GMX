import { brandText } from "../config/brand.js";export default function ModulePlaceholderPage({ title, phase }) {
  return (
    <section className="content-card placeholder-card">
      <div className="placeholder-symbol">◇</div>
      <div className="eyebrow">{brandText("GMX LOCAL")}</div>
      <h2>{title}</h2>
      <p>
        El módulo todavía conserva su lógica original en
        <code> legacy/apps-script/ </code> y será migrado progresivamente
        a React + Express + PostgreSQL.
      </p>
      <span className="phase-pill">{phase}</span>
    </section>);

}
