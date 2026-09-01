import { Router } from 'express';
import { rateLimit } from '../middleware/rateLimit.js';
import { confirmStripeSession,saveTransferProof,transferSettings,saveTransferProofMetadata } from '../paymentService.js';
import { handleMercadoPagoWebhook } from '../paymentService.js';

const router=Router();
const known=new Set(['CARD_GATEWAY_NOT_CONFIGURED','PAYMENT_SESSION_MISMATCH','PAYMENT_SESSION_REUSE_FAILED','ORDER_ALREADY_PAID','TRANSFER_ACCOUNT_NOT_CONFIGURED','ORDER_NOT_FOUND','ORDER_NOT_TRANSFER','INVALID_PROOF_TYPE','INVALID_PROOF_SIZE']);
const bad=(res,e,status=400)=>res.status(status).json({success:false,error:known.has(e.message)?e.message:'PAYMENT_REQUEST_FAILED'});

router.post('/stripe/confirm',rateLimit({keyPrefix:'STRIPE_CONFIRM',max:40}),async(req,res)=>{
  try{res.json({success:true,data:await confirmStripeSession(String(req.body?.sessionId||''),String(req.body?.token||''))});}
  catch(e){bad(res,e);}
});
router.get('/transfer/settings',async(_req,res)=>{
  try{res.json({success:true,data:await transferSettings()});}catch(e){bad(res,e,500);}
});
router.post('/transfer/:token/proof',rateLimit({keyPrefix:'TRANSFER_PROOF',max:20}),async(req,res)=>{
  try{
    const data=await saveTransferProof(req.params.token,req.body?.file||{});
    await saveTransferProofMetadata(req.params.token,req.body?.transfer||{});
    res.json({success:true,data});
  }
  catch(e){bad(res,e);}
});



/* ============================================================
   SHINY_MP_004_WEBHOOK_ROUTE
   ============================================================ */

router.post(
  '/mercadopago/webhook',
  async(req,res)=>{

    try{

      const dataId =
        req.query?.['data.id']
        ||
        req.query?.data_id
        ||
        req.body?.data?.id
        ||
        req.body?.id
        ||
        null;

      const type =
        req.body?.type
        ||
        req.query?.type
        ||
        null;

      const action =
        req.body?.action
        ||
        req.query?.action
        ||
        null;

      const result =
        await handleMercadoPagoWebhook({
          xSignature:
            req.headers[
              'x-signature'
            ],

          xRequestId:
            req.headers[
              'x-request-id'
            ],

          dataId,
          type,
          action
        });

      return res
        .status(200)
        .json({
          success:true,
          data:result
        });

    }catch(e){

      const message =
        String(
          e?.message || e
        );

      if(
        message ===
          'MERCADOPAGO_INVALID_WEBHOOK_SIGNATURE'
        ||
        message ===
          'MERCADOPAGO_WEBHOOK_SIGNATURE_REQUIRED'
        ||
        message ===
          'MERCADOPAGO_WEBHOOK_REQUEST_ID_REQUIRED'
      ){

        return res
          .status(401)
          .json({
            success:false,
            error:message
          });
      }

      if(
        message ===
          'MERCADOPAGO_WEBHOOK_DATA_ID_REQUIRED'
      ){

        return res
          .status(400)
          .json({
            success:false,
            error:message
          });
      }

      if(
        message ===
          'MERCADOPAGO_WEBHOOK_NOT_CONFIGURED'
      ){

        return res
          .status(503)
          .json({
            success:false,
            error:message
          });
      }

      console.error(
        'MERCADOPAGO_WEBHOOK_ERROR',
        message
      );

      return res
        .status(500)
        .json({
          success:false,
          error:
            'MERCADOPAGO_WEBHOOK_FAILED'
        });
    }
  }
);

export default router;
