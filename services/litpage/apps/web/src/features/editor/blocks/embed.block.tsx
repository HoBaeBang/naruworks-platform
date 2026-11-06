// Embed blocks: generic `embed` plus provider block types (abstract, codepen, deepnote, drive,
// excalidraw, figma, framer, gist, hex, invision, loom, maps, miro, mixpanel, replit, sketch, tweet, typeform,
// whimsical) and integration presets (embed + format.embed_provider). The block stores
// properties.source and format.block_height 320. Rendered as an iframe 704×320,
// sandbox "allow-scripts allow-popups allow-top-navigation-by-user-activation allow-forms allow-same-origin
// allow-storage-access-by-user-activation allow-popups-to-escape-sandbox"; resize pills left/right 6×48 and
// bottom 48×6. format.embed_variant "html_artifact" is the HTML block (html.block.tsx).
import type { BlockRecord } from '@nc/shared/records.ts';
import { registerBlock, type BlockProps } from '../Block.tsx';
import { Icon } from '../../../components/Icon.tsx';
import { openBlockMenu } from '../BlockMenu.tsx';
import { registerBlockMenu, overrideSlashItem } from './registry.ts';
import { ActionButton, BlockPlaceholder, originalSourceOf, showCaption, sourceOf } from './shared.tsx';
import { MediaFrame, AlignButton } from './media/MediaFrame.tsx';
import { openMediaPicker } from './media/MediaPicker.tsx';
import { EMBED_PROVIDERS, PROVIDER_BLOCK_TYPES, SLASH_EMBED_NAMES, providerByName, providerForType, resolveEmbed } from './media/embedProviders.ts';
import { replaceMedia, viewOriginal } from './media.block.tsx';
import { HtmlBlock, htmlMenuItems } from './html.block.tsx';
import { insertBlock } from './factories.ts';

const SANDBOX = 'allow-scripts allow-popups allow-top-navigation-by-user-activation allow-forms allow-same-origin allow-storage-access-by-user-activation allow-popups-to-escape-sandbox';

function placeholderFor(b: BlockRecord): { label: string; color?: string } {
  const p = providerByName(b.format?.embed_provider as string | undefined) ?? (b.type !== 'embed' ? providerForType(b.type) : undefined);
  if (p) return { label: p.placeholder, color: p.color };
  return { label: 'Embed content (PDFs, maps, music, and more…)' };
}

function EmbedBlock(props: BlockProps) {
  const { block, readOnly } = props;
  if (block.format?.embed_variant === 'html_artifact') return <HtmlBlock {...props} />;
  const raw = originalSourceOf(block);
  if (!raw) {
    const ph = placeholderFor(block);
    return (
      <div className="nc-bpad">
        <BlockPlaceholder
          block={block}
          readOnly={readOnly}
          icon={ph.color ? <Icon name="globe" size={22} style={{ color: ph.color }} /> : 'linkCapture'}
          label={ph.label}
          onOpen={(el) => openMediaPicker(block, el)}
        />
      </div>
    );
  }
  const display = sourceOf(block) ?? raw;
  const resolved = resolveEmbed(display, block.type, block.format?.embed_provider as string | undefined);
  const height = (block.format?.block_height as number | undefined) ?? resolved.height;
  return (
    <MediaFrame
      block={block}
      readOnly={readOnly}
      heightResizable
      bar={(
        <>
          <AlignButton block={block} />
          <ActionButton icon="caption" tooltip="Caption" label="Add a caption" onClick={() => showCaption(block.id)} />
          <ActionButton icon="openOriginal" tooltip="View original" label="View source media" onClick={() => viewOriginal(block)} />
          <ActionButton icon="ellipsis" tooltip="More actions" onClick={(e) => openBlockMenu([block.id], e.currentTarget.getBoundingClientRect())} />
        </>
      )}
    >
      {(live) => (
        <div className="nc-embed-frame" style={{ height: live?.h ?? height }}>
          {resolved.srcdoc ? (
            <iframe srcDoc={resolved.srcdoc} title={resolved.provider?.name ?? 'Embed'} sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" />
          ) : (
            <iframe src={resolved.src} title={resolved.provider?.name ?? 'Embed'} sandbox={SANDBOX} allow="clipboard-write; fullscreen; encrypted-media; picture-in-picture" allowFullScreen loading="lazy" />
          )}
        </div>
      )}
    </MediaFrame>
  );
}

registerBlock(['embed', 'external_object_instance', ...PROVIDER_BLOCK_TYPES], EmbedBlock);

registerBlockMenu(['embed', 'external_object_instance', ...PROVIDER_BLOCK_TYPES], ({ block }) => {
  if (block.format?.embed_variant === 'html_artifact') return htmlMenuItems(block);
  const has = !!originalSourceOf(block);
  return [
    ...(has ? [{ label: 'Replace', icon: 'replace', onSelect: () => replaceMedia(block) }] : []),
    { label: 'Caption', icon: 'caption', shortcut: '⌘⌥M', onSelect: () => showCaption(block.id) },
    ...(has ? [{ label: 'View original', icon: 'openOriginal', onSelect: () => viewOriginal(block) }] : []),
  ];
});

// Slash “Embeds” presets create the provider block type and open the link popover
for (const name of SLASH_EMBED_NAMES) {
  const p = EMBED_PROVIDERS.find((x) => x.name === name)!;
  overrideSlashItem(`embed-${name}`, (ctx) => {
    if (p.type === 'pdf') insertBlock(ctx, 'pdf', { openPicker: true });
    else if (p.type === 'embed') insertBlock(ctx, 'embed', { format: { embed_provider: name }, openPicker: true });
    else insertBlock(ctx, p.type, { openPicker: true });
  });
}
overrideSlashItem('embed', (ctx) => insertBlock(ctx, 'embed', { openPicker: true }));
