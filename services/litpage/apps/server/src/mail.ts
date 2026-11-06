// Mail: every outgoing email goes through sendMail, which stores it in the `mail_outbox` table and —
// only when NC_SMTP_URL is configured and the process is not a test — delivers it with the small SMTP client below.
// Without SMTP (development, CI) the outbox is the delivery: GET /api/dev/mail lists it (dev only).
//
// API:
// sendMail({ to, toUserId?, subject, text, html, kind, meta?, sensitive? }) → message id
// Mail templates return { subject, text, html } (login code, page invite, workspace invite, notification,
// access request, page updates digest, workspace digest, new login)
// listMail({ to?, limit? }), getMail(id) (dev viewer / tests)
// appUrl(path) absolute link into the service (NC_PUBLIC_URL)
// registerMailRoutes(app) GET /api/dev/mail[/:id] (404 in production)
// Sensitive messages (login codes) are redacted in the outbox after 15 minutes.
import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import type { Hono } from 'hono';
import { newId } from '@nc/shared/ids.ts';
import { db } from './db.ts';
import { devLoginCodesEnabled, parseCookies, userForToken } from './auth.ts';
import { DEMO_MESSAGE, isDemoMode } from './demo.ts';

db.exec(`
CREATE TABLE IF NOT EXISTS mail_outbox (
  id TEXT PRIMARY KEY,
  to_email TEXT NOT NULL,
  to_user_id TEXT,
  subject TEXT NOT NULL,
  text TEXT NOT NULL,
  html TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  sensitive INTEGER NOT NULL DEFAULT 0,
  meta TEXT,
  created_time INTEGER NOT NULL,
  sent_time INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mail_outbox_to ON mail_outbox(to_email, created_time);
CREATE INDEX IF NOT EXISTS idx_mail_outbox_time ON mail_outbox(created_time);
`);

export interface MailMessage {
  id: string;
  to: string;
  toUserId: string | null;
  subject: string;
  text: string;
  html: string;
  kind: string;
  status: 'stored' | 'queued' | 'sent' | 'failed';
  error: string | null;
  meta: Record<string, unknown> | null;
  createdTime: number;
  sentTime: number | null;
}

export interface MailContent {
  subject: string;
  text: string;
  html: string;
}

const EMAIL_RE = /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/;
const SENSITIVE_TTL = 15 * 60_000;
const KEEP_DAYS = 30;

function inTest(): boolean {
  return !!process.env.VITEST || process.env.NODE_ENV === 'test';
}

