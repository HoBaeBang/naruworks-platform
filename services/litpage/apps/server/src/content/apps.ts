// File exports of other apps → specs (Settings › Import › Third-party tiles, file-based path; /014/018):
//   Evernote .enex  → a database of the notebook's notes (Created, Tags; list view), each note's ENML as page content
//   Trello .json    → a board database (List as the board's groups, Labels, Due; board + table views)
// Accounts-based imports (OAuth) aren't available in this build; these work from the apps' own export files.
import type { DbSpec, Spec } from './spec.ts';
import { parseXml, type XNode } from './docx.ts';
import { parseHtml } from './html.ts';
import { parseMarkdown } from './markdown.ts';

const els = (n: XNode | undefined): XNode[] => (n ? (n.children.filter((c) => typeof c !== 'string') as XNode[]) : []);
const textOf = (n: XNode | undefined): string => {
  if (!n) return '';
  let s = '';
  for (const c of n.children) s += typeof c === 'string' ? c : textOf(c);
  return s;
};

/** 20240115T093000Z → 2024-01-15 */
function enexDate(s: string): string | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(s.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

export function enexToDb(name: string, xml: string): DbSpec {
  const tree = parseXml(xml);
  const exportEl = els(tree).find((e) => e.name === 'en-export');
  if (!exportEl) throw new Error('This file isn’t an Evernote export (.enex)');
  const notes = els(exportEl).filter((e) => e.name === 'note').slice(0, 5000);
  const tagSet = new Set<string>();
  const rows = notes.map((note) => {
    const field = (n: string) => textOf(els(note).find((e) => e.name === n)).trim();
    const tags = els(note).filter((e) => e.name === 'tag').map((t) => textOf(t).trim()).filter(Boolean);
    tags.forEach((t) => tagSet.add(t));
    const enml = textOf(els(note).find((e) => e.name === 'content'));
    const body = enml.replace(/^[\s\S]*?<en-note[^>]*>/i, '<div>').replace(/<\/en-note>[\s\S]*$/i, '</div>').replace(/<en-media[^>]*\/?>/gi, '');
    const children: Spec[] = body.trim() ? parseHtml(body, {}).blocks : [];
    const created = enexDate(field('created'));
    return { values: { title: field('title') || 'Untitled', created: created ? { date: created } : null, tags }, children };
  });
  return {
    name,
    schema: { title: { name: 'Name', type: 'title' }, created: { name: 'Created', type: 'date' }, tags: { name: 'Tags', type: 'multi_select', options: [...tagSet] } },
    rows,
    views: [{ type: 'list', name: 'All notes', visible: ['created', 'tags'], sort: [{ property: 'created', direction: 'descending' }] }, { type: 'gallery', name: 'Gallery' }],
  };
}

interface TrelloBoard {
  name?: string;
  lists?: { id: string; name: string; closed?: boolean; pos?: number }[];
  cards?: { name?: string; desc?: string; idList?: string; closed?: boolean; due?: string | null; labels?: { name?: string; color?: string }[]; pos?: number }[];
}

export function trelloToDb(name: string, json: string): DbSpec {
  let board: TrelloBoard;
  try {
    board = JSON.parse(json) as TrelloBoard;
  } catch {
    throw new Error('This file isn’t a Trello board export (.json)');
  }
  if (!board || !Array.isArray(board.cards) || !Array.isArray(board.lists)) throw new Error('This file isn’t a Trello board export (.json)');
  const lists = board.lists.filter((l) => !l.closed).sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0));
  const listName = new Map(lists.map((l) => [l.id, l.name]));
  const labels = new Set<string>();
  const cards = board.cards.filter((c) => !c.closed && listName.has(c.idList ?? '')).sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0)).slice(0, 10_000);
  const rows = cards.map((c) => {
    const ls = (c.labels ?? []).map((l) => l.name || l.color || '').filter(Boolean);
    ls.forEach((l) => labels.add(l));
    return {
      values: { title: c.name || 'Untitled', list: listName.get(c.idList ?? '') ?? null, labels: ls, due: c.due ? { date: c.due.slice(0, 10) } : null },
      children: c.desc?.trim() ? parseMarkdown(c.desc, {}).blocks : [],
    };
  });
  return {
    name: board.name || name,
    schema: {
      title: { name: 'Name', type: 'title' },
      list: { name: 'List', type: 'select', options: lists.map((l) => l.name) },
      labels: { name: 'Labels', type: 'multi_select', options: [...labels] },
      due: { name: 'Due', type: 'date' },
    },
    rows,
    views: [{ type: 'board', name: 'Board', groupBy: 'list', visible: ['labels', 'due'] }, { type: 'table', name: 'All cards' }],
  };
}
