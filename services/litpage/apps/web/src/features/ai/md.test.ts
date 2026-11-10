// Unit tests: AI Markdown parsing, inline segments, block planning and the SSE parser.
import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from './md.ts';
import { codeLanguage, inlineToRichText, markdownToPlan } from './mdBlocks.ts';
import { createSseParser } from './sse.ts';

describe('parseMarkdown', () => {
  it('parses blocks', () => {
    const nodes = parseMarkdown([
      '# Title',
      '',
      'A paragraph',
      'with two lines.',
      '',
      '- one',
      '  - nested',
      '- two',
      '',
      '1. first',
      '2. second',
      '',
      '- [ ] todo',
      '- [x] done',
      '',
      '> quoted',
      '',
      '```ts',
      'const a = 1;',
      '```',
      '',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 \\| 3 |',
      '',
      '---',
      '$$',
      'e=mc^2',
      '$$',
    ].join('\n'));
    expect(nodes.map((n) => n.type)).toEqual(['heading', 'paragraph', 'list', 'list', 'list', 'quote', 'code', 'table', 'hr', 'math']);
    expect(nodes[1]).toEqual({ type: 'paragraph', text: 'A paragraph\nwith two lines.' });
    const bullets = nodes[2] as any;
    expect(bullets.ordered).toBe(false);
    expect(bullets.items.map((i: any) => i.text)).toEqual(['one', 'two']);
    expect(bullets.items[0].children[0].items[0].text).toBe('nested');
    expect((nodes[3] as any).ordered).toBe(true);
    expect((nodes[4] as any).items.map((i: any) => i.checked)).toEqual([false, true]);
    expect((nodes[6] as any)).toMatchObject({ type: 'code', lang: 'ts', text: 'const a = 1;', open: false });
    expect((nodes[7] as any).rows).toEqual([['1', '2 | 3']]);
  });

  it('tolerates an unfinished stream', () => {
    const nodes = parseMarkdown('Intro\n\n```py\nprint(1)');
    expect(nodes[1]).toMatchObject({ type: 'code', lang: 'py', text: 'print(1)', open: true });
  });
});

describe('parseInline', () => {
  it('styles, links, citations and equations', () => {
    expect(parseInline('a **b** *i* ~~s~~ `c` [l](https://x.dev)')).toEqual([
      { text: 'a ' }, { text: 'b', b: true }, { text: ' ' }, { text: 'i', i: true }, { text: ' ' }, { text: 's', s: true }, { text: ' ' },
      { text: 'c', c: true }, { text: ' ' }, { text: 'l', href: 'https://x.dev' },
    ]);
    expect(parseInline('See [1][2].')).toEqual([{ text: 'See ' }, { text: '', cite: 1 }, { text: '', cite: 2 }, { text: '.' }]);
    expect(parseInline('Energy $E=mc^2$ costs $5')).toEqual([{ text: 'Energy ' }, { text: 'E=mc^2', eq: true }, { text: ' costs $5' }]);
    expect(parseInline('snake_case_name stays plain')).toEqual([{ text: 'snake_case_name stays plain' }]);
    expect(parseInline('***both***')).toEqual([{ text: 'both', b: true, i: true }]);
    expect(parseInline('\\*not italic\\*')).toEqual([{ text: '*not italic*' }]);
  });
});

describe('markdownToPlan', () => {
  it('maps nodes to Litpage blocks', () => {
    const plan = markdownToPlan('## Plan\n\n- [ ] Ship\n\n3. third\n4. fourth\n\n```js\nx()\n```\n\n| A | B |\n| - | - |\n| 1 | **2** |\n\n> Quote');
    expect(plan.map((b) => b.type)).toEqual(['sub_header', 'to_do', 'numbered_list', 'numbered_list', 'code', 'table', 'quote']);
    expect(plan[1].properties).toEqual({ checked: [['No']] });
    expect(plan[2].format).toEqual({ list_start_index: 3 });
    expect(plan[4].properties).toEqual({ language: [['JavaScript']] });
    const table = plan[5];
    const cols = table.format!.table_block_column_order as string[];
    expect(cols).toHaveLength(2);
    expect(table.format!.table_block_column_header).toBe(true);
    expect(table.children!.map((r) => r.type)).toEqual(['table_row', 'table_row']);
    expect(table.children![1].properties![cols[1]]).toEqual([['2', [['b']]]]);
  });

  it('turns citations into page mentions when the source is known', () => {
    expect(inlineToRichText('See [1] and [9]', [{ n: 1, pageId: 'p1' }])).toEqual([['See '], ['‣', [['p', 'p1']]], [' and [9]']]);
  });

  it('code languages', () => {
    expect(codeLanguage('ts')).toBe('TypeScript');
    expect(codeLanguage('mermaid')).toBe('Mermaid');
    expect(codeLanguage('')).toBe('Plain Text');
    expect(codeLanguage('kotlin')).toBe('Kotlin');
    expect(codeLanguage('nonsense')).toBe('Plain Text');
  });
});

describe('createSseParser', () => {
  it('handles events split across chunks', () => {
    const got: any[] = [];
    const p = createSseParser((e) => got.push(e));
    p.push('event: delta\ndata: {"te');
    p.push('xt":"Hi"}\n\n: keep-alive\n\nevent: done\n');
    p.push('data: {}\n\n');
    p.end();
    expect(got).toEqual([{ event: 'delta', data: '{"text":"Hi"}' }, { event: 'done', data: '{}' }]);
  });
});
