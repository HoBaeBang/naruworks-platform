// AI image generation: the SVG sanitizer (scripts, handlers, external references,
// entities, size cap), availability rules (plan, workspace switch, AI service on, key), generating into an image block,
// "Edit with AI" only for generated images, the daily limit, and the chat tool generate_image.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-ai-image-test-'));
delete process.env.ANTHROPIC_API_KEY;
vi.setConfig({ testTimeout: 30_000 });

const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
function fake(text: string, seen: any[] = []) {
  return {
    beta: {
      messages: {
        stream: ((params: any) => {
          seen.push(JSON.parse(JSON.stringify(params)));
          return {
            async *[Symbol.asyncIterator]() {
              yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
              yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } };
            },
            finalMessage: async () => ({ model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text }], usage }),
          };
        }) as any,
      },
    },
  };
}

let svgMod: typeof import('../src/ai/imageSvg.ts');
let image: typeof import('../src/ai/image.ts');
let db: typeof import('../src/db.ts');
let seed: typeof import('../src/seed.ts');
let files: typeof import('../src/content/files.ts');
let newId: () => string;
const ids = {} as Record<string, string>;
const DIRTY = `Here you go:\n\`\`\`svg\n<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>
<svg width="400" height="300" viewbox="0 0 400 300" onload="alert(1)"><script>alert('</svg>')</script>
<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient><style>@import url(http://evil/x.css); .a{fill:url(https://evil/p.png)} .b{fill:red}</style></defs>
<rect width="400" height="300" fill="url(#g)" onclick="steal()"/><circle cx="10" cy="10" r="5" fill="url(http://evil/a)"/>
<foreignObject><div>html</div></foreignObject><image href="https://evil/i.png"/><use href="#g"/><use xlink:href="https://evil/s.svg#x"/>
<a href="javascript:alert(1)"><text>bad</text></a><text x="5" y="20" style="font-size:12px;background:url(javascript:alert(1))">Hi &amp; bye &lt;3</text></svg>\n\`\`\``;

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  await import('../src/app.ts');
  svgMod = await import('../src/ai/imageSvg.ts');
  image = await import('../src/ai/image.ts');
  db = await import('../src/db.ts');
  seed = await import('../src/seed.ts');
  files = await import('../src/content/files.ts');
  for (const n of ['owner', 'viewer']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n}@img.test`, n);
  }
  const w = seed.createWorkspace(ids.owner, 'Pics');
  ids.space = w.space.id;
  seed.addMember(ids.space, ids.viewer, 'editor');
  ids.page = newId();
  ids.img = newId();
  const now = Date.now();
  const base = { version: 1, space_id: ids.space, alive: true, created_time: now, created_by_id: ids.owner, last_edited_time: now, last_edited_by_id: ids.owner };
  db.putRecord('block', { ...base, id: ids.page, type: 'page', properties: { title: [['Roadmap']] }, content: [ids.img], parent_id: ids.space, parent_table: 'space', permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.owner }, { type: 'user_permission', role: 'reader', user_id: ids.viewer }] } as any);
  db.putRecord('block', { ...base, id: ids.img, type: 'image', parent_id: ids.page, parent_table: 'block' } as any);
});

describe('SVG sanitizer', () => {
  it('keeps the drawing and drops scripts, handlers, external references and entities', () => {
    const out = svgMod.sanitizeSvg(DIRTY);
    expect(out.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(out).toContain('viewBox="0 0 400 300"');
    expect(out).toContain('<linearGradient id="g">');
    expect(out).toContain('fill="url(#g)"');
    expect(out).toContain('<use href="#g"/>');
    expect(out).toContain('.b{fill:red}');
    expect(out).toContain('Hi &amp; bye &lt;3');
    for (const bad of ['script', 'alert', 'onload', 'onclick', 'evil', 'foreignObject', '<image', 'javascript', 'ENTITY', 'DOCTYPE', 'passwd', '@import', '<a ', 'html']) {
      expect(out.toLowerCase()).not.toContain(bad.toLowerCase());
    }
    expect(svgMod.svgSize(out)).toEqual({ width: 400, height: 300 });
  });

  it('rejects answers without an SVG and oversized images', () => {
    expect(() => svgMod.sanitizeSvg('I cannot draw that.')).toThrow();
    expect(() => svgMod.sanitizeSvg(`<svg>${'<rect width="1" height="1"/>'.repeat(30_000)}</svg>`)).toThrow();
  });
});

describe('availability', () => {
  it('needs Business / Enterprise, the workspace switch, Litpage AI on and a key', async () => {
    expect(() => image.assertImageAllowed(ids.space, ids.owner, { client: fake('') as any })).toThrow(/Business and Enterprise/);
    const s = db.getRecord<any>('space', ids.space)!;
    db.putRecord('space', { ...s, plan_type: 'business' });
    expect(() => image.assertImageAllowed(ids.space, ids.owner, { client: fake('') as any })).not.toThrow();
    expect(() => image.assertImageAllowed(ids.space, ids.owner)).toThrow(/Connect an AI provider/);
    db.putRecord('space', { ...db.getRecord<any>('space', ids.space)!, settings: { ...s.settings, ai_image_generation: false } });
    expect(() => image.assertImageAllowed(ids.space, ids.owner, { client: fake('') as any })).toThrow(/turned off/);
    db.putRecord('space', { ...db.getRecord<any>('space', ids.space)!, settings: { ...s.settings, ai_enabled: false } });
    expect(() => image.assertImageAllowed(ids.space, ids.owner, { client: fake('') as any })).toThrow(/Turn on Litpage AI/);
    db.putRecord('space', { ...db.getRecord<any>('space', ids.space)!, settings: { ...s.settings } });
  });
});

describe('image block', () => {
  it('generates into the block: sanitized SVG file, block source and ai_image metadata, page as context', async () => {
    const seen: any[] = [];
    const r = await image.generateIntoBlock({ userId: ids.owner, blockId: ids.img, prompt: 'A rocket over a roadmap', style: 'diagram', client: fake(DIRTY, seen) as any });
    expect(seen[0].system[0].text).toContain('You draw illustrations as SVG');
    expect(seen[0].messages[0].content).toContain('Draw: A rocket over a roadmap');
    expect(seen[0].messages[0].content).toContain('<page>');
    const row = files.fileRow(r.file.id)!;
    expect(row.mime).toBe('image/svg+xml');
    const stored = readFileSync(row.path, 'utf8');
    expect(stored).not.toContain('script');
    const b = db.getRecord<any>('block', ids.img)!;
    expect(b.properties.source[0][0]).toBe(r.file.url);
    expect(b.format.ai_image).toMatchObject({ prompt: 'A rocket over a roadmap', style: 'diagram', provider: 'claude-svg', file_id: r.file.id });
    expect(b.format.block_aspect_ratio).toBe(0.75);
  });

  it('a viewer can’t generate into the block', async () => {
    await expect(image.generateIntoBlock({ userId: ids.viewer, blockId: ids.img, prompt: 'x', client: fake(DIRTY) as any })).rejects.toThrow(/view this page/);
  });

  it('Edit with AI sends the current SVG and the change; uploaded images are unavailable', async () => {
    const seen: any[] = [];
    await image.editBlockImage({ userId: ids.owner, blockId: ids.img, instruction: 'make it snowy', client: fake('<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="white"/></svg>', seen) as any });
    expect(seen[0].messages[0].content).toContain('<current_svg>');
    expect(seen[0].messages[0].content).toContain('Edit this image: make it snowy');
    const b = db.getRecord<any>('block', ids.img)!;
    expect(b.format.ai_image.edits).toBe(1);
    // an uploaded (non-generated) image
    const plain = newId();
    const now = Date.now();
    db.putRecord('block', { id: plain, version: 1, type: 'image', parent_id: ids.page, parent_table: 'block', space_id: ids.space, alive: true, created_time: now, created_by_id: ids.owner, properties: { source: [['https://example.com/a.png']] } } as any);
    await expect(image.editBlockImage({ userId: ids.owner, blockId: plain, instruction: 'x', client: fake('') as any })).rejects.toThrow(/only available for images created with Litpage AI/);
  });

  it('daily limit', async () => {
    process.env.NC_AI_IMAGE_PER_DAY = '2';
    await expect(image.generateImage({ userId: ids.owner, spaceId: ids.space, prompt: 'third', client: fake(DIRTY) as any })).rejects.toThrow(/image limit/);
    delete process.env.NC_AI_IMAGE_PER_DAY;
  });
});

describe('chat tool generate_image', () => {
  it('returns a Markdown image and inserts it into a page after approval', async () => {
    const { runTool } = await import('../src/ai/tools/registry.ts');
    const steps: any[] = [];
    const env: any = {
      userId: ids.owner, spaceId: ids.space, threadId: null, turnId: newId(), currentPageId: ids.page, approvalMode: 'skip_all', memories: false,
      cite: () => 1, step: (e: any) => steps.push(e), approve: async () => 'accept', touched: () => {},
    };
    const { claudeSvgProvider, registerImageProvider } = image;
    // route the default provider through a fake client for this test
    registerImageProvider({ ...claudeSvgProvider, generate: (req, o) => claudeSvgProvider.generate(req, { ...o, client: fake('<svg viewBox="0 0 20 10"><circle r="3"/></svg>') as any }) });
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-0000000000';
    const out = await runTool(env, 'generate_image', { prompt: 'A cat', style: 'cartoon', insert_into_page_id: ids.page }, 'step1');
    delete process.env.ANTHROPIC_API_KEY;
    expect(out.isError).toBeFalsy();
    expect(out.content).toMatch(/!\[A cat\]\(\/files\/[0-9a-f-]{36}\/A-cat\.svg\)/);
    expect(steps.map((s) => s.label)).toEqual(['Generating image', 'Generated image']);
    const page = db.getRecord<any>('block', ids.page)!;
    const last = db.getRecord<any>('block', page.content[page.content.length - 1])!;
    expect(last).toMatchObject({ type: 'image', format: { ai_image: { prompt: 'A cat', style: 'cartoon' } } });
    // Custom Agents can't use it
    const agentOut = await runTool({ ...env, source: 'agent:run1' }, 'generate_image', { prompt: 'x' }, 'step2');
    expect(agentOut.isError).toBe(true);
  });
});
