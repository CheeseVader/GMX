import brandConfig from '../../../brand.config.json';

const readEnv = (key, fallback) => {
  const value = import.meta.env?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
};

export const brand = Object.freeze({
  name: readEnv('VITE_APP_NAME', brandConfig.name || 'GMX'),
  shortName: readEnv('VITE_APP_SHORT_NAME', brandConfig.shortName || brandConfig.name || 'GMX'),
  legalName: readEnv('VITE_APP_LEGAL_NAME', brandConfig.legalName || brandConfig.name || 'GMX'),
  description: readEnv('VITE_APP_DESCRIPTION', brandConfig.description || 'Plataforma de administración TCG'),
  posName: readEnv('VITE_APP_POS_NAME', brandConfig.posName || `${brandConfig.name || 'GMX'} POS`),
  visionName: readEnv('VITE_APP_VISION_NAME', brandConfig.visionName || `${brandConfig.name || 'GMX'} Vision`),
  primaryColor: readEnv('VITE_APP_PRIMARY_COLOR', brandConfig.primaryColor || '#121620'),
  secondaryColor: readEnv('VITE_APP_SECONDARY_COLOR', brandConfig.secondaryColor || '#ffffff'),
  accentColor: readEnv('VITE_APP_ACCENT_COLOR', brandConfig.accentColor || '#d4af37'),
  logo: readEnv('VITE_APP_LOGO', brandConfig.logo || '/branding/logo.png'),
  favicon: readEnv('VITE_APP_FAVICON', brandConfig.favicon || '/branding/favicon.png'),
  currency: readEnv('VITE_APP_CURRENCY', brandConfig.currency || 'MXN'),
  locale: readEnv('VITE_APP_LOCALE', brandConfig.locale || 'es-MX'),
  timezone: readEnv('VITE_APP_TIMEZONE', brandConfig.timezone || 'America/Tijuana')
});

export function brandText(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/\bShiny Vision\b/g, brand.visionName)
    .replace(/\bShiny POS\b/g, brand.posName)
    .replace(/\bShiny\b/g, brand.name);
}

export function applyDocumentBrand() {
  if (typeof document === 'undefined') return;
  document.title = brandText(document.title || brand.name);
  document.documentElement.dataset.appBrand = brand.shortName;
  document.documentElement.style.setProperty('--brand-primary', brand.primaryColor);
  document.documentElement.style.setProperty('--brand-secondary', brand.secondaryColor);
  document.documentElement.style.setProperty('--brand-accent', brand.accentColor);
  let favicon = document.querySelector('link[rel="icon"]');
  if (!favicon) {
    favicon = document.createElement('link');
    favicon.rel = 'icon';
    document.head.appendChild(favicon);
  }
  favicon.href = brand.favicon;
}
