import { brandText } from "../config/brand.js";import { Router } from 'express';
import { dashboardDetails, dashboardSummary } from '../repositories/dashboardRepository.js';

const router = Router();
router.get('/', async (req, res) => {
  try {
    const data = await dashboardSummary(req.query, req.access?.branchScope);
    res.setHeader('Cache-Control', 'private, max-age=10');
    res.json({ success: true, data });
  } catch (e) {
    console.error(brandText("[GMX Dashboard]"), e);
    res.status(500).json({ success: false, error: 'DASHBOARD_REQUEST_FAILED', message: e.message });
  }
});

router.get('/details/:kind', async (req,res)=>{
  try{
    const data=await dashboardDetails(req.params.kind,req.query,req.access?.branchScope);
    res.setHeader('Cache-Control','private, max-age=10');
    res.json({success:true,data});
  }catch(e){
    console.error(brandText("[GMX Dashboard detail]"),e);
    res.status(e.status||500).json({success:false,error:e.message==='DASHBOARD_DETAIL_KIND_INVALID'?e.message:'DASHBOARD_DETAIL_REQUEST_FAILED',message:e.message});
  }
});
export default router;
