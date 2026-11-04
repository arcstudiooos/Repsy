/** Theme choice, saved per user on this device (plan §8.3). "system" follows the OS setting. */
export type ThemeChoice = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'repsy-theme';
export const THEME_EVENT = 'repsy-theme-change';

export function readChoice(): ThemeChoice {
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function resolve(choice: ThemeChoice): 'light' | 'dark' {
  if (choice !== 'system') return choice;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Applies a choice to <html> and remembers it. */
export function applyChoice(choice: ThemeChoice): void {
  try {
    if (choice === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Storage blocked (private mode): the choice lasts for this page only.
  }
  document.documentElement.dataset.theme = resolve(choice);
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: choice }));
}

/**
 * Runs in <head> before first paint, so the page never flashes the wrong theme. Kept tiny and dependency-free; it
 * mirrors readChoice/resolve above and also follows OS changes while "system" is chosen.
 */
export const themeBootScript = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var m=window.matchMedia('(prefers-color-scheme: dark)');var set=function(){var v=null;try{v=localStorage.getItem(k)}catch(e){}var t=v==='light'||v==='dark'?v:(m.matches?'dark':'light');document.documentElement.dataset.theme=t};set();m.addEventListener('change',function(){var v=null;try{v=localStorage.getItem(k)}catch(e){}if(v!=='light'&&v!=='dark')set()})}catch(e){}})();`;
