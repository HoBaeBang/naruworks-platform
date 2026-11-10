// Embed providers offered by the slash menu “Embeds” section
// and provider block types (abstract, codepen,
// deepnote, drive, excalidraw, figma, framer, gist, hex, invision, loom, maps, miro, mixpanel, replit, sketch,
// tweet, typeform, whimsical — each with its own placeholder text). URL → iframe-src transforms follow each
// provider's public embed URL scheme; anything unknown is embedded as-is (generic iframe).

export interface EmbedProvider {
  /** slash menu label */
  name: string;
  /** block type created by the slash item */
  type: string;
  /** Placeholder row text: provider-specific text when available, otherwise “Embed {name}”. */
  placeholder: string;
  /** brand color for the slash/placeholder glyph */
  color?: string;
  /** host match for auto-detection a pasted link */
  hosts?: RegExp;
  /** URL → iframe src; null keeps the original URL */
  toEmbed?: (u: URL) => string | null;
  /** Default iframe height. */
  height?: number;
  /** render via srcdoc (script-based embeds such as GitHub Gist) */
  srcdoc?: (u: URL) => string;
}

const enc = encodeURIComponent;

function youtubeId(u: URL): string | null {
  if (/youtu\.be$/.test(u.hostname)) return u.pathname.slice(1).split('/')[0] || null;
  if (u.pathname.startsWith('/watch')) return u.searchParams.get('v');
  const m = /^\/(?:embed|shorts|live|v)\/([\w-]{6,})/.exec(u.pathname);
  return m ? m[1] : null;
}

function ytStart(u: URL): string {
  const t = u.searchParams.get('t') ?? u.searchParams.get('start');
  if (!t) return '';
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(t);
  const secs = m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : Number(t) || 0;
  return secs ? `?start=${secs}` : '';
}

/** Video sites rendered by the video block (iframe players). */
export function videoEmbedUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const h = u.hostname.replace(/^www\.|^m\./, '');
  if (/(^|\.)youtube\.com$|(^|\.)youtube-nocookie\.com$|^youtu\.be$/.test(h)) {
    const id = youtubeId(u);
    return id ? `https://www.youtube.com/embed/${id}${ytStart(u)}` : null;
  }
  if (/(^|\.)vimeo\.com$/.test(h)) {
    const m = /\/(?:video\/)?(\d+)(?:\/(\w+))?/.exec(u.pathname);
    return m ? `https://player.vimeo.com/video/${m[1]}${m[2] ? `?h=${m[2]}` : ''}` : null;
  }
  if (/(^|\.)loom\.com$/.test(h)) {
    const m = /\/(?:share|embed)\/([\w-]+)/.exec(u.pathname);
    return m ? `https://www.loom.com/embed/${m[1]}` : null;
  }
  if (/(^|\.)dailymotion\.com$|^dai\.ly$/.test(h)) {
    const m = /\/video\/([\w]+)/.exec(u.pathname) ?? /^\/([\w]+)/.exec(u.pathname);
    return m ? `https://www.dailymotion.com/embed/video/${m[1]}` : null;
  }
  if (/(^|\.)wistia\.(com|net)$/.test(h)) {
    const m = /\/medias\/([\w]+)/.exec(u.pathname);
    return m ? `https://fast.wistia.net/embed/iframe/${m[1]}` : null;
  }
  if (/(^|\.)twitch\.tv$/.test(h)) {
    const ch = u.pathname.split('/').filter(Boolean)[0];
    return ch ? `https://player.twitch.tv/?channel=${enc(ch)}&parent=${enc(location.hostname)}` : null;
  }
  return null;
}

