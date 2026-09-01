import { brandText, applyDocumentBrand } from "./config/brand.js";import { registerSW } from 'virtual:pwa-register';

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    const acceptUpdate = window.confirm(brandText("Hay una nueva version de GMX disponible. ¿Deseas actualizar ahora?")

    );
    if (acceptUpdate) updateSW(true);
  }
});
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App.jsx';
import './styles.css';
import './phase3.css';
import './phase4.css';
import './phase5.css';
import './phase6.css';
import './phase7.css';
import './phase8.css';
import './phase9.css';
import './phase10.css';
import './phase10_1.css';
import './phase10_3.css';
import './phase10_4.css';
import './phase10_5.css';
import './phase10_5_1.css';
import './phase10_5_2.css';
import './phase10_5_3.css';
import './phase10_5_4.css';
import './phase10_5_5.css';
import './phase10_5_8.css';

import './phase10_6_public.css';
import './phase10_6_1.css';
import './phase10_6_2.css';
import './phase10_6_2_2.css';
import './phase10_6_2_3.css';
import './phase10_6_2_3_3.css';
import './phase10_6_2_3_7.css';
import './phase10_6_2_3_8.css';

applyDocumentBrand();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><BrowserRouter><App /></BrowserRouter></React.StrictMode>
);

import './phase10_6_2_3_10.css';

import './phase10_6_2_3_11.css';

import './phase10_6_2_3_12.css';

import './phase10_6_2_3_13.css';

import './phase10_6_2_3_14.css';

import './phase10_6_2_3_15.css';

import './phase10_6_2_3_16.css';

import './phase10_6_2_3_17.css';

import './phase10_6_2_3_18.css';

import './phase10_6_2_4_1.css';

import './phase10_6_2_4_1_1.css';

import './phase10_6_2_4_1_3.css';

import './phase10_6_2_4_1_4.css';

import './phase10_6_2_4_1_4_1.css';

import './phase10_6_2_4_1_5.css';

import './phase10_6_2_4_1_5_1.css';

import './phase10_6_2_4_1_6.css';

import './phase10_6_2_4_1_7.css';

import './phase10_6_2_4_1_8.css';

import './phase10_6_2_4_1_9.css';

import './phase10_6_2_4_1_9_2.css';

import './phase10_6_2_4_1_9_2_2.css';

import './phase10_6_2_4_1_10.css';

import './phase10_6_2_4_1_11.css';

import './phase10_6_2_4_1_12.css';

import './phase10_6_2_4_1_12_1_4.css';

import './phase10_6_2_4_1_12_1_5.css';

import './phase10_6_2_4_1_12_1_6.css';

import './phase10_6_2_4_1_12_1_7.css';

import './phase10_6_2_4_1_12_1_8.css';

import './phase10_6_2_4_1_12_1_9.css';
import './phase10_6_2_4_1_12_1_9_1.css';
import './phase10_6_2_4_1_12_1_9_2.css';
import './phase10_6_2_4_1_12_2_0.css';
import './phase10_6_2_4_1_12_2_0_1.css';

import './phase10_6_2_4_1_12_2_0_2.css';

import './phase10_6_2_4_1_12_2_0_3.css';

import './phase10_6_2_4_1_12_2_0_3_4.css';

import './phase10_6_2_4_1_12_2_0_3_5.css';
import './phase_shiny_visual_r20.css';
import './phase_shiny_visual_r21.css';
import './shiny_recommendations_dashboards_v4.css';
import './shiny_work_exact_r25.css';

import './shiny_ui_autofit_r54.css';