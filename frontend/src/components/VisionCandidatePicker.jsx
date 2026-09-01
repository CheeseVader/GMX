export default function VisionCandidatePicker({
  open,
  title='Coincidencias encontradas',
  subtitle='Confirma el artículo correcto antes de continuar.',
  items=[],
  onPick,
  onClose,
  emptyText='No encontramos una coincidencia suficientemente clara.'
}){
  if(!open)return null;
  return <div className="modal-backdrop shiny-vision-backdrop">
    <div className="modal shiny-vision-modal" onMouseDown={e=>e.stopPropagation()}>
      <div className="modal-head">
        <div><div className="eyebrow">GMX VISION</div><h2>{title}</h2><p className="section-copy">{subtitle}</p></div>
        <button type="button" className="icon-btn" onClick={onClose}>×</button>
      </div>
      {items.length?<div className="shiny-vision-results">
        {items.map((x,i)=><article className="shiny-vision-result" key={x.key||`${x.kind||'ITEM'}-${x.id||i}`}>
          <div>
            <strong>{x.name||x.nombre||x.carta||x.sku||'Artículo'}</strong>
            <small>{[
              x.sku,
              x.secondary,
              x.numero_completo,
              x.set_nombre,
              x.rareza,
              x.score!=null?`Coincidencia ${Math.round(Number(x.score)*100)}%`:''
            ].filter(Boolean).join(' · ')}</small>
          </div>
          <button type="button" onClick={()=>onPick?.(x)}>Seleccionar</button>
        </article>)}
      </div>:<div className="public-empty">{emptyText}</div>}
      <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cerrar</button></div>
    </div>
  </div>;
}
