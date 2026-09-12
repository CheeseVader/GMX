import { Router,raw } from 'express';
import fs from 'node:fs';
import {
  getSettings,saveSettings,listPromotions,listPromotionRedemptions,savePromotion,listNotifications,markNotification,
  generateAlerts,listMedia,saveMediaFile,mediaMeta,setMediaActive,mediaImpact,deleteMediaSafe,importMediaFromUrl,importManyMediaFromUrls
} from '../repositories/contentRepository.js';

const router=Router();
const bad=(res,e,status=400)=>res.status(status).json({success:false,error:e.message,message:e.message});

router.get('/settings',async(req,res)=>{try{const r=await getSettings(String(req.query.prefix||''));res.json({success:true,data:r.rows});}catch(e){bad(res,e,500);}});
router.put('/settings',async(req,res)=>{try{const r=await saveSettings(req.body||{},req.user);res.json({success:true,data:r.rows});}catch(e){bad(res,e);}});

router.get('/promotions',async(req,res)=>{try{const r=await listPromotions(req.query);res.json({success:true,data:r.rows});}catch(e){bad(res,e,500);}});
router.get('/promotions/redemptions',async(req,res)=>{try{
  const r=await listPromotionRedemptions(req.query);
  res.json({success:true,data:r.rows});
}catch(e){bad(res,e,500);}});
router.post('/promotions',async(req,res)=>{
  try{
    const body=req.body&&typeof req.body==='object'?req.body:{};
    const saved=await savePromotion(null,body,req.user);
    res.status(201).json({success:true,data:saved});
  }catch(e){
    console.error('[GMX][PROMOTIONS][POST]',e);
    bad(res,e);
  }
});
router.put('/promotions/:rowId',async(req,res)=>{
  try{
    const rowId=Number(req.params.rowId);
    if(!Number.isFinite(rowId)||rowId<=0)throw new Error('PROMOTION_INVALID_ROW_ID');
    const body=req.body&&typeof req.body==='object'?req.body:{};
    const saved=await savePromotion(rowId,body,req.user);
    res.json({success:true,data:saved});
  }catch(e){
    console.error('[GMX][PROMOTIONS][PUT]',e);
    bad(res,e);
  }
});

router.get('/notifications',async(req,res)=>{try{const r=await listNotifications(req.query);res.json({success:true,data:r.rows});}catch(e){bad(res,e,500);}});
router.post('/notifications/generate',async(req,res)=>{try{res.json({success:true,data:await generateAlerts(req.user)});}catch(e){bad(res,e);}});
router.post('/notifications/:rowId/read',async(req,res)=>{try{res.json({success:true,data:await markNotification(Number(req.params.rowId),req.body?.read!==false)});}catch(e){bad(res,e);}});

router.get('/media',async(req,res)=>{try{const r=await listMedia(req.query);res.json({success:true,data:r.rows});}catch(e){bad(res,e,500);}});
router.post('/media/upload',
  raw({type:'application/octet-stream',limit:process.env.SHINY_MEDIA_UPLOAD_LIMIT||'512mb'}),
  async(req,res)=>{
    try{
      const data=await saveMediaFile({
        buffer:req.body,
        name:decodeURIComponent(String(req.headers['x-shiny-file-name']||'archivo.bin')),
        mime:String(req.headers['x-shiny-file-type']||'application/octet-stream'),
        category:decodeURIComponent(String(req.headers['x-shiny-category']||'GENERAL')),
        user:req.user
      });
      res.status(201).json({success:true,data});
    }catch(e){bad(res,e);}
  }
);
router.get('/media/:id/file',async(req,res)=>{
  try{
    const m=await mediaMeta(req.params.id);
    if(!m)return res.status(404).json({success:false,error:'MEDIA_NOT_FOUND'});
    if(!m.ruta||!fs.existsSync(m.ruta))return res.status(404).json({success:false,error:'MEDIA_FILE_NOT_FOUND'});
    res.setHeader('Content-Type',m.mime_type||'application/octet-stream');
    res.setHeader('Content-Disposition',`inline; filename="${String(m.nombre_archivo||'archivo').replace(/"/g,'')}"`);
    fs.createReadStream(m.ruta).pipe(res);
  }catch(e){bad(res,e,500);}
});
router.post('/media/:id/active',async(req,res)=>{try{res.json({success:true,data:await setMediaActive(req.params.id,req.body?.active!==false)});}catch(e){bad(res,e);}});

router.post('/media/import-url',async(req,res)=>{try{
  res.json({success:true,data:await importMediaFromUrl({
    url:req.body?.url,name:req.body?.name||'',category:req.body?.category||'GENERAL',user:req.user
  })});
}catch(e){bad(res,e);}});

router.post('/media/import-urls',async(req,res)=>{try{
  res.json({success:true,data:await importManyMediaFromUrls({
    urls:Array.isArray(req.body?.urls)?req.body.urls:[],
    category:req.body?.category||'GENERAL',user:req.user
  })});
}catch(e){bad(res,e);}});

router.get('/media/:id/impact',async(req,res)=>{try{res.json({success:true,data:await mediaImpact(req.params.id)});}catch(e){bad(res,e,e.message==='MEDIA_NOT_FOUND'?404:400);}});
router.delete('/media/:id',async(req,res)=>{try{
  res.json({success:true,data:await deleteMediaSafe(req.params.id,req.user,{detach:String(req.query.detach||'').toLowerCase()==='true'})});
}catch(e){bad(res,e);}});

export default router;
