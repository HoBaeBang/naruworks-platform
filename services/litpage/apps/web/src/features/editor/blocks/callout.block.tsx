// Callout (2026 = callout_version 2: the callout has no own text, its content is child blocks).
// Block padding 8px; inner box
// display:flex r10 border 1px transparent, background var(--lp-gray-bg-primary), padding 12px; icon wrapper margin-top
// 7.5px,.lit-record-icon 24×24 r.25em, emoji 21.6px, aria-label "<icon> Change callout icon"; body
// flex column min-height 32px. Colors: <c>_background → var(--c-<c>BacSec) (blue → rgb(125, 211, 252)).
// Block menu extra: "Edit icon". Legacy callouts (no callout_version) keep their title leaf.
import type { BlockRecord } from '@nc/shared/records.ts';
import { baseColor } from '@nc/shared/colors.ts';
import { registerBlock, BlockList, type BlockProps } from '../Block.tsx';
import { createBlockIn, run, setFormat } from '../../../lib/blocks.ts';
import { openIconPicker } from '../../page/IconPicker.tsx';
import { PageIcon } from '../../shell/PageIcon.tsx';
import { useEditor } from '../editorState.ts';
import { registerBlockMenu, registerTurnInto, overrideSlashItem } from './registry.ts';
import { createCallout, turnIntoCallout } from './factories.ts';
import { Leaf } from './TextBlocks.tsx';
import { blockElement } from './shared.tsx';
import { PREF, setPref } from '../prefs.ts';

/** Callout icon. An emoji uses a 21.6px block in the UI font with line-height 1 holding an emoji-font span. The UI font strut puts the glyph 1px lower than an emoji-font block.92). Icon-set glyphs and images go through PageIcon. */
function CalloutIcon({ icon }: { icon: string }) {
  if (/^(lit-icon:|https?:|\/files\/|data:)/.test(icon)) return <PageIcon icon={icon} size={24} fallback={null} />;
  return (
    <div className="lit-record-icon notranslate nc-callout-emoji-box">
      <div className="nc-callout-emoji" role="img" aria-hidden="true">
        <span>{icon}</span>
      </div>
    </div>
  );
}

// Gray, the default callout color, is --lp-gray-bg-primary in light and --lp-gray-bg-secondary in dark
const BG: Record<string, string> = {
  gray: 'var(--nc-callout-gray-bg, var(--lp-gray-bg-primary))', brown: 'var(--lp-brown-bg-secondary)', orange: 'var(--lp-orange-bg-secondary)', yellow: 'var(--lp-yellow-bg-secondary)', green: 'var(--lp-green-bg-secondary)',
  teal: 'var(--lp-green-bg-secondary)', blue: 'var(--lp-blue-bg-secondary)', purple: 'var(--lp-purple-bg-secondary)', pink: 'var(--lp-pink-bg-secondary)', red: 'var(--lp-red-bg-secondary)',
};

function iconOf(b: BlockRecord): string | null {
  const v = b.format?.page_icon as string | undefined | null;
  if (v === '' || v === null) return null;
  return v ?? '💡';
}

export function editCalloutIcon(block: BlockRecord, anchor: HTMLElement | DOMRect) {
  openIconPicker(anchor as any, {
    current: iconOf(block) ?? undefined,
    onPick: (v) => {
      run('CalloutBlock.handleEmojiChange', (tx) => setFormat(tx, block.id, { page_icon: v ?? '' }));
      setPref(PREF.calloutIcon, v ?? ''); // new callouts on this device reuse it ("" = no icon)
    },
  });
}

function CalloutBlock({ block, depth, readOnly }: BlockProps) {
  const icon = iconOf(block);
  const color = (block.format?.block_color as string | undefined) ?? 'default';
  const isBg = color.endsWith('_background');
  const base = baseColor(color);
  const v2 = block.format?.callout_version === 2 || (!block.properties?.title && !!block.content?.length);
  const style: React.CSSProperties = {};
  let cls = '';
  if (isBg) style.background = BG[base] ?? 'var(--lp-gray-bg-primary)';
  else if (color !== 'default') cls = `colored-text lit-color-${base}`;
  return (
    <div className="nc-bpad">
      <div role="note" style={{ display: 'flex' }}>
        <div className={`nc-callout-2 ${cls}`} style={style}>
          {icon && (
            <div className="nc-callout-icon-2">
              <div className="content-editable-void-no-select">
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={`${icon.startsWith('/') || icon.startsWith('http') || icon.startsWith('lit-icon') ? '' : `${icon} `}Change callout icon`}
                  className="lit-record-icon notranslate nc-callout-icon-btn"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => !readOnly && editCalloutIcon(block, e.currentTarget)}
                >
                  <CalloutIcon icon={icon} />
                </div>
              </div>
            </div>
          )}
          <div className={`nc-callout-body-2 ${v2 ? '' : 'legacy'}`} data-gutter-host="">
            {!v2 && <Leaf block={block} readOnly={readOnly} />}
            {block.content?.length ? (
              <BlockList parentId={block.id} ids={block.content} depth={depth + 1} readOnly={readOnly} />
            ) : v2 ? (
              <div
                className="nc-callout-empty"
                style={{ minHeight: 36, cursor: 'text' }}
                onMouseDown={(e) => {
                  if (readOnly) return;
                  e.preventDefault();
                  let id = '';
                  run('callout.addChild', (tx) => { id = createBlockIn(tx, { type: 'text', parentId: block.id, parentTable: 'block' }); });
                  useEditor.getState().requestFocus(id, 0);
                }}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

registerBlock(['callout'], CalloutBlock);

registerBlockMenu(['callout'], ({ block, turnInto, color }) => [
  turnInto,
  color,
  {
    label: 'Edit icon', icon: 'iconEdit',
    onSelect: () => {
      const el = blockElement(block.id)?.querySelector('.nc-callout-icon-btn') as HTMLElement | null;
      setTimeout(() => editCalloutIcon(block, el ?? blockElement(block.id)!.getBoundingClientRect()), 0);
    },
  },
]);

overrideSlashItem('callout', createCallout);
overrideSlashItem('turn-callout', (ctx) => turnIntoCallout([ctx.blockId]));
registerTurnInto('callout', turnIntoCallout);
