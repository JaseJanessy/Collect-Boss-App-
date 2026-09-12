const brandTokens = require('../shared/brand-tokens.json');

module.exports = ({ config }) => {
  const productionBuild = process.env.EAS_BUILD_PROFILE === 'production';
  const pocketBrandBuild = process.env.EXPO_PUBLIC_PRODUCT_BRAND === 'pocket';
  const icon = pocketBrandBuild ? './assets/brand/pocket-icon.png' : './assets/brand/icon.png';
  const adaptiveForeground = pocketBrandBuild ? './assets/brand/pocket-adaptive-foreground.png' : './assets/brand/adaptive-foreground.png';
  const adaptiveMonochrome = pocketBrandBuild ? './assets/brand/pocket-adaptive-monochrome.png' : './assets/brand/adaptive-monochrome.png';
  const favicon = pocketBrandBuild ? './assets/brand/pocket-favicon.png' : './assets/brand/favicon.png';
  const splashWordmark = pocketBrandBuild ? './assets/brand/pocket-splash-wordmark.png' : './assets/brand/splash-wordmark.png';
  const required = ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_API_BASE_URL', 'EXPO_PUBLIC_EAS_PROJECT_ID'];
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (productionBuild && missing.length) {
    throw new Error(`[CollectBoss mobile] Production build blocked: missing ${missing.join(', ')}.`);
  }
  return {
    ...config,
    icon,
    ios: {
      ...config.ios,
      icon,
    },
    android: {
      ...config.android,
      adaptiveIcon: {
        ...config.android?.adaptiveIcon,
        backgroundColor: brandTokens.brand.navy,
        foregroundImage: adaptiveForeground,
        monochromeImage: adaptiveMonochrome,
      },
    },
    web: {
      ...config.web,
      favicon,
    },
    plugins: [
      ...(config.plugins ?? []).filter((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) !== 'expo-splash-screen'),
      ['expo-splash-screen', {
        backgroundColor: brandTokens.background,
        image: splashWordmark,
        imageWidth: 240,
      }],
    ],
    extra: {
      ...config.extra,
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
      pdfMaxBytes: Number(process.env.EXPO_PUBLIC_PDF_MAX_BYTES) || 10 * 1024 * 1024,
      pdfMaxPages: Number(process.env.EXPO_PUBLIC_PDF_MAX_PAGES) || 100,
      eas: { ...config.extra?.eas, projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID },
    },
  };
};
