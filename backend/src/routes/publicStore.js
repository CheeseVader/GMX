import { Router } from 'express';
import fs from 'node:fs';
import { optionalClientAuth } from '../middleware/clientAuth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import {
  getPublicStorefront,listPublicBranches,listPublicBranchesForItems,listPublicProducts,getPublicProduct,listPublicCategories,
  listPublicTcgGames,listPublicTcg,getPublicTcgItem,publicUnifiedSearch,publicBenefitQuote,createPublicOrder,getPublicOrder,getPublicMedia
} from '../repositories/publicStoreRepository.js';
import { publicCountries,publicStates,publicCities,publicPostalCodes,publicSettlements } from '../repositories/publicGeoRepository.js';

const router=Router();
const KNOWN_PUBLIC_ERRORS=new Set([
  'EMPTY_CART','BRANCH_REQUIRED','CUSTOMER_NAME_REQUIRED','CUSTOMER_CONTACT_REQUIRED',
  'INVALID_ITEM_TYPE','PROMO_INVALID_OR_EXPIRED','PROMO_USAGE_LIMIT_REACHED','PROMO_CLIENT_USAGE_LIMIT_REACHED',
  'PROMO_REQUIRES_IDENTIFIED_CLIENT','PROMO_NOT_VALID_FOR_CHANNEL','PROMO_NOT_VALID_FOR_BRANCH',
  'PROMO_NOT_VALID_FOR_TCG','PROMO_NOT_VALID_FOR_PRODUCTS','DELIVERY_ADDRESS_REQUIRED',
  'CARD_GATEWAY_NOT_CONFIGURED','TRANSFER_ACCOUNT_NOT_CONFIGURED','CUSTOMER_IDENTITY_CONFLICT',
  'CUSTOMER_IDENTITY_INCONSISTENT'
]);
const bad=(res,e,status=400)=>{
  const raw=String(e?.message||'PUBLIC_REQUEST_FAILED');
  const prefix=raw.split(':')[0];
  const code=KNOWN_PUBLIC_ERRORS.has(raw)||['PRODUCT_NOT_AVAILABLE','TCG_NOT_AVAILABLE','INSUFFICIENT_STOCK','INVALID_PRICE','PRICE_NOT_CONFIGURED','PROMO_MINIMUM'].includes(prefix)
    ? raw
    : 'PUBLIC_REQUEST_FAILED';
  res.status(status).json({success:false,error:code});
};


router.get('/geo/countries',async(_req,res)=>{res.json({success:true,data:await publicCountries()});});
router.get('/geo/states',async(_req,res)=>{try{res.json({success:true,data:await publicStates()});}catch(e){bad(res,e,500);}});
router.get('/geo/cities',async(req,res)=>{try{res.json({success:true,data:await publicCities(String(req.query.state||''))});}catch(e){bad(res,e,500);}});
router.get('/geo/postal-codes',async(req,res)=>{try{res.json({success:true,data:await publicPostalCodes(String(req.query.state||''),String(req.query.city||''))});}catch(e){bad(res,e,500);}});
router.get('/geo/settlements',async(req,res)=>{try{res.json({success:true,data:await publicSettlements(String(req.query.cp||''))});}catch(e){bad(res,e,500);}});

router.get('/storefront',async(_req,res)=>{try{res.json({success:true,data:await getPublicStorefront()});}catch(e){bad(res,e,500);}});
router.get('/branches',async(_req,res)=>{
  try{
    const r=await listPublicBranches();
    res.json({success:true,data:r.rows});
  }catch(e){
    bad(res,e,500);
  }
});

router.post('/branches/availability',async(req,res)=>{
  try{
    const data=await listPublicBranchesForItems(req.body?.items||[]);
    res.json({success:true,data});
  }catch(e){
    bad(res,e);
  }
});
router.get('/categories',async(_req,res)=>{try{const r=await listPublicCategories();res.json({success:true,data:r.rows});}catch(e){bad(res,e,500);}});
router.get('/products',async(req,res)=>{try{
  const r=await listPublicProducts(req.query);res.json({success:true,data:r.rows,count:r.rowCount});
}catch(e){bad(res,e,500);}});
router.get('/products/:rowId',async(req,res)=>{try{
  const r=await getPublicProduct(Number(req.params.rowId));
  if(!r)return res.status(404).json({success:false,error:'PRODUCT_NOT_FOUND'});
  res.json({success:true,data:r});
}catch(e){bad(res,e,500);}});
router.get('/tcg/games',async(_req,res)=>{try{
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
  const r=await listPublicTcgGames();
  res.json({success:true,data:r.rows});
}catch(e){bad(res,e,500);}});
router.get('/search',async(req,res)=>{try{res.json({success:true,data:await publicUnifiedSearch(req.query)});}catch(e){bad(res,e,500);}});
router.get('/tcg/item/:rowId',async(req,res)=>{try{
  const item=await getPublicTcgItem(Number(req.params.rowId));
  if(!item)return res.status(404).json({success:false,error:'TCG_NOT_FOUND'});
  res.json({success:true,data:item});
}catch(e){bad(res,e,500);}});
router.get('/tcg',async(req,res)=>{try{const r=await listPublicTcg(req.query);res.json({success:true,data:r.rows,count:r.rowCount});}catch(e){bad(res,e,500);}});
router.post('/benefits/quote',optionalClientAuth,async(req,res)=>{try{
  res.json({success:true,data:await publicBenefitQuote({...req.body,clientUser:req.clientUser||null})});
}catch(e){bad(res,e);}});
router.post('/checkout',rateLimit({keyPrefix:'PUBLIC_CHECKOUT',max:30}),optionalClientAuth,async(req,res)=>{try{
  const baseUrl=`${req.protocol}://${req.get('host')}`.replace(':8787',':5173');
  res.status(201).json({success:true,data:await createPublicOrder({...req.body,clientUser:req.clientUser||null,baseUrl})});
}catch(e){bad(res,e);}});
router.get('/orders/:token',async(req,res)=>{try{
  const r=await getPublicOrder(req.params.token);
  if(!r)return res.status(404).json({success:false,error:'ORDER_NOT_FOUND'});
  res.json({success:true,data:r});
}catch(e){bad(res,e,500);}});
router.get('/media/:id',async(req,res)=>{try{
  const file=await getPublicMedia(req.params.id);
  if(!file)return res.status(404).end();
  res.setHeader('Content-Type',file.meta.mime_type||'application/octet-stream');
  res.setHeader('Cache-Control','public, max-age=300');
  fs.createReadStream(file.filepath).pipe(res);
}catch(e){res.status(404).end();}});

export default router;
