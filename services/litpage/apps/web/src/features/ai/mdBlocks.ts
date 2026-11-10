
// is unit-tested (mdBlocks.test.ts) and shared by insertion (insert.ts) and previews.
import { newId } from '@nc/shared/ids.ts';
import type { BlockType } from '@nc/shared/records.ts';
import { concat, type Annotation, type RichText } from '@nc/shared/richtext.ts';
import { CODE_LANGUAGES } from '../editor/blocks/codeLanguages.ts';
import { parseInline, parseMarkdown, type MdNode, type Seg } from './md.ts';

export interface SourceLike {
  n: number;
  pageId: string;
}

const LANG_ALIASES: Record<string, string> = {
  js: 'JavaScript', jsx: 'JavaScript', javascript: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript', typescript: 'TypeScript',
  py: 'Python', python: 'Python', rb: 'Ruby', sh: 'Shell', bash: 'Bash', zsh: 'Shell', shell: 'Shell', console: 'Shell',
  yml: 'YAML', yaml: 'YAML', md: 'Markdown', markdown: 'Markdown', json: 'JSON', html: 'HTML', css: 'CSS', sql: 'SQL',
  go: 'Go', golang: 'Go', rs: 'Rust', rust: 'Rust', kt: 'Kotlin', java: 'Java', c: 'C', cpp: 'C++', 'c++': 'C++', cs: 'C#',
  csharp: 'C#', php: 'PHP', swift: 'Swift', mermaid: 'Mermaid', tex: 'LaTeX', latex: 'LaTeX', xml: 'XML', toml: 'TOML',
  dockerfile: 'Docker', docker: 'Docker', diff: 'Diff', graphql: 'GraphQL', scss: 'SCSS', sass: 'Sass', r: 'R',
  text: 'Plain Text', txt: 'Plain Text', plaintext: 'Plain Text', '': 'Plain Text',
};

export function codeLanguage(lang: string): string {
  const l = lang.trim().toLowerCase();
  if (LANG_ALIASES[l]) return LANG_ALIASES[l];
  return CODE_LANGUAGES.find((x) => x.toLowerCase() === l) ?? 'Plain Text';
}


export function inlineToRichText(src: string, sources?: SourceLike[]): RichText {
  const out: RichText = [];
  for (const s of parseInline(src)) out.push(...segToDecorations(s, sources));
  return concat(out);
}

function segToDecorations(s: Seg, sources?: SourceLike[]): RichText {
  if (s.cite) {
    const ref = sources?.find((r) => r.n === s.cite);
    return ref ? [['‣', [['p', ref.pageId]]]] : [[`[${s.cite}]`]];
  }
  if (s.eq) return [['⁍', [['e', s.text]]]];
  const anns: Annotation[] = [];
  if (s.b) anns.push(['b']);
  if (s.i) anns.push(['i']);
  if (s.s) anns.push(['s']);
  if (s.c) anns.push(['c']);
  if (s.href && /^(https?:|mailto:)/i.test(s.href)) anns.push(['a', s.href]);
  return [anns.length ? [s.text, anns] : [s.text]];
}

export interface PlannedBlock {
  type: BlockType;
  title?: RichText;
  properties?: Record<string, any>;
  format?: Record<string, any>;
  children?: PlannedBlock[];
}

function headingType(level: number): BlockType {
  return level <= 1 ? 'header' : level === 2 ? 'sub_header' : level === 3 ? 'sub_sub_header' : 'header_4';
}


export function planBlocks(nodes: MdNode[], sources?: SourceLike[]): PlannedBlock[] {
  const out: PlannedBlock[] = [];
  const rt = (t: string) => inlineToRichText(t, sources);
  for (const n of nodes) {
    switch (n.type) {
      case 'heading':
        out.push({ type: headingType(n.level), title: rt(n.text) });
        break;
      case 'paragraph':
        out.push({ type: 'text', title: rt(n.text) });
        break;
      case 'list':
        for (const it of n.items) {
          const type: BlockType = it.checked !== null ? 'to_do' : n.ordered ? 'numbered_list' : 'bulleted_list';
          out.push({
            type,
            title: rt(it.text),
            properties: type === 'to_do' ? { checked: [[it.checked ? 'Yes' : 'No']] } : undefined,
            children: planBlocks(it.children, sources),
          });
        }
        if (n.ordered && n.start > 1 && out.length) {
          const first = out[out.length - n.items.length];
          if (first) first.format = { ...(first.format ?? {}), list_start_index: n.start };
        }
        break;
      case 'quote': {
        const inner = planBlocks(n.children, sources);
        const head = inner[0];
        if (head && head.type === 'text') out.push({ type: 'quote', title: head.title, children: inner.slice(1) });
        else out.push({ type: 'quote', title: [], children: inner });
        break;
      }
      case 'code':
        out.push({ type: 'code', title: n.text ? [[n.text]] : [], properties: { language: [[codeLanguage(n.lang)]] } });
        break;
      case 'math':
        out.push({ type: 'equation', title: [[n.text]] });
        break;
      case 'hr':
        out.push({ type: 'divider' });
        break;
      case 'image':
        out.push({ type: 'image', properties: { source: [[n.url]] }, format: { display_source: n.url, block_preserve_scale: true } });
        break;
      case 'table': {
        const width = Math.max(n.header.length, ...n.rows.map((r) => r.length));
        const cols = Array.from({ length: width }, () => newId().slice(0, 4));
        const row = (cells: string[]): PlannedBlock => ({
          type: 'table_row',
          properties: Object.fromEntries(cols.map((c, i) => [c, rt(cells[i] ?? '')])),
        });
        out.push({
          type: 'table',
          format: { table_block_column_order: cols, table_block_column_header: true, table_block_row_header: false, table_block_column_format: {} },
          children: [row(n.header), ...n.rows.map(row)],
        });
        break;
      }
    }
  }
  return out;
}

export function markdownToPlan(md: string, sources?: SourceLike[]): PlannedBlock[] {
  return planBlocks(parseMarkdown(md.trim()), sources);
}