/** Absolute URL into the web app (emails need absolute links). */
export function appUrl(path = '/'): string {
  const base = (process.env.NC_PUBLIC_URL ?? 'http://127.0.0.1:5173').replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

const insert = db.prepare(`INSERT INTO mail_outbox (id, to_email, to_user_id, subject, text, html, kind, status, sensitive, meta, created_time)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
let lastCleanup = 0;

function cleanup(now: number) {
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;
  db.prepare(`UPDATE mail_outbox SET text = '[redacted]', html = '<p>[redacted]</p>', sensitive = 2 WHERE sensitive = 1 AND created_time < ?`).run(now - SENSITIVE_TTL);
  db.prepare('DELETE FROM mail_outbox WHERE created_time < ?').run(now - KEEP_DAYS * 86_400_000);
}

/** Store (and, with SMTP configured, deliver) one email. Invalid addresses are dropped (returns null). */
export function sendMail(m: MailContent & { to: string; toUserId?: string | null; kind: string; meta?: Record<string, unknown>; sensitive?: boolean }): string | null {
  // A public demo has no outbound mail channel, even if an SMTP setting is accidentally present.
  if (isDemoMode()) return null;
  const to = String(m.to ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(to) || to.length > 254) return null;
  const now = Date.now();
  cleanup(now);
  const id = newId();
  const smtp = smtpConfig();
  const status = smtp && !inTest() ? 'queued' : 'stored';
  insert.run(id, to, m.toUserId ?? null, m.subject.slice(0, 500), m.text, m.html, m.kind, status, m.sensitive ? 1 : 0, m.meta ? JSON.stringify(m.meta) : null, now);
  if (status === 'queued' && smtp) {
    void deliver(smtp, { ...m, id, to })
      .then(() => db.prepare("UPDATE mail_outbox SET status = 'sent', sent_time = ? WHERE id = ?").run(Date.now(), id))
      .catch((e) => {
        console.error(`[mail] delivery to ${to.replace(/^(.).*(@.*)$/, '$1…$2')} failed: ${String(e?.message ?? e).slice(0, 200)}`);
        db.prepare("UPDATE mail_outbox SET status = 'failed', error = ? WHERE id = ?").run(String(e?.message ?? e).slice(0, 500), id);
      });
  }
  return id;
}

function rowToMessage(r: any): MailMessage {
  let meta: Record<string, unknown> | null = null;
  try {
    meta = r.meta ? JSON.parse(r.meta) : null;
  } catch {
    /* ignore */
  }
  return {
    id: r.id, to: r.to_email, toUserId: r.to_user_id, subject: r.subject, text: r.text, html: r.html, kind: r.kind, status: r.status,
    error: r.error, meta, createdTime: r.created_time, sentTime: r.sent_time,
  };
}

export function listMail(opts: { to?: string; kind?: string; limit?: number } = {}): MailMessage[] {
  cleanup(Date.now());
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.to) { where.push('to_email = ?'); args.push(opts.to.toLowerCase()); }
  if (opts.kind) { where.push('kind = ?'); args.push(opts.kind); }
  const sql = `SELECT * FROM mail_outbox ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_time DESC, rowid DESC LIMIT ?`;
  return (db.prepare(sql).all(...(args as any[]), limit) as any[]).map(rowToMessage);
}

export function getMail(id: string): MailMessage | null {
  const r = db.prepare('SELECT * FROM mail_outbox WHERE id = ?').get(id);
  return r ? rowToMessage(r) : null;
}

// ---------------------------------------------------------------- templates
export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

interface LayoutOpts {
  preheader?: string;
  heading?: string;
  /** trusted HTML (callers escape their values) */
  body: string;
  button?: { label: string; url: string };
  footer?: string;
}

/** Shared email layout: a light card, readable system type, and one clear action. */
function layout(o: LayoutOpts): string {
  const btn = o.button
    ? `<p style="margin:24px 0 8px"><a href="${esc(o.button.url)}" style="display:inline-block;background:#2383e2;color:#ffffff;text-decoration:none;font-weight:500;font-size:14px;line-height:20px;padding:6px 14px;border-radius:6px">${esc(o.button.label)}</a></p>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(o.heading ?? 'Litpage')}</title></head>
<body style="margin:0;padding:0;background:#ffffff;color:#37352f;font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
${o.preheader ? `<div style="display:none;max-height:0;overflow:hidden">${esc(o.preheader)}</div>` : ''}
<div style="max-width:520px;margin:0 auto;padding:32px 24px">
<div style="font-weight:700;font-size:18px;letter-spacing:-0.2px;margin-bottom:28px"><span style="display:inline-block;width:24px;height:24px;border:2px solid #37352f;border-radius:4px;text-align:center;line-height:24px;font-size:14px;margin-right:8px">N</span>Litpage</div>
${o.heading ? `<h1 style="font-size:24px;line-height:1.3;font-weight:700;margin:0 0 16px">${esc(o.heading)}</h1>` : ''}
<div style="font-size:15px;line-height:1.6">${o.body}</div>
${btn}
<div style="margin-top:40px;padding-top:16px;border-top:1px solid #e9e9e7;font-size:12px;line-height:1.5;color:#9b9a97">${o.footer ?? 'You received this email because of your Litpage notification settings.'}</div>
</div></body></html>`;
}

const quote = (s: string) => `<div style="margin:12px 0;padding:2px 0 2px 14px;border-left:3px solid #e9e9e7;color:#37352f">${esc(s)}</div>`;

export const mailTemplates = {
  loginCode(code: string): MailContent {
    return {
      subject: `Litpage sign-in code: ${code}`,
      text: `Sign in to Litpage\n\nUse this one-time code:\n\n${code}\n\nIf you did not request it, you can ignore this message.`,
      html: layout({
        preheader: `Your one-time Litpage code is ${code}`,
        heading: 'Sign in to Litpage',
        body: `<p>Enter this one-time code to continue:</p><p style="font-size:24px;font-weight:600;letter-spacing:2px;background:#f7f6f3;border-radius:6px;padding:12px 16px;display:inline-block">${esc(code)}</p><p style="color:#787774">If you did not request a sign-in, you can ignore this message.</p>`,
        footer: 'This code expires after 15 minutes.',
      }),
    };
  },

  pageInvite(o: { inviter: string; pageTitle: string; url: string; role?: string; workspace?: string }): MailContent {
    const title = o.pageTitle || 'Untitled';
    return {
      subject: `${o.inviter} gave you access to ${title}`,
      text: `${o.inviter} gave you access to ${title}${o.workspace ? ` from ${o.workspace}` : ''}.\n\nOpen it here: ${o.url}`,
      html: layout({
        heading: `${o.inviter} shared ${title}`,
        body: `<p><b>${esc(o.inviter)}</b> gave you access to <b>${esc(title)}</b>${o.workspace ? ` from ${esc(o.workspace)}` : ''}${o.role ? ` with ${esc(o.role)} access` : ''}.</p>`,
        button: { label: 'Open page', url: o.url },
      }),
    };
  },

  workspaceInvite(o: { inviter: string; workspace: string; url: string }): MailContent {
    return {
      subject: `${o.inviter} asked you to join ${o.workspace}`,
      text: `${o.inviter} asked you to join ${o.workspace} on Litpage.\n\nJoin here: ${o.url}`,
      html: layout({
        heading: `Join ${o.workspace} on Litpage`,
        body: `<p><b>${esc(o.inviter)}</b> asked you to join the <b>${esc(o.workspace)}</b> workspace.</p>`,
        button: { label: 'Join workspace', url: o.url },
      }),
    };
  },

  /** One Inbox notification (mention, comment, reminder, access request, property assignment …). */
  notification(o: { subject: string; headline: string; quote?: string; detail?: string; url: string; workspace?: string; button?: string }): MailContent {
    return {
      subject: o.subject,
      text: `${o.headline}${o.quote ? `\n\n“${o.quote}”` : ''}${o.detail ? `\n\n${o.detail}` : ''}\n\n${o.url}`,
      html: layout({
        preheader: o.quote ?? o.headline,
        body: `<p>${esc(o.headline)}</p>${o.quote ? quote(o.quote) : ''}${o.detail ? `<p style="color:#787774">${esc(o.detail)}</p>` : ''}`,
        button: { label: o.button ?? 'View in Litpage', url: o.url },
        footer: `You received this email because of your notification settings${o.workspace ? ` in ${esc(o.workspace)}` : ''}. Change them in Settings › Notifications.`,
      }),
    };
  },

  /** "Page updates" digest: pages you created or turned notifications on for, edited by others. */
  pageUpdates(o: { workspace: string; pages: { title: string; url: string; editors: string[]; count: number }[] }): MailContent {
    const n = o.pages.length;
    const subject = n === 1 ? `${o.pages[0].editors.join(', ')} changed ${o.pages[0].title || 'Untitled'}` : `${n} pages changed in ${o.workspace}`;
    const rows = o.pages.map((p) => `<tr><td style="padding:10px 0;border-bottom:1px solid #f1f1ef"><a href="${esc(p.url)}" style="color:#37352f;font-weight:600;text-decoration:none">${esc(p.title || 'Untitled')}</a><div style="font-size:13px;color:#787774">Edited by ${esc(p.editors.join(', '))}${p.count > 1 ? ` · ${p.count} changes` : ''}</div></td></tr>`).join('');
    return {
      subject,
      text: `Updates from ${o.workspace}\n\n${o.pages.map((p) => `- ${p.title || 'Untitled'} (changed by ${p.editors.join(', ')}): ${p.url}`).join('\n')}`,
      html: layout({ heading: 'Page updates', body: `<p>Changes to pages you follow in <b>${esc(o.workspace)}</b>:</p><table style="width:100%;border-collapse:collapse">${rows}</table>`, footer: 'Turn off “Page updates” in Settings › Notifications to stop these emails.' }),
    };
  },

  /** Weekly workspace digest: most viewed / recently created pages. */
  workspaceDigest(o: { workspace: string; url: string; popular: { title: string; url: string; views: number }[]; created: { title: string; url: string; by: string }[] }): MailContent {
    const list = (items: string[]) => (items.length ? `<ul style="padding-left:20px;margin:8px 0">${items.join('')}</ul>` : '<p style="color:#9b9a97">Nothing new this week.</p>');
    const popular = list(o.popular.map((p) => `<li style="margin:4px 0"><a href="${esc(p.url)}" style="color:#37352f">${esc(p.title || 'Untitled')}</a> <span style="color:#9b9a97">· ${p.views} ${p.views === 1 ? 'view' : 'views'}</span></li>`));
    const created = list(o.created.map((p) => `<li style="margin:4px 0"><a href="${esc(p.url)}" style="color:#37352f">${esc(p.title || 'Untitled')}</a> <span style="color:#9b9a97">· by ${esc(p.by)}</span></li>`));
    return {
      subject: `What’s happening in ${o.workspace}`,
      text: `What's happening in ${o.workspace}\n\nPopular pages:\n${o.popular.map((p) => `- ${p.title || 'Untitled'} (${p.views} views) ${p.url}`).join('\n') || '- none'}\n\nNew pages:\n${o.created.map((p) => `- ${p.title || 'Untitled'} by ${p.by} ${p.url}`).join('\n') || '- none'}`,
      html: layout({
        heading: `What’s happening in ${o.workspace}`,
        body: `<h2 style="font-size:16px;margin:16px 0 4px">Popular pages</h2>${popular}<h2 style="font-size:16px;margin:16px 0 4px">New pages</h2>${created}`,
        button: { label: `Open ${o.workspace}`, url: o.url },
        footer: 'Turn off “Workspace digest” in Settings › Notifications to stop these emails.',
      }),
    };
  },

  newLogin(o: { time: number; ip?: string; device?: string }): MailContent {
    const when = new Date(o.time).toUTCString();
    return {
      subject: 'New login to Litpage',
      text: `We noticed a new login to your Litpage account.\n\nTime: ${when}${o.device ? `\nDevice: ${o.device}` : ''}${o.ip ? `\nIP address: ${o.ip}` : ''}\n\nIf this was you, you can ignore this email. If not, log out of all devices in Settings › My account.`,
      html: layout({
        heading: 'New login to Litpage',
        body: `<p>We noticed a new login to your Litpage account.</p><p style="color:#787774">Time: ${esc(when)}${o.device ? `<br>Device: ${esc(o.device)}` : ''}${o.ip ? `<br>IP address: ${esc(o.ip)}` : ''}</p><p>If this was you, you can ignore this email. If not, go to Settings › My account and log out of all devices.</p>`,
        footer: 'Security notifications are always sent.',
      }),
    };
  },
};

