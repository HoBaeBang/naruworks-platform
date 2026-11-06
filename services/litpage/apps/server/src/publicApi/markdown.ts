// Markdown content API: a page as Markdown and Markdown edits, read and written as the calling principal.
// The serializer is the one AI service uses (ai/prompts.ts pageToMarkdown) fed by a source that only returns what the
// principal can open — inline database rows it can't see are left out and restricted property values are redacted —
// and that renders AI Meeting Notes blocks as "## Meeting" / "### Summary · Notes · Transcript" sections with speaker
// labels and timestamps on transcript lines.
import type { BlockRecord, CollectionRecord, UserRecord } from '@nc/shared/records.ts';
import { toPlainText, type RichText } from '@nc/shared/richtext.ts';
import { getRecord } from '../db.ts';
import { pageToMarkdown, rowToMarkdown, type MdBlock, type MdCollection, type MdSource } from '../ai/prompts.ts';
import type { ReadCtx } from './objects.ts';

const SECTION_LABEL: Record<string, string> = { summary: 'Summary', notes: 'Notes', transcript: 'Transcript' };

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`;
}

/** What the principal may read, shaped for the serializer. */
export function principalMdSource(ctx: ReadCtx): MdSource {
  const title = (b: BlockRecord) => {
    if ((b.type === 'collection_view_page' || b.type === 'collection_view') && b.collection_id) {
      const n = toPlainText(getRecord<CollectionRecord>('collection', b.collection_id)?.name);
      if (n) return n;
    }
    return toPlainText(b.properties?.title).replace(/[‣⁍]/g, '').trim();
  };
  return {
    block: (id) => {
      const raw = getRecord<BlockRecord>('block', id);
      if (!raw || raw.alive === false || !ctx.canRead(raw.id)) return undefined;
      const b = raw.parent_table === 'collection' ? ctx.row(raw) : raw;
      const fmt = (b.format ?? {}) as Record<string, unknown>;
      // AI Meeting Notes: the block reads as a heading, its sections as sub-headings, transcript lines with speakers
      if (b.type === 'meeting_notes' || b.type === 'transcription') {
        return { ...b, type: 'sub_header', properties: { title: b.properties?.title?.length ? b.properties.title : [['Meeting notes']] } } as MdBlock;
      }
      const section = typeof fmt.meeting_section === 'string' ? fmt.meeting_section : '';
      if (section && SECTION_LABEL[section]) return { ...b, type: 'sub_sub_header', properties: { title: [[SECTION_LABEL[section]]] } } as MdBlock;
      if (typeof fmt.meeting_speaker === 'string' || typeof fmt.meeting_start_ms === 'number') {
        const who = typeof fmt.meeting_speaker === 'string' && fmt.meeting_speaker ? fmt.meeting_speaker : 'Speaker';
        const at = typeof fmt.meeting_start_ms === 'number' ? ` (${clock(fmt.meeting_start_ms)})` : '';
        return { ...b, properties: { title: [[`${who}${at}: `, [['b']]], ...((b.properties?.title ?? []) as RichText)] } } as MdBlock;
      }
      return b as unknown as MdBlock;
    },
    pageTitle: (id) => {
      const b = getRecord<BlockRecord>('block', id);
      if (!b || b.alive === false) return '';
      if (!ctx.canRead(id)) return 'Untitled';
      return title(b);
    },
    userName: (id) => getRecord<UserRecord>('lit_user', id)?.name || '',
    collection: (id): MdCollection | undefined => {
      const col0 = getRecord<CollectionRecord>('collection', id);
      if (!col0 || col0.alive === false || !ctx.canRead(col0.parent_id)) return undefined;
      const col = ctx.collection(col0);
      // readable rows, already redacted (viewerQueryContext)
      const rows = [...(ctx.query.rowsOf?.(id) ?? [])].sort((a, b) => a.created_time - b.created_time);
      return { name: toPlainText(col.name), schema: col.schema, rows: rows as unknown as MdBlock[] };
    },
  };
}

export const MAX_MARKDOWN_CHARS = 2_000_000;

/** GET /v1/pages/{id}/markdown */
export function pageAsMarkdown(page: BlockRecord, ctx: ReadCtx): { markdown: string; truncated: boolean } {
  const src = principalMdSource(ctx);
  if (page.parent_table === 'collection') {
    const col = getRecord<CollectionRecord>('collection', page.parent_id);
    const row = src.block(page.id) as MdBlock;
    const head = col ? rowToMarkdown(row, ctx.collection(col).schema, src, { maxChars: 200_000 }) : '';
    const body = pageToMarkdown(page.id, src, { includeTitle: false, maxChars: MAX_MARKDOWN_CHARS, maxRows: 1000 });
    return { markdown: `${head}\n\n${body.markdown}`.trim(), truncated: body.truncated };
  }
  const s = pageToMarkdown(page.id, src, { maxChars: MAX_MARKDOWN_CHARS, maxRows: 1000 });
  return { markdown: s.markdown, truncated: s.truncated };
}

/** The page's top-level blocks as Markdown units (targets of replace_content_range). */
export function pageUnitsAs(pageId: string, ctx: ReadCtx): { id: string; markdown: string }[] {
  const units: { id: string; markdown: string }[] = [];
  pageToMarkdown(pageId, principalMdSource(ctx), { includeTitle: false, units, maxRows: 0 });
  return units;
}
