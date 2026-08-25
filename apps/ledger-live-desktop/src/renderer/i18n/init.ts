import i18n, { InitOptions } from "i18next";
import { initReactI18next } from "react-i18next";
import locales, { i18_DEFAULT_NAMESPACE } from ".";
import { DEFAULT_LANGUAGE, LanguageIds } from "~/config/languages";
import { getAppLocale } from "~/helpers/systemLocale";

/**
 * Initial UI language.
 *
 * Priority (FLEX):
 *   1. explicit user choice — handled after boot: init.tsx calls
 *      i18n.changeLanguage(languageSelector(state)), and languageSelector
 *      returns the SAVED settings language when one exists. Settings ›
 *      General › Language therefore always wins over the system.
 *   2. system language — Electron passes app.getLocale() as the `appLocale`
 *      query param (main/window-lifecycle.ts loadWindow()); we map it onto a
 *      supported LanguageIds entry so a RU Windows shows the RU interface
 *      out of the box instead of defaulting to English.
 *   3. English fallback.
 */
const getInitialLanguage = (): string => {
  try {
    const systemLocale = getAppLocale() || "";
    const match = LanguageIds.find(lang => systemLocale.toLowerCase().startsWith(`${lang}-`));
    if (match) return match;
  } catch {
    /* ignore — fall through to default */
  }
  return DEFAULT_LANGUAGE.id;
};

const config: InitOptions = {
  resources: locales,
  lng: getInitialLanguage(),
  defaultNS: i18_DEFAULT_NAMESPACE,
  fallbackLng: DEFAULT_LANGUAGE.id,
  interpolation: {
    escapeValue: false,
  },
  debug: __DEV__,
  react: {
    useSuspense: false,
  },
};

i18n.use(initReactI18next).init(config);

export default i18n;