// ---------------------------------------------------------------- SMTP (only with NC_SMTP_URL, never in tests)
export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
  /** allow plain-text AUTH without TLS (local relays only) */
  insecure: boolean;
}

export function smtpConfig(): SmtpConfig | null {
  const raw = process.env.NC_SMTP_URL;
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'smtp:' && u.protocol !== 'smtps:') return null;
  const secure = u.protocol === 'smtps:';
  return {
    host: u.hostname, port: Number(u.port) || (secure ? 465 : 587), secure,
    user: u.username ? decodeURIComponent(u.username) : undefined, pass: u.password ? decodeURIComponent(u.password) : undefined,
    from: process.env.NC_MAIL_FROM ?? 'Litpage <notify@localhost>', insecure: u.searchParams.get('insecure') === '1',
  };
}

function encodeHeader(s: string): string {
  // RFC 2047 for non-ASCII subjects / names; strip CR/LF (header injection)
  const clean = s.replace(/[\r\n]+/g, ' ');
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

function addressOf(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return (m ? m[1] : from).trim();
}

/** RFC 5322 message: multipart/alternative (text + html), base64 bodies, dot-stuffing happens in deliver(). */
export function buildMessage(m: MailContent & { to: string; from: string; id: string }): string {
  const boundary = `nc-${randomBytes(12).toString('hex')}`;
  const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  const fromName = /^(.*?)\s*</.exec(m.from)?.[1]?.replace(/"/g, '') ?? '';
  const headers = [
    `From: ${fromName ? `${encodeHeader(fromName)} <${addressOf(m.from)}>` : addressOf(m.from)}`,
    `To: <${m.to}>`,
    `Subject: ${encodeHeader(m.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${m.id}@${addressOf(m.from).split('@')[1] ?? 'localhost'}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  return [
    ...headers, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64(m.text),
    `--${boundary}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64(m.html),
    `--${boundary}--`, '',
  ].join('\r\n');
}

class SmtpConnection {
  private socket: Socket | TLSSocket;
  private buf = '';
  private waiters: ((line: { code: number; lines: string[] }) => void)[] = [];
  private failed: Error | null = null;
  private failWaiter: ((e: Error) => void) | null = null;

  constructor(socket: Socket | TLSSocket) {
    this.socket = socket;
    this.attach(socket);
  }

  private attach(socket: Socket | TLSSocket) {
    socket.setEncoding('utf8');
    let lines: string[] = [];
    socket.on('data', (chunk: string) => {
      this.buf += chunk;
      if (this.buf.length > 1_000_000) socket.destroy(new Error('SMTP response too large'));
      let i: number;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).replace(/\r$/, '');
        this.buf = this.buf.slice(i + 1);
        lines.push(line);
        if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
          const code = Number(line.slice(0, 3));
          const done = lines;
          lines = [];
          this.waiters.shift()?.({ code, lines: done });
        }
      }
    });
    socket.on('error', (e) => this.fail(e));
    socket.on('close', () => this.fail(new Error('SMTP connection closed')));
  }

  private fail(e: Error) {
    if (this.failed) return;
    this.failed = e;
    this.failWaiter?.(e);
  }

  read(): Promise<{ code: number; lines: string[] }> {
    if (this.failed) return Promise.reject(this.failed);
    return new Promise((resolve, reject) => {
      this.failWaiter = reject;
      this.waiters.push(resolve);
    });
  }

  async cmd(line: string, expect: number[]): Promise<{ code: number; lines: string[] }> {
    this.socket.write(`${line}\r\n`);
    const r = await this.read();
    if (!expect.includes(r.code)) throw new Error(`SMTP ${line.split(' ')[0]} failed: ${r.lines.join(' ').slice(0, 200)}`);
    return r;
  }

  upgrade(host: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.removeAllListeners('data');
      this.socket.removeAllListeners('error');
      this.socket.removeAllListeners('close');
      const tls = tlsConnect({ socket: this.socket as Socket, servername: host }, () => resolve());
      tls.once('error', reject);
      this.socket = tls;
      this.buf = '';
      this.attach(tls);
    });
  }

  write(data: string) {
    this.socket.write(data);
  }

  close() {
    this.socket.end();
  }
}

