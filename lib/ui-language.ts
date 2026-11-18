import { ENGLISH } from './ui-translations';
export type Language = 'en' | 'zh';
export const LANGUAGE_KEY = 'wonderline-language-v1';
// Both published frontends offer English and Chinese; English remains default.
export const CHINESE_UI_ENABLED = true;
export const BRAND = { en: 'Wonderline', zh: '一笔奇境' };
export function readLanguage(value: unknown): Language { return CHINESE_UI_ENABLED && value === 'zh' ? 'zh' : 'en'; }
/** UI copy only. Never pass a child's transcript, artwork text, or device name
 * through this function. Variables are inserted after translating the template. */
export function translateUi(language: Language, source: string, values: Record<string, string | number> = {}): string {
  let result = source;
  if (language === 'en') {
    if (Object.hasOwn(ENGLISH, source)) result = ENGLISH[source];
    else result = source.split(/(?<=[。！？])\s*/u).map(part => Object.hasOwn(ENGLISH, part) ? ENGLISH[part] : part).join(' ').trim();
  }
  return result.replace(/\{(\w+)\}/g, (match, key: string) => Object.hasOwn(values, key) ? String(values[key]) : match);
}
