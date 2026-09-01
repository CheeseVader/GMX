import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { publicApi, money } from '../../services/publicApi.js';
import { useCart } from '../../contexts/CartContext.jsx';
import { useClientAuth } from '../../contexts/ClientAuthContext.jsx';
import '../../memberships_public_r4.css';

export default function StoreMembershipsPage(){
// GMX_MEMBERSHIP_SHARED_IMAGE_R3
  const membershipVisual=(x)=>String(x?.imagen||x?.tcg_imagen||'').trim();
  const membershipCardStyle=(x)=>{
    const image=membershipVisual(x);
    return image?{'--gmx-membership-bg-image':`url("${image}")`}:undefined;
  };
  const [rows,setRows]=useState([]),[error,setError]=useState('');
  const cart=useCart(),auth=useClientAuth(),nav=useNavigate();
  useEffect(()=>{publicApi('/api/public/memberships').then(r=>setRows(r.data||[])).catch(e=>setError(e.message))},[]);
  function buy(x){
    if(!auth.user){nav('/tienda/cuenta',{state:{membershipRequired:true}});return}
    cart.addItem({type:'PRODUCT',id:x.product_id,name:x.nombre,price:Number(x.precio),stock:999999,sku:x.sku,image:x.imagen||x.tcg_imagen||''},1);
    nav('/tienda/carrito');
  }
  return <main className="gmx-public-r4">
    <header className="gmx-public-r4-hero"><span>GMX MEMBERSHIP</span><h1>Membresías</h1><p>Beneficios exclusivos para tu TCG. Debes ser cliente GMX registrado previamente para adquirir una membresía.</p></header>
    {error?<div className="gmx-public-r4-error">{error}</div>:null}
    <section className="gmx-public-r4-grid">
      {rows.map(x=><article className="gmx-public-r4-card gmx-public-r4-membership-dynamic" style={membershipCardStyle(x)} key={x.id}>
        <div className="gmx-public-r4-media">{x.imagen?<img src={x.imagen} alt={x.nombre}/>:x.tcg_imagen?<img src={x.tcg_imagen} alt={x.tcg_nombre||''}/>:<div className="gmx-public-r4-placeholder">GMX</div>}<span>{x.tcg_nombre||x.id_juego}</span></div>
        <div className="gmx-public-r4-body"><h2>{x.nombre}</h2><strong>{money(x.precio)}</strong><ul><li>{Number(x.descuento_pct||0).toLocaleString('es-MX',{maximumFractionDigits:2})}% de descuento en productos del mismo TCG</li><li>{x.entradas_incluidas} accesos a torneos participantes</li><li>Máximo {x.limite_semanal} acceso por semana</li><li>Vigencia: {x.vigencia_dias} días</li><li>Credencial digital QR</li></ul>{x.notas_publicas?<p className="gmx-public-r4-note">{x.notas_publicas}</p>:null}<button type="button" onClick={()=>buy(x)}>Adquirir membresía</button></div>
      </article>)}
    </section>
    <aside className="gmx-public-r4-legal"><b>Importante</b><p>Los accesos incluidos son válidos únicamente para torneos locales o regulares participantes del TCG correspondiente. No aplican por defecto a torneos oficiales, clasificatorios, regionales, premier o eventos especiales, salvo que GMX indique expresamente lo contrario.</p></aside>
  </main>
}