/** Deliver one message (exported for tests against a local fake server). */
export async function deliver(cfg: SmtpConfig, m: MailContent & { id: string; to: string }): Promise<void> {
  const socket = await new Promise<Socket | TLSSocket>((resolve, reject) => {
    const s = cfg.secure
      ? tlsConnect({ host: cfg.host, port: cfg.port, servername: cfg.host }, () => resolve(s))
      : netConnect({ host: cfg.host, port: cfg.port }, () => resolve(s));
    s.setTimeout(20_000, () => s.destroy(new Error('SMTP timeout')));
    s.once('error', reject);
  });
  const c = new SmtpConnection(socket);
  try {
    const greet = await c.read();
    if (greet.code !== 220) throw new Error('SMTP server rejected the connection');
    const me = hostname().replace(/[^\w.-]/g, '') || 'localhost';
    let ehlo = await c.cmd(`EHLO ${me}`, [250]);
    let tls = cfg.secure;
    if (!tls && ehlo.lines.some((l) => /STARTTLS/i.test(l))) {
      await c.cmd('STARTTLS', [220]);
      await c.upgrade(cfg.host);
      tls = true;
      ehlo = await c.cmd(`EHLO ${me}`, [250]);
    }
    if (cfg.user) {
      if (!tls && !cfg.insecure) throw new Error('SMTP server does not offer TLS; refusing to send credentials');
      const token = Buffer.from(`\0${cfg.user}\0${cfg.pass ?? ''}`, 'utf8').toString('base64');
      await c.cmd(`AUTH PLAIN ${token}`, [235]);
    }
    await c.cmd(`MAIL FROM:<${addressOf(cfg.from)}>`, [250]);
    await c.cmd(`RCPT TO:<${m.to}>`, [250, 251]);
    await c.cmd('DATA', [354]);
    const body = buildMessage({ ...m, from: cfg.from }).replace(/\r\n\./g, '\r\n..');
    c.write(`${body}\r\n.\r\n`);
    const r = await c.read();
    if (r.code !== 250) throw new Error(`SMTP DATA rejected: ${r.lines.join(' ').slice(0, 200)}`);
    await c.cmd('QUIT', [221]).catch(() => {});
  } finally {
    c.close();
  }
}

