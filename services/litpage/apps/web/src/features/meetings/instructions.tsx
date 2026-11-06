// Summary instructions: the block's "Instructions: Auto ⌄" dropdown — Auto,
// built-in instructions by meeting type, the person's custom instruction pages, "+ Add custom instructions" — with
// "•••" per item: Set as default (Default pill), Edit instructions (custom pages), Remove from menu. The choice is the
// block's format.meeting_instructions; it applies to the next summary ("Retry summary" redoes the current one).
// Also: page ••• › Use with AI › "Use as AI meeting instruction" and the "+ Add to my instructions" banner on shared
// instruction pages.
import { create } from 'zustand';
import type { BlockRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { api } from '../../lib/api.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { navigate, peekUrl } from '../../lib/router.ts';
import { run, setFormat } from '../../lib/blocks.ts';
import { openMenu, type MenuDef, type MenuItemDef } from '../../components/Menu.tsx';
import { Icon } from '../../components/Icon.tsx';
import { t } from '../shell/i18n.ts';

export interface InstructionsList {
  builtins: { key: string; name: string; icon: string }[];
  custom: { pageId: string; available: boolean }[];
  defaultKey: string;
}

interface Store extends InstructionsList {
  loaded: boolean;
  load(force?: boolean): Promise<void>;
}

let inflight: Promise<void> | null = null;

export const useInstructions = create<Store>((set, get) => ({
  builtins: [], custom: [], defaultKey: 'auto', loaded: false,
  load(force) {
    if (get().loaded && !force) return Promise.resolve();
    if (inflight && !force) return inflight;
    inflight = api<InstructionsList & { recordMap: any }>('meetingInstructions', {})
      .then((r) => {
        records.mergeRecordMap(r.recordMap);
        set({ builtins: r.builtins, custom: r.custom, defaultKey: r.defaultKey, loaded: true });
      })
      .catch(() => set({ loaded: true }))
      .finally(() => { inflight = null; });
    return inflight;
  },
}));

function pageName(pageId: string): string {
  const b = records.get<BlockRecord>('block', pageId);
  return toPlainText(b?.properties?.title).trim() || t('lp.meetings.untitled', 'Untitled');
}

/** Display name of the block's current instructions (unreadable custom pages show as Auto). */
export function instructionsLabel(key: string | undefined): string {
  const s = useInstructions.getState();
  const k = key || s.defaultKey || 'auto';
  if (k === 'auto') return t('lp.meetings.auto', 'Auto');
  const b = s.builtins.find((x) => x.key === k);
  if (b) return b.name;
  const c = s.custom.find((x) => x.pageId === k);
  if (c && !c.available) return t('lp.meetings.auto', 'Auto');
  return records.get<BlockRecord>('block', k) ? pageName(k) : t('lp.meetings.auto', 'Auto');
}

function setBlockInstructions(blockId: string, key: string, hasSummary: boolean) {
  run('meetingNotes.setInstructions', (tx) => setFormat(tx, blockId, { meeting_instructions: key } as never));
  if (hasSummary) {
    useUI.getState().toast(t('lp.meetings.instructions_updated_they_apply_to_the', 'Instructions updated. They apply to the next summary.'), {
      label: t('lp.meetings.retry_summary', 'Retry summary'),
      run: () => void import('./MeetingNotes.block.tsx').then((m) => m.retrySummary(blockId)),
    });
  }
}

async function setDefault(key: string) {
  await api('meetingUpdateInstructions', { defaultKey: key });
  await useInstructions.getState().load(true);
}

async function removeFromMenu(pageId: string) {
  try {
    await api('meetingUpdateInstructions', { remove: pageId });
    await useInstructions.getState().load(true);
  } catch {
    useUI.getState().toast(t('lp.meetings.this_summary_instruction_couldn_t_be', 'This summary instruction couldn’t be removed. Try again in a moment.'));
  }
}

function openInstructionsPage(pageId: string) {
  navigate(peekUrl(pageId, 'side_peek'));
}

export async function addCustomInstructions(): Promise<string | null> {
  const spaceId = useSession.getState().spaceId;
  try {
    const r = await api<{ pageId: string; recordMap: any }>('meetingCreateInstructions', { spaceId });
    records.mergeRecordMap(r.recordMap);
    await useInstructions.getState().load(true);
    openInstructionsPage(r.pageId);
    return r.pageId;
  } catch {
    useUI.getState().toast(t('lp.meetings.the_template_for_custom_summary_instruct', 'The template for custom summary instructions didn’t load. Try once more.'));
    return null;
  }
}

/** The dropdown at the bottom of the block. */
export function openInstructionsMenu(anchor: HTMLElement, block: BlockRecord, opts: { readOnly: boolean; hasSummary: boolean }) {
  const s = useInstructions.getState();
  const current = ((block.format as Record<string, unknown> | undefined)?.meeting_instructions as string | undefined) || s.defaultKey || 'auto';
  const defaultPill = <span className="nc-mtg-pill-default">{t('lp.meetings.default', 'Default')}</span>;
  const more = (key: string, custom: boolean) => (): MenuDef => ({
    width: 220,
    sections: [{
      items: [
        { label: t('lp.meetings.make_default', 'Make default'), icon: 'checkmarkSmall', disabled: s.defaultKey === key, onSelect: () => void setDefault(key) },
        ...(custom ? [
          { label: t('lp.meetings.edit_instructions', 'Edit instructions'), icon: 'pencil', onSelect: () => openInstructionsPage(key) },
          { label: t('lp.meetings.take_out_of_menu', 'Take out of menu'), icon: 'trash', onSelect: () => void removeFromMenu(key) },
        ] : []),
      ],
    }],
  });
  const row = (key: string, label: string, icon: string | undefined, custom: boolean): MenuItemDef => ({
    label: <span className="nc-mtg-instr-row"><span className="nm">{label}</span>{s.defaultKey === key && defaultPill}</span>,
    text: label,
    icon: icon ? <span style={{ fontSize: 15, width: 20, textAlign: 'center' }}>{icon}</span> : 'page',
    checked: current === key,
    disabled: opts.readOnly,
    onSelect: () => setBlockInstructions(block.id, key, opts.hasSummary),
    // "•••" (Set as default / Edit instructions / Remove from menu) is its own button: the row itself selects
    right: opts.readOnly ? undefined : (
      <span
        role="button"
        className="nc-mtg-instr-more"
        aria-label={t('lp.meetings.more_options_for', 'More actions for {name}', { name: label })}
        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onClick={(e) => { e.stopPropagation(); openMenu(e.currentTarget as HTMLElement, more(key, custom)(), { placement: 'right-start', offset: 4 }); }}
      >
        <Icon name="ellipsisSmall" size={16} />
      </span>
    ),
  });
  openMenu(anchor, {
    width: 280,
    sections: [
      {
        title: t('lp.meetings.summary_instructions', 'Summary instructions'),
        items: [
          row('auto', t('lp.meetings.auto', 'Auto'), '✨', false),
          ...s.builtins.map((b) => row(b.key, b.name, b.icon, false)),
          ...s.custom.filter((c) => c.available).map((c) => row(c.pageId, pageName(c.pageId), undefined, true)),
        ],
      },
      ...(opts.readOnly ? [] : [{
        items: [{ label: t('lp.meetings.add_your_own_instructions', 'Add your own instructions'), icon: 'plus', onSelect: () => void addCustomInstructions() }],
      }]),
    ],
  }, { placement: 'top-start', offset: 4, onClose: () => anchor.classList.remove('open') });
  anchor.classList.add('open');
}

/** Page ••• › Use with AI › Use as AI meeting instruction. */
export async function markAsMeetingInstructions(pageId: string) {
  try {
    await api('meetingAddInstructions', { pageId, mark: true });
    await useInstructions.getState().load(true);
    useUI.getState().toast(t('lp.meetings.set_as_ai_meeting_instructions', 'Set as AI meeting instructions'));
  } catch (e) {
    useUI.getState().toast((e as Error).message || t('lp.meetings.this_summary_instruction_wasn_t_saved', 'This summary instruction wasn’t saved. Give it another try.'));
  }
}

/** Banner of an instructions page: "This page contains AI Meeting Notes summary instructions." (+ Add to my instructions). */
export function InstructionsBanner({ pageId }: { pageId: string }) {
  const page = records.get<BlockRecord>('block', pageId);
  const mine = useInstructions((s) => s.custom.some((c) => c.pageId === pageId));
  const loaded = useInstructions((s) => s.loaded);
  if (!(page?.format as Record<string, unknown> | undefined)?.meeting_instruction) return null;
  if (!loaded) void useInstructions.getState().load();
  return (
    <div className="nc-mtg-banner" role="note" style={{ margin: '0 0 12px' }}>
      <Icon name="paperMicrophone" size={16} style={{ color: 'var(--lp-icon-secondary)', marginTop: 1 }} />
      <div className="grow">
        <div>{t('lp.meetings.instructions_for_summarizing_ai_meeting', 'Instructions for summarizing Meeting notes with AI live on this page.')}</div>
        <div className="sub">
          {mine
            ? t('lp.meetings.the_content_here_will_shape_your', 'The content here will shape your Meeting notes with AI summaries.')
            : t('lp.meetings.to_use_this_page_in_meetings', 'To use this page in meetings, add it to your instructions menu.')}
        </div>
      </div>
      {!mine && (
        <button className="nc-blk-btn outline" onClick={async () => {
          try {
            await api('meetingAddInstructions', { pageId });
            await useInstructions.getState().load(true);
          } catch {
            useUI.getState().toast(t('lp.meetings.this_summary_instruction_wasn_t_saved', 'This summary instruction wasn’t saved. Give it another try.'));
          }
        }}>
          <Icon name="plus" size={14} />
          {t('lp.meetings.add_to_my_instruction_list', 'Add to my instruction list')}
        </button>
      )}
    </div>
  );
}
