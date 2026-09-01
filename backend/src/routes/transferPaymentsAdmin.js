import {Router} from 'express';
import {
  listTransferProofsAdmin,
  getTransferProofAdmin,
  reviewTransferProofAdmin,
  markTransferOrderReadyAdmin
} from '../paymentService.js';

const router=Router();

const bad=(res,e,status=400)=>res.status(status).json({
  success:false,
  error:String(e?.message||e||'TRANSFER_ADMIN_FAILED'),
  message:String(e?.message||e||'TRANSFER_ADMIN_FAILED')
});

router.get('/',async(req,res)=>{
  try{
    res.json({success:true,data:await listTransferProofsAdmin()});
  }catch(e){bad(res,e,500);}
});

router.get('/:rowId/proof',async(req,res)=>{
  try{
    const f=await getTransferProofAdmin(Number(req.params.rowId));
    res.type(f.mime);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${String(f.name).replace(/"/g,'')}"`
    );
    res.sendFile(f.full);
  }catch(e){bad(res,e,404);}
});

router.post('/:rowId/approve',async(req,res)=>{
  try{
    res.json({
      success:true,
      data:await reviewTransferProofAdmin(
        Number(req.params.rowId),
        'APPROVE',
        req.user,
        ''
      )
    });
  }catch(e){bad(res,e);}
});

router.post('/:rowId/reject',async(req,res)=>{
  try{
    res.json({
      success:true,
      data:await reviewTransferProofAdmin(
        Number(req.params.rowId),
        'REJECT',
        req.user,
        String(req.body?.reason||'')
      )
    });
  }catch(e){bad(res,e);}
});

router.post('/order/:orderId/ready',async(req,res)=>{
  try{
    res.json({
      success:true,
      data:await markTransferOrderReadyAdmin(
        req.params.orderId,
        req.user
      )
    });
  }catch(e){bad(res,e);}
});

export default router;