import {useEffect,useMemo,useState} from 'react';
import {api} from '../../services/api.js';
import SecureMedia from '../../components/SecureMedia.jsx';
import {tcgImage,initials} from './utils.js';

const imageKey=id=>`tournament.image.${id}`;
const positionKey=id=>`tournament.image_position.${id}`;

export default function TournamentImagePanel({tournament,games,mediaId='',imagePosition='center',onChanged}){
  const [media,setMedia]=useState([]);
  const [selected,setSelected]=useState(String(mediaId||''));
  const [position,setPosition]=useState(imagePosition||'center');
  const [uploading,setUploading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [message,setMessage]=useState('');

  async function loadMedia(){
    try{
      const r=await api('/api/v1/content/media');
      setMedia((r.data||[]).filter(x=>x.activo!==false&&(x.tipo==='IMAGE'||String(x.mime_type||'').startsWith('image/'))));
    }catch(e){setMessage(e.message)}
  }

  useEffect(()=>{setSelected(String(mediaId||''));setPosition(imagePosition||'center');loadMedia();},[tournament?.id,mediaId,imagePosition]);

  const fallback=useMemo(()=>tcgImage(tournament,games),[tournament,games]);

  async function upload(file){
    if(!file)return;
    if(!String(file.type||'').startsWith('image/'))return setMessage('Selecciona un archivo de imagen válido.');
    if(file.size>20*1024*1024)return setMessage('La imagen debe pesar máximo 20 MB.');
    setUploading(true);setMessage('');
    try{
      const token=localStorage.getItem('GMX_AUTH_TOKEN')||'';
      const response=await fetch('/api/v1/content/media/upload',{
        method:'POST',
        headers:{
          'Content-Type':'application/octet-stream',
          Authorization:`Bearer ${token}`,
          'X-GMX-File-Name':encodeURIComponent(file.name),
          'X-GMX-File-Type':file.type||'application/octet-stream',
          'X-GMX-Category':'TOURNAMENT'
        },
        body:file
      });
      const body=await response.json().catch(()=>({}));
      if(!response.ok||body.success===false)throw new Error(body.message||body.error||`HTTP ${response.status}`);
      const id=body.data?.id_media||body.data?.media?.id_media||body.data?.row?.id_media||body.id_media||'';
      if(!id)throw new Error('La Biblioteca multimedia no devolvió id_media.');
      setSelected(String(id));
      await loadMedia();
      setMessage('Imagen cargada. Pulsa Guardar imagen para asignarla al torneo.');
      window.dispatchEvent(new CustomEvent('gmx-media-library-updated'));
    }catch(e){setMessage(e.message)}
    finally{setUploading(false)}
  }

  async function save(){
    setSaving(true);setMessage('');
    try{
      await api('/api/v1/content/settings',{
        method:'PUT',
        body:JSON.stringify({
          [imageKey(tournament.id)]:String(selected||''),
          [positionKey(tournament.id)]:String(position||'center')
        })
      });
      setMessage(selected?'Imagen del torneo guardada.':'Se retiró la imagen personalizada. Se usará la imagen del TCG.');
      if(onChanged)await onChanged();
    }catch(e){setMessage(e.message)}
    finally{setSaving(false)}
  }

  return <div className="gmx-d3-image-panel">
    <div className="gmx-d3-section-title"><div><span>IMAGEN</span><h3>Imagen del torneo</h3></div></div>
    <p className="gmx-d3-image-help">La imagen personalizada tiene prioridad sobre la imagen general del TCG. Los archivos se guardan en la Biblioteca multimedia de GMX.</p>

    {message?<div className="gmx-d3-inline-message">{message}</div>:null}

    <div className="gmx-d3-image-layout">
      <div className="gmx-d3-image-preview">
        {selected?
          <SecureMedia mediaId={selected} className="gmx-d3-image-preview-img" alt={`Imagen de ${tournament.nombre}`} style={{objectPosition:position}}/>
          :fallback?<img className="gmx-d3-image-preview-img" src={fallback} alt="" style={{objectPosition:position}}/>
          :<div className="gmx-d3-image-preview-fallback">{initials(tournament.tcg_nombre||tournament.id_juego)}</div>}
        <div className="gmx-d3-image-preview-caption"><b>{tournament.nombre}</b><span>{tournament.tcg_nombre||tournament.id_juego}</span></div>
      </div>

      <div className="gmx-d3-image-controls">
        <label className="gmx-d3-upload">
          <b>{uploading?'Subiendo…':'Subir imagen nueva'}</b>
          <small>JPG, PNG o WEBP · máximo 20 MB</small>
          <input type="file" accept="image/*" disabled={uploading} onChange={e=>upload(e.target.files?.[0])}/>
        </label>

        <label>Seleccionar de Multimedia
          <select value={selected} onChange={e=>setSelected(e.target.value)}>
            <option value="">Usar imagen predeterminada del TCG</option>
            {media.map(m=><option key={m.id_media} value={m.id_media}>{m.nombre||m.nombre_archivo||m.id_media}</option>)}
          </select>
        </label>

        <label>Posición de la imagen
          <select value={position} onChange={e=>setPosition(e.target.value)}>
            <option value="center">Centro</option>
            <option value="top">Arriba</option>
            <option value="bottom">Abajo</option>
            <option value="left">Izquierda</option>
            <option value="right">Derecha</option>
          </select>
        </label>

        <div className="gmx-d3-image-actions">
          <button type="button" className="gmx-d3-secondary" onClick={()=>setSelected('')}>Quitar personalizada</button>
          <button type="button" className="gmx-d3-primary" disabled={saving||uploading} onClick={save}>{saving?'Guardando…':'Guardar imagen'}</button>
        </div>
      </div>
    </div>
  </div>
}
