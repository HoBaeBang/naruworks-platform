
// other image URLs stay text (no remote images in chat).
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../ai/md.ts';
import { planBlocks } from '../ai/mdBlocks.ts';

describe('AI markdown images', () => {
  it('parses a stored-file image line', () => {
    const nodes = parseMarkdown('Here it is:\n\n![A lighthouse](/files/abc/lighthouse.svg)\n\nDone.');
    expect(nodes.map((n) => n.type)).toEqual(['paragraph', 'image', 'paragraph']);
    expect(nodes[1]).toEqual({ type: 'image', alt: 'A lighthouse', url: '/files/abc/lighthouse.svg' });
  });
  it('keeps remote and inline images as text', () => {
    expect(parseMarkdown('![x](https://example.com/a.png)').map((n) => n.type)).toEqual(['paragraph']);
    expect(parseMarkdown('see ![x](/files/a.svg) here').map((n) => n.type)).toEqual(['paragraph']);
  });
  it('inserts an image block', () => {
    const blocks = planBlocks(parseMarkdown('![Chart](/files/f1/chart.svg)'));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'image', properties: { source: [['/files/f1/chart.svg']] }, format: { display_source: '/files/f1/chart.svg' } });
  });
});