export function isVideoFile(src: string): boolean {
  return /\.(mp4|m4v|webm|mov|ogv|ogg)(\?|#|$)/i.test(src);
}

export function isAudioFile(src: string): boolean {
  return /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus)(\?|#|$)/i.test(src);
}

export function isPdfFile(src: string): boolean {
  return /\.pdf(\?|#|$)/i.test(src);
}

export function isImageFile(src: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico|heic)(\?|#|$)/i.test(src) || src.startsWith('data:image/');
}

const sameUrl = (u: URL) => u.toString();

export const EMBED_PROVIDERS: EmbedProvider[] = [
  { name: 'Google Drive', type: 'drive', placeholder: 'Pick a Google Drive file to embed', color: '#1fa463', hosts: /(^|\.)(drive|docs)\.google\.com$/,
    toEmbed: (u) => {
      const m = /\/(file|document|spreadsheets|presentation|forms)\/d\/([\w-]+)/.exec(u.pathname);
      if (!m) return sameUrl(u);
      if (m[1] === 'file') return `https://drive.google.com/file/d/${m[2]}/preview`;
      if (m[1] === 'forms') return `https://docs.google.com/forms/d/${m[2]}/viewform?embedded=true`;
      return `https://docs.google.com/${m[1]}/d/${m[2]}/preview`;
    }, height: 480 },
  { name: 'Tweet', type: 'tweet', placeholder: 'Embed an X post', color: '#000000', hosts: /(^|\.)(twitter|x)\.com$/,
    toEmbed: (u) => {
      const m = /\/status(?:es)?\/(\d+)/.exec(u.pathname);
      return m ? `https://platform.twitter.com/embed/Tweet.html?id=${m[1]}&dnt=true` : sameUrl(u);
    }, height: 480 },
  { name: 'GitHub Gist', type: 'gist', placeholder: 'Embed a Gist', color: '#24292f', hosts: /^gist\.github\.com$/,
    srcdoc: (u) => `<!doctype html><html><head><base target="_blank"><style>body{margin:0}</style></head><body><script src="${u.origin}${u.pathname.replace(/\.js$/, '')}.js"></script></body></html>` },
  { name: 'Google Maps', type: 'maps', placeholder: 'Add a Google Maps embed', color: '#34a853', hosts: /^(maps\.)?google\.[a-z.]+$|^maps\.app\.goo\.gl$|^goo\.gl$/,
    toEmbed: (u) => {
      if (u.pathname.startsWith('/maps/embed') || u.searchParams.get('output') === 'embed') return sameUrl(u);
      const place = /\/maps\/(?:place|search)\/([^/]+)/.exec(u.pathname)?.[1];
      const at = /@(-?[\d.]+),(-?[\d.]+),(\d+(?:\.\d+)?)z/.exec(u.pathname);
      const q = place ? decodeURIComponent(place.replace(/\+/g, ' ')) : u.searchParams.get('q') ?? (at ? `${at[1]},${at[2]}` : '');
      const z = at ? `&z=${Math.round(Number(at[3]))}` : '';
      return `https://maps.google.com/maps?q=${enc(q)}${z}&output=embed`;
    }, height: 480 },
  { name: 'Figma', type: 'figma', placeholder: 'Embed Figma', color: '#a259ff', hosts: /(^|\.)figma\.com$/,
    toEmbed: (u) => (u.hostname.startsWith('embed.') || u.pathname.startsWith('/embed') ? sameUrl(u) : `https://www.figma.com/embed?embed_host=litpage&url=${enc(u.toString())}`), height: 480 },
  { name: 'Abstract', type: 'abstract', placeholder: 'Embed Abstract', color: '#191a1b', hosts: /(^|\.)abstract\.com$/,
    toEmbed: (u) => sameUrl(u).replace('app.abstract.com/share/', 'app.abstract.com/embed/'), height: 480 },
  { name: 'Invision', type: 'invision', placeholder: 'Embed an InVision project', color: '#ff3366', hosts: /(^|\.)invisionapp\.com$|(^|\.)invis\.io$/, height: 480 },
  { name: 'Mixpanel', type: 'mixpanel', placeholder: 'Add a Mixpanel project', color: '#7856ff', hosts: /(^|\.)mixpanel\.com$/, height: 480 },
  { name: 'Framer', type: 'framer', placeholder: 'Add a Framer prototype', color: '#0055ff', hosts: /(^|\.)framer\.(com|website|app)$/, height: 480 },
  { name: 'Whimsical', type: 'whimsical', placeholder: 'Embed Whimsical', color: '#7c3aed', hosts: /(^|\.)whimsical\.com$/,
    toEmbed: (u) => (u.pathname.startsWith('/embed/') ? sameUrl(u) : `https://whimsical.com/embed/${u.pathname.split('/').filter(Boolean).pop() ?? ''}`), height: 480 },
  { name: 'Miro', type: 'miro', placeholder: 'Embed Miro', color: '#ffd02f', hosts: /(^|\.)miro\.com$/,
    toEmbed: (u) => {
      const m = /\/app\/board\/([^/]+)/.exec(u.pathname);
      return m ? `https://miro.com/app/live-embed/${m[1]}/` : sameUrl(u);
    }, height: 480 },
  { name: 'Sketch', type: 'sketch', placeholder: 'Embed Sketch', color: '#f7b500', hosts: /(^|\.)sketch\.(com|cloud)$/,
    toEmbed: (u) => sameUrl(u).replace(/sketch\.com\/s\//, 'sketch.com/embed/s/'), height: 480 },
  { name: 'Excalidraw', type: 'excalidraw', placeholder: 'Embed Excalidraw', color: '#6965db', hosts: /(^|\.)excalidraw\.com$/, height: 480 },
  { name: 'PDF', type: 'pdf', placeholder: 'Embed a PDF' },
  { name: 'Loom', type: 'loom', placeholder: 'Embed Loom', color: '#625df5', hosts: /(^|\.)loom\.com$/,
    toEmbed: (u) => {
      const m = /\/(?:share|embed)\/([\w-]+)/.exec(u.pathname);
      return m ? `https://www.loom.com/embed/${m[1]}` : sameUrl(u);
    } },
  { name: 'Typeform', type: 'typeform', placeholder: 'Embed Typeform', color: '#262627', hosts: /(^|\.)typeform\.com$/, height: 480 },
  { name: 'CodePen', type: 'codepen', placeholder: 'Embed CodePen', color: '#000000', hosts: /(^|\.)codepen\.io$/,
    toEmbed: (u) => {
      const m = /^\/([^/]+)\/(?:pen|full|details|embed)\/([^/?#]+)/.exec(u.pathname);
      return m ? `https://codepen.io/${m[1]}/embed/${m[2]}?default-tab=result` : sameUrl(u);
    }, height: 480 },
  { name: 'Replit', type: 'replit', placeholder: 'Embed a repl', color: '#f26207', hosts: /(^|\.)(replit\.com|repl\.it|repl\.co)$/,
    toEmbed: (u) => {
      const v = new URL(u.toString());
      v.searchParams.set('embed', 'true');
      return v.toString();
    }, height: 480 },
  { name: 'Hex', type: 'hex', placeholder: 'Embed Hex', color: '#473982', hosts: /(^|\.)hex\.tech$/,
    toEmbed: (u) => sameUrl(u).replace(/\/app\//, '/embed/'), height: 480 },
  { name: 'Deepnote', type: 'deepnote', placeholder: 'Embed Deepnote', color: '#3793ef', hosts: /(^|\.)deepnote\.com$/,
    toEmbed: (u) => (u.hostname.startsWith('embed.') ? sameUrl(u) : sameUrl(u).replace('://deepnote.com/', '://embed.deepnote.com/')), height: 480 },
  // integration-backed link previews are embedded as plain iframes here
  { name: 'Trello', type: 'embed', placeholder: 'Embed Trello', color: '#0079bf', hosts: /(^|\.)trello\.com$/,
    toEmbed: (u) => {
      const m = /^\/(c|b)\/([\w]+)/.exec(u.pathname);
      return m ? (m[1] === 'c' ? `https://trello.com/embed/card?id=${m[2]}` : `https://trello.com/b/${m[2]}.html`) : sameUrl(u);
    } },
  { name: 'Slack', type: 'embed', placeholder: 'Embed Slack', color: '#4a154b', hosts: /(^|\.)slack\.com$/ },
  { name: 'Pitch', type: 'embed', placeholder: 'Embed Pitch', color: '#6c35de', hosts: /(^|\.)pitch\.com$/,
    toEmbed: (u) => (u.pathname.startsWith('/embed') ? sameUrl(u) : sameUrl(u).replace('pitch.com/public/', 'pitch.com/embed/')) },
  { name: 'OneDrive', type: 'embed', placeholder: 'Embed OneDrive', color: '#0078d4', hosts: /(^|\.)(onedrive\.live\.com|1drv\.ms|sharepoint\.com)$/,
    toEmbed: (u) => sameUrl(u).replace('/redir?', '/embed?') },
  { name: 'Dropbox', type: 'embed', placeholder: 'Embed Dropbox', color: '#0061ff', hosts: /(^|\.)dropbox\.com$/,
    toEmbed: (u) => {
      const v = new URL(u.toString());
      v.searchParams.set('raw', '1');
      v.searchParams.delete('dl');
      return v.toString();
    } },
  { name: 'Amplitude', type: 'embed', placeholder: 'Embed Amplitude', color: '#1e61f0', hosts: /^(app\.)?amplitude\.com$/ },
  { name: 'Claap', type: 'embed', placeholder: 'Embed Claap', color: '#7247f0', hosts: /(^|\.)claap\.io$/ },
  { name: 'Box', type: 'embed', placeholder: 'Embed Box', color: '#0061d5', hosts: /(^|\.)box\.com$/,
    toEmbed: (u) => sameUrl(u).replace(/box\.com\/s\//, 'box.com/embed/s/') },
  { name: 'Linear', type: 'embed', placeholder: 'Embed Linear', color: '#5e6ad2', hosts: /(^|\.)linear\.app$/ },
  { name: 'Lucidchart', type: 'embed', placeholder: 'Embed Lucidchart', color: '#f96b13', hosts: /(^|\.)(lucid\.app|lucidchart\.com)$/,
    toEmbed: (u) => sameUrl(u).replace(/\/lucidchart\/([\w-]+)\/(edit|view)/, '/documents/embedded/$1') },
  { name: 'Lucidspark', type: 'embed', placeholder: 'Embed Lucidspark', color: '#f96b13', hosts: /(^|\.)(lucid\.app|lucidspark\.com)$/,
    toEmbed: (u) => sameUrl(u).replace(/\/lucidspark\/([\w-]+)\/(edit|view)/, '/documents/embedded/$1') },
  { name: 'Eraser', type: 'embed', placeholder: 'Embed Eraser', color: '#000000', hosts: /(^|\.)eraser\.io$/ },
  { name: 'ClickUp', type: 'embed', placeholder: 'Embed ClickUp', color: '#7b68ee', hosts: /(^|\.)clickup\.com$/ },
  { name: 'Plus', type: 'embed', placeholder: 'Embed Plus', color: '#111111', hosts: /(^|\.)plusdocs\.com$/ },
  { name: 'Dovetail', type: 'embed', placeholder: 'Embed Dovetail', color: '#18181b', hosts: /(^|\.)dovetail(app)?\.com$/ },
  { name: 'Streak Share', type: 'embed', placeholder: 'Embed Streak Share', color: '#e64a3b', hosts: /(^|\.)streak\.com$/ },
  { name: 'Shortcut', type: 'embed', placeholder: 'Embed Shortcut', color: '#58b1e4', hosts: /(^|\.)shortcut\.com$/ },
  { name: 'SendOwl', type: 'embed', placeholder: 'Embed SendOwl', color: '#ff6c37', hosts: /(^|\.)sendowl\.com$/ },
  { name: 'Amplitude - EU', type: 'embed', placeholder: 'Embed Amplitude - EU', color: '#1e61f0', hosts: /^analytics\.eu\.amplitude\.com$/ },
  { name: 'Zendesk', type: 'embed', placeholder: 'Embed Zendesk', color: '#03363d', hosts: /(^|\.)zendesk\.com$/ },
  { name: 'Jira preview (Data center)', type: 'embed', placeholder: 'Embed Jira preview (Data center)', color: '#0052cc' },
  { name: 'Google Contacts', type: 'embed', placeholder: 'Embed Google Contacts', color: '#1a73e8', hosts: /^contacts\.google\.com$/ },
  { name: 'Discord', type: 'embed', placeholder: 'Embed Discord', color: '#5865f2', hosts: /(^|\.)discord\.(com|gg)$/ },
  { name: 'Microsoft Contacts', type: 'embed', placeholder: 'Embed Microsoft Contacts', color: '#0078d4', hosts: /^outlook\.(live|office)\.com$/ },
  { name: 'PagerDuty', type: 'embed', placeholder: 'Embed PagerDuty', color: '#06ac38', hosts: /(^|\.)pagerduty\.com$/ },
  { name: 'Asana', type: 'embed', placeholder: 'Embed Asana', color: '#f06a6a', hosts: /(^|\.)asana\.com$/ },
  { name: 'GitLab', type: 'embed', placeholder: 'Embed GitLab', color: '#fc6d26', hosts: /(^|\.)gitlab\.com$/ },
  { name: 'Zoom', type: 'embed', placeholder: 'Embed Zoom', color: '#0b5cff', hosts: /(^|\.)zoom\.us$/ },
  { name: 'Adobe XD', type: 'embed', placeholder: 'Embed Adobe XD', color: '#ff61f6', hosts: /^xd\.adobe\.com$/,
    toEmbed: (u) => sameUrl(u).replace('xd.adobe.com/view/', 'xd.adobe.com/embed/') },
  { name: 'Jira', type: 'embed', placeholder: 'Embed Jira', color: '#0052cc', hosts: /(^|\.)atlassian\.net$/ },
  { name: 'GitHub', type: 'embed', placeholder: 'Embed GitHub', color: '#24292f', hosts: /^github\.com$/ },
  // extra generic providers recognized when a link is pasted into a plain Embed block
  // Google Calendar: a calendar's share link (…/calendar/u/0?cid=<id>) becomes its public embed view
  { name: 'Google Calendar', type: 'embed', placeholder: 'Embed Google Calendar', color: '#1a73e8', hosts: /^calendar\.google\.[a-z.]+$/,
    toEmbed: (u) => {
      const cid = u.searchParams.get('cid');
      if (!/\/calendar\/u\/\d+/.test(u.pathname) || !cid) return sameUrl(u);
      return `${u.origin}/calendar/embed?src=${enc(cid)}`;
    }, height: 500 },
  { name: 'Spotify', type: 'embed', placeholder: 'Embed Spotify', hosts: /^open\.spotify\.com$/,
    toEmbed: (u) => (u.pathname.startsWith('/embed') ? sameUrl(u) : `https://open.spotify.com/embed${u.pathname}`), height: 152 },
  { name: 'SoundCloud', type: 'embed', placeholder: 'Embed SoundCloud', hosts: /(^|\.)soundcloud\.com$/,
    toEmbed: (u) => (u.hostname.startsWith('w.') ? sameUrl(u) : `https://w.soundcloud.com/player/?url=${enc(u.toString())}`), height: 166 },
  { name: 'CodeSandbox', type: 'embed', placeholder: 'Embed CodeSandbox', hosts: /(^|\.)codesandbox\.io$/,
    toEmbed: (u) => sameUrl(u).replace('/s/', '/embed/').replace('/p/sandbox/', '/embed/'), height: 480 },
];

/** Names offered in the slash menu. */
export const SLASH_EMBED_NAMES = EMBED_PROVIDERS.slice(0, EMBED_PROVIDERS.findIndex((p) => p.name === 'GitHub') + 1).map((p) => p.name);

export const PROVIDER_BLOCK_TYPES = Array.from(new Set(EMBED_PROVIDERS.map((p) => p.type).filter((t) => t !== 'embed' && t !== 'pdf')));

export function providerByName(name: string | undefined): EmbedProvider | undefined {
  return name ? EMBED_PROVIDERS.find((p) => p.name === name) : undefined;
}

export function providerForType(type: string): EmbedProvider | undefined {
  return EMBED_PROVIDERS.find((p) => p.type === type);
}

export function providerForUrl(raw: string): EmbedProvider | undefined {
  try {
    const u = new URL(raw);
    const h = u.hostname.replace(/^www\./, '');
    return EMBED_PROVIDERS.find((p) => p.hosts?.test(h));
  } catch {
    return undefined;
  }
}

export interface ResolvedEmbed {
  /** iframe src (undefined when srcdoc is used) */
  src?: string;
  srcdoc?: string;
  provider?: EmbedProvider;
  height: number;
}

/** Resolve how a block's source should be rendered in an iframe. */
export function resolveEmbed(raw: string, blockType?: string, providerName?: string): ResolvedEmbed {
  const provider = providerByName(providerName) ?? (blockType && blockType !== 'embed' ? providerForType(blockType) : undefined) ?? providerForUrl(raw);
  let u: URL | null = null;
  try {
    u = new URL(raw, location.href);
  } catch {
    u = null;
  }
  const video = videoEmbedUrl(raw);
  if (video) return { src: video, provider, height: 400 };
  if (u && provider?.srcdoc) return { srcdoc: provider.srcdoc(u), provider, height: provider.height ?? 320 };
  const src = u && provider?.toEmbed ? provider.toEmbed(u) ?? raw : raw;
  return { src, provider, height: provider?.height ?? 320 };
}
