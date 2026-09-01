import { useEffect, useState } from 'react';
import { brand } from '../config/brand.js';
import { api } from '../services/api.js';

const CACHE_KEY = 'Shiny_ADMIN_BRAND';

function normalize(value = {}) {
  const name = String(value.name || brand.shortName || brand.name || 'GMX').trim() || 'GMX';
  const logoText = String(value.logoText || name.slice(0, 1)).trim().slice(0, 4) || name.slice(0, 1);
  const descriptor = String(value.descriptor || 'LOCAL').trim().toUpperCase() || 'LOCAL';
  return { name, logoText, descriptor };
}

function cachedBrand() {
  try {
    return normalize(JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'));
  } catch {
    return normalize();
  }
}

export function saveAdminBrandCache(value) {
  const next = normalize(value);
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch {}
  return next;
}

export default function useAdminBrand() {
  const [value, setValue] = useState(cachedBrand);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const response = await api('/api/v1/content/settings?prefix=admin.appearance.');
        const settings = Object.fromEntries((response.data || []).map((row) => [row.parametro, row.valor]));
        const next = saveAdminBrandCache({
          name: settings['admin.appearance.brand_name'] || brand.shortName || brand.name,
          logoText: settings['admin.appearance.logo_text'] || String(settings['admin.appearance.brand_name'] || brand.shortName || brand.name || 'G').slice(0, 1),
          descriptor: settings['admin.appearance.brand_descriptor'] || 'LOCAL'
        });
        if (active) setValue(next);
      } catch {
        // El cache evita que una interrupción de red cambie o parpadee el logotipo.
      }
    }

    load();
    const refresh = () => load();
    window.addEventListener('tcg_store_template-theme-changed', refresh);
    return () => {
      active = false;
      window.removeEventListener('tcg_store_template-theme-changed', refresh);
    };
  }, []);

  return value;
}
