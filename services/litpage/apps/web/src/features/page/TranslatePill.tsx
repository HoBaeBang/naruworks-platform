// "Translate to {language}" pill in the topbar: shown when the page's text is in a different language than the
// UI locale; click → Litpage AI translate
// (dispatches `nc:ask-ai` with skill "Translate"); × dismisses the suggestion for this page.
import { useState } from 'react';
import { toPlainText } from '@nc/shared/richtext.ts';
import { Icon } from '../../components/Icon.tsx';
import { getBlock } from '../../lib/blocks.ts';
import { useBlock, useTableVersion } from '../../lib/hooks.ts';
import { getLocale, t } from '../shell/i18n.ts';
import { translatePage } from './PageMenu.tsx';

const KEY = 'nc:translateDismissed';
function dismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

/** Rough script detection over the title + first blocks: 'ko' | 'ja' | 'zh' | 'latin' | null. */
export function pageScript(pageId: string): string | null {
  const page = getBlock(pageId);
  if (!page) return null;
  let text = toPlainText(page.properties?.title);
  for (const id of (page.content ?? []).slice(0, 40)) text += ` ${toPlainText(getBlock(id)?.properties?.title)}`;
  const count = (re: RegExp) => text.match(re)?.length ?? 0;
  const ko = count(/\p{Script=Hangul}/gu);
  const ja = count(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu);
  const zh = count(/\p{Script=Han}/gu);
  const latin = count(/[A-Za-z]/g);
  const total = ko + ja + zh + latin;
  if (total < 24) return null;
  const best = Math.max(ko, ja, zh, latin);
  if (best / total < 0.6) return null;
  return best === ko ? 'ko' : best === ja ? 'ja' : best === zh ? 'zh' : 'latin';
}

const LANG_NAMES: Record<string, string> = {
  ko: 'Korean', ja: 'Japanese', zh: 'Chinese', en: 'English', fr: 'French', de: 'German', es: 'Spanish', pt: 'Portuguese',
  it: 'Italian', nl: 'Dutch', ru: 'Russian', vi: 'Vietnamese', th: 'Thai', id: 'Indonesian', tr: 'Turkish',
};

/** Target language for the suggestion: the first preferred language (UI locale, then browser languages)
 *  that differs from the page's script — e.g. an English page for a reader whose browser prefers Korean. */
export function translateTarget(pageId: string): string | null {
  const script = pageScript(pageId);
  if (!script) return null;
  const pageLang = script === 'latin' ? 'en' : script;
  const prefs = [getLocale(), ...(typeof navigator !== 'undefined' ? navigator.languages ?? [] : [])]
    .map((l) => String(l || '').toLowerCase().split('-')[0])
    .filter((l) => !!LANG_NAMES[l]);
  for (const l of prefs) {
    if (l === pageLang) continue;
    // a latin page in another latin language can't be told apart from English; only suggest across scripts
    if (script === 'latin' && !['ko', 'ja', 'zh', 'ru', 'th'].includes(l)) continue;
    return LANG_NAMES[l];
  }
  return null;
}

export function TranslatePill({ pageId, compact }: { pageId: string; compact?: boolean }) {
  useBlock(pageId);
  useTableVersion(['block']);
  const [hidden, setHidden] = useState(() => dismissed().includes(pageId));
  if (hidden) return null;
  const target = translateTarget(pageId);
  if (!target) return null;
  const label = t('lp.page.translate_to', 'Translate to {language}', { language: target });
  return (
    <div className={`nc-translate-pill ${compact ? 'compact' : ''}`} role="button" aria-label={target} data-tooltip={compact ? label : undefined} onClick={() => translatePage(pageId, target)}>
      <Icon name="translate" size={16} />
      {!compact && <span>{label}</span>}
      <div
        role="button"
        className="close"
        aria-label={t('lp.page.close_translation_suggestion', 'Close translation suggestion')}
        onClick={(e) => {
          e.stopPropagation();
          try {
            localStorage.setItem(KEY, JSON.stringify([...dismissed(), pageId].slice(-200)));
          } catch {
            /* ignore */
          }
          setHidden(true);
        }}
      >
        <Icon name="close" size={14} />
      </div>
    </div>
  );
}
