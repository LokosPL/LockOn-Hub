export type UiTheme = 'graphite' | 'carbon' | 'midnight';
export type UiScale = 'auto' | 'compact' | 'comfortable' | 'large';

export interface UiPreferences {
  theme: UiTheme;
  scale: UiScale;
}

const THEME_KEY = 'lockon.ui.theme';
const SCALE_KEY = 'lockon.ui.scale';

const validThemes = new Set<UiTheme>(['graphite', 'carbon', 'midnight']);
const validScales = new Set<UiScale>(['auto', 'compact', 'comfortable', 'large']);

export const loadUiPreferences = (): UiPreferences => {
  const themeValue = localStorage.getItem(THEME_KEY) as UiTheme | null;
  const scaleValue = localStorage.getItem(SCALE_KEY) as UiScale | null;
  return {
    theme: themeValue && validThemes.has(themeValue) ? themeValue : 'graphite',
    scale: scaleValue && validScales.has(scaleValue) ? scaleValue : 'auto'
  };
};

export const applyTheme = (theme: UiTheme) => {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
};

export const applyScale = async (scale: UiScale) => {
  localStorage.setItem(SCALE_KEY, scale);
  await window.lockOn.ui.setScale(scale);
};

export const applyStoredUiPreferences = async () => {
  const preferences = loadUiPreferences();
  applyTheme(preferences.theme);
  await applyScale(preferences.scale);
  return preferences;
};
