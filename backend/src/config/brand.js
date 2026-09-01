import brandConfig from '../../../brand.config.json' with { type: 'json' };

const readEnv = (key, fallback) => {
  const value = process.env[key];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
};

export const brand = Object.freeze({
  name: readEnv('APP_NAME', brandConfig.name || 'GMX'),
  shortName: readEnv('APP_SHORT_NAME', brandConfig.shortName || brandConfig.name || 'GMX'),
  legalName: readEnv('APP_LEGAL_NAME', brandConfig.legalName || brandConfig.name || 'GMX'),
  description: readEnv('APP_DESCRIPTION', brandConfig.description || 'Plataforma de administración TCG'),
  posName: readEnv('APP_POS_NAME', brandConfig.posName || `${brandConfig.name || 'GMX'} POS`),
  visionName: readEnv('APP_VISION_NAME', brandConfig.visionName || `${brandConfig.name || 'GMX'} Vision`),
  emailFromName: readEnv('APP_EMAIL_FROM_NAME', brandConfig.emailFromName || brandConfig.name || 'GMX'),
  currency: readEnv('APP_CURRENCY', brandConfig.currency || 'MXN'),
  locale: readEnv('APP_LOCALE', brandConfig.locale || 'es-MX'),
  timezone: readEnv('APP_TIMEZONE', brandConfig.timezone || 'America/Tijuana')
});

export function brandText(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/\bShiny Vision\b/g, brand.visionName)
    .replace(/\bShiny POS\b/g, brand.posName)
    .replace(/\bShiny\b/g, brand.name);
}
