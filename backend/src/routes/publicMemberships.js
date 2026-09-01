import { Router } from 'express';
import { query } from '../db.js';
const router=Router();
router.get('/memberships',async(_req,res)=>{try{const r=await query(`SELECT mt.*,j.nombre tcg_nombre,j.imagen tcg_imagen,'MEMBERSHIP-'||mt.id product_id FROM gmx.membresia_tipos mt LEFT JOIN gmx.tcg_juegos j ON j.id_juego=mt.id_juego WHERE mt.activo=true ORDER BY j.nombre,mt.nombre`);res.json({success:true,data:r.rows})}catch(e){res.status(500).json({success:false,error:e.message,message:e.message})}});
router.get('/tournaments',async(req,res)=>{try{const params=[];let where=`WHERE t.estado='PROGRAMADO' AND t.fecha_inicio>=NOW()`;if(req.query.gameId){params.push(req.query.gameId);where+=` AND t.id_juego=$${params.length}`}const r=await query(`SELECT t.*,j.nombre tcg_nombre,j.imagen tcg_imagen,s.nombre_sucursal FROM gmx.torneos t LEFT JOIN gmx.tcg_juegos j ON j.id_juego=t.id_juego LEFT JOIN gmx.sucursales s ON s.id_sucursal=t.id_sucursal ${where} ORDER BY t.fecha_inicio`,params);res.json({success:true,data:r.rows})}catch(e){res.status(500).json({success:false,error:e.message,message:e.message})}});
export default router;