// ---------------------------------------------------------------- dev viewer: GET /api/dev/mail
function viewerFor(cookie: string | undefined): { all: boolean; email: string | null } | null {
  if (process.env.NODE_ENV === 'production') return null;
  if (devLoginCodesEnabled()) return { all: true, email: null };
  const uid = userForToken(parseCookies(cookie).lit_session);
  if (!uid) return null;
  const row = db.prepare("SELECT json_extract(data, '$.email') AS email FROM records WHERE tbl = 'lit_user' AND id = ?").get(uid) as { email: string } | undefined;
  return row?.email ? { all: false, email: row.email } : null;
}

export function registerMailRoutes(app: Hono) {
  app.get('/api/dev/mail', (c) => {
    if (isDemoMode()) return c.text(DEMO_MESSAGE, 403);
    const v = viewerFor(c.req.header('cookie'));
    if (!v) return c.text('Not found', 404);
    const to = c.req.query('to') ?? undefined;
    const list = listMail({ to: v.all ? to : v.email!, kind: c.req.query('kind') ?? undefined, limit: 200 });
    if (c.req.query('format') === 'json') return c.json({ messages: list.map(({ html: _h, ...m }) => m) });
    const rows = list.map((m) => `<tr data-mail-id="${esc(m.id)}"><td>${esc(new Date(m.createdTime).toLocaleString('en-US'))}</td><td>${esc(m.to)}</td><td><span class="kind">${esc(m.kind)}</span></td><td><a href="/api/dev/mail/${esc(m.id)}">${esc(m.subject)}</a></td><td>${esc(m.status)}</td></tr>`).join('');
    return c.html(`<!doctype html><html><head><meta charset="utf-8"><title>Dev mail outbox</title><style>
body{font:14px ui-sans-serif,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#37352f;margin:32px}
h1{font-size:22px;margin:0 0 4px}p{color:#787774;margin:0 0 16px}table{border-collapse:collapse;width:100%}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e9e9e7;vertical-align:top}th{font-weight:500;color:#787774;font-size:12px}
a{color:#2383e2;text-decoration:none}.kind{background:#f1f1ef;border-radius:4px;padding:1px 6px;font-size:12px}
</style></head><body><h1>Mail outbox</h1><p>${list.length} message${list.length === 1 ? '' : 's'}${v.all ? '' : ` to ${esc(v.email)}`} · delivery: ${smtpConfig() ? 'SMTP' : 'stored only (development)'}</p>
<table><thead><tr><th>Time</th><th>To</th><th>Kind</th><th>Subject</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No messages yet.</td></tr>'}</tbody></table></body></html>`);
  });

  app.get('/api/dev/mail/:id', (c) => {
    if (isDemoMode()) return c.text(DEMO_MESSAGE, 403);
    const v = viewerFor(c.req.header('cookie'));
    const m = v ? getMail(c.req.param('id')) : null;
    if (!v || !m || (!v.all && m.to !== v.email)) return c.text('Not found', 404);
    if (c.req.query('format') === 'json') return c.json(m);
    // the message renders inside a sandboxed frame: email HTML never runs in the service origin
    return c.html(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(m.subject)}</title><style>
body{font:14px ui-sans-serif,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#37352f;margin:24px}dl{display:grid;grid-template-columns:80px 1fr;gap:4px 12px;margin:0 0 16px}
dt{color:#787774}iframe{width:100%;height:70vh;border:1px solid #e9e9e7;border-radius:8px}pre{white-space:pre-wrap;background:#f7f6f3;padding:12px;border-radius:8px}a{color:#2383e2}
</style></head><body><p><a href="/api/dev/mail">← Outbox</a></p><dl><dt>To</dt><dd>${esc(m.to)}</dd><dt>Subject</dt><dd>${esc(m.subject)}</dd><dt>Kind</dt><dd>${esc(m.kind)}</dd><dt>Status</dt><dd>${esc(m.status)}${m.error ? ` — ${esc(m.error)}` : ''}</dd></dl>
<iframe sandbox="" srcdoc="${esc(m.html)}"></iframe><h3>Plain text</h3><pre>${esc(m.text)}</pre></body></html>`);
  });
}
