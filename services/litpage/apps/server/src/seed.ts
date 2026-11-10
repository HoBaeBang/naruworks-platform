// Server-side record creation for users and workspaces (signup/onboarding), including starter content.
import { newId } from '@nc/shared/ids.ts';
import type {
  BlockRecord, BlockType, SpaceRecord, SpaceViewRecord, TeamRecord, UserRecord, UserRootRecord, UserSettingsRecord, ParentTable,
} from '@nc/shared/records.ts';
import type { RichText } from '@nc/shared/richtext.ts';
import { getRecord, putRecord, tx } from './db.ts';
import { indexBlock } from './search.ts';
import { dayOffset, OpsBuilder, type Spec } from './content/spec.ts';
import { TEMPLATES } from './content/catalog.ts';

function save(table: any, rec: any) {
  const prev = getRecord(table, rec.id);
  rec.version = (prev?.version ?? 0) + 1;
  putRecord(table, rec);
  if (table === 'block') indexBlock(rec);
  return rec;
}

export function createUser(userId: string, email: string, name = ''): UserRecord {
  return tx(() => {
    const now = Date.now();
    const user: UserRecord = { id: userId, version: 0, email: email.toLowerCase(), name, given_name: name, created_time: now, onboarding_completed: false };
    save('lit_user', user);
    const root: UserRootRecord = { id: userId, version: 0, space_views: [] };
    save('user_root', root);
    const settings: UserSettingsRecord = {
      id: userId, version: 0,
      settings: { locale: 'en-US', time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone, start_day_of_week: 0, preferred_theme: 'system' },
    };
    save('user_settings', settings);
    return user;
  });
}

export function slugDomain(name: string): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '').slice(0, 24) || 'workspace';
  return `${base}${Math.floor(Math.random() * 9000 + 1000)}`;
}

export interface BlockSpec {
  type: BlockType;
  title?: RichText;
  format?: Record<string, unknown>;
  props?: Record<string, RichText>;
  children?: BlockSpec[];
}

function makeBlocks(specs: BlockSpec[], parentId: string, parentTable: ParentTable, spaceId: string, userId: string, now: number): string[] {
  const ids: string[] = [];
  for (const s of specs) {
    const id = newId();
    const childIds = s.children ? makeBlocks(s.children, id, 'block', spaceId, userId, now) : [];
    const block: BlockRecord = {
      id, version: 0, type: s.type,
      properties: { ...(s.title ? { title: s.title } : {}), ...(s.props ?? {}) },
      content: childIds.length ? childIds : undefined,
      format: s.format as any,
      parent_id: parentId, parent_table: parentTable, space_id: spaceId, alive: true,
      created_time: now, created_by_id: userId, created_by_table: 'lit_user',
      last_edited_time: now, last_edited_by_id: userId, last_edited_by_table: 'lit_user',
    };
    if (!block.content) delete block.content;
    if (!block.format) delete block.format;
    save('block', block);
    ids.push(id);
  }
  return ids;
}

export function createPage(opts: {
  spaceId: string; userId: string; parentId: string; parentTable: ParentTable; title: string; icon?: string; content?: BlockSpec[]; permissions?: any[];
}): BlockRecord {
  const now = Date.now();
  const id = newId();
  const contentIds = makeBlocks(opts.content ?? [], id, 'block', opts.spaceId, opts.userId, now);
  const page: BlockRecord = {
    id, version: 0, type: 'page',
    properties: { title: [[opts.title]] },
    content: contentIds,
    format: opts.icon ? { page_icon: opts.icon } : {},
    parent_id: opts.parentId, parent_table: opts.parentTable, space_id: opts.spaceId, alive: true,
    created_time: now, created_by_id: opts.userId, created_by_table: 'lit_user',
    last_edited_time: now, last_edited_by_id: opts.userId, last_edited_by_table: 'lit_user',
    ...(opts.permissions ? { permissions: opts.permissions } : {}),
  };
  save('block', page);
  return page;
}

const t = (s: string): RichText => [[s]];

function gettingStartedContent(): BlockSpec[] {
  return [
    { type: 'text', title: t('👋 Welcome to Litpage. This page is a safe place to try the workspace.') },
    { type: 'text', title: t('A few quick experiments will show you how pages, blocks, and databases fit together.') },
    { type: 'to_do', title: [['Open the '], ['/', [['c']]], [' slash menu and add a heading, callout, or sub-page.']] },
    { type: 'to_do', title: [['Hover over this line, then use the '], ['⋮⋮', [['c']]], [' drag handle to reorder it.']] },
    { type: 'to_do', title: t('Add a database, add a few rows, and switch between its table, board, and calendar views') },
    { type: 'to_do', title: t('Share a page with a teammate and choose whether they can edit, comment, or read') },
    { type: 'to_do', title: t('Ask Litpage AI to summarize a page or turn a rough idea into a first draft') },
    { type: 'to_do', title: [['Try '], ['⌘/Ctrl + P', [['c']]], [' to find a page, and '], ['⌘/Ctrl + K', [['c']]], [' to open quick actions.']] },
    {
      type: 'toggle', title: t('More shortcuts and ideas'),
      children: [
        { type: 'bulleted_list', title: t('Type @ to mention a person, page, or date') },
        { type: 'bulleted_list', title: t('Drag a block beside another one to make a column layout') },
        { type: 'bulleted_list', title: t('Use the Templates gallery when you want a ready-made starting point') },
      ],
    },
    { type: 'text', title: [] },
    { type: 'callout', title: t('Tip: press ⌘/Ctrl + Shift + L to switch between light and dark mode.'), format: { page_icon: '💡', block_color: 'gray_background' } },
  ];
}

/** `opts.welcome` replaces the "Welcome to Litpage" private page (demo sandboxes start on their own page). */
export function createWorkspace(
  userId: string, name: string, icon?: string, opts: { welcome?: { title: string; icon: string; content: BlockSpec[] } } = {},
): { space: SpaceRecord; spaceView: SpaceViewRecord; team: TeamRecord } {
  return tx(() => {
    const now = Date.now();
    const spaceId = newId();
    const space: SpaceRecord = {
      id: spaceId, version: 0, name, icon: icon ?? '', domain: slugDomain(name), pages: [],
      permissions: [{ type: 'user_permission', role: 'owner' as any, user_id: userId, added_timestamp: now }],
      plan_type: 'plus', created_by_id: userId, created_time: now,
      settings: { allow_members_to_create_pages: true, allow_guests: true, allow_public_pages: true },
      invite_link_code: newId().replace(/-/g, '').slice(0, 20),
    };
    const teamId = newId();
    const team: TeamRecord = {
      id: teamId, version: 0, space_id: spaceId, name: 'General', icon: '🏠', description: '', team_pages: [],
      parent_id: spaceId, parent_table: 'space', alive: true,
      membership: [{ user_id: userId, role: 'owner', added_time: now }],
      settings: { type: 'open', default_page_role: 'editor' }, created_time: now, created_by_id: userId, is_default: true,
    };
    space.default_team_ids = [teamId];
    save('space', space);
    save('team', team);
    const svId = newId();
    const gettingStarted = createPage({
      spaceId, userId, parentId: spaceId, parentTable: 'space', title: opts.welcome?.title ?? 'Welcome to Litpage', icon: opts.welcome?.icon ?? '👋',
      content: opts.welcome?.content ?? gettingStartedContent(), permissions: [{ type: 'user_permission', role: 'editor', user_id: userId }],
    });
    const teamHome = createPage({
      spaceId, userId, parentId: teamId, parentTable: 'team', title: 'Team Home', icon: '🏠',
      content: [
        { type: 'text', title: t('A shared home for everyone on this team. Add docs, wikis, and projects here.') },
      ],
    });
    team.team_pages = [teamHome.id];
    save('team', team);
    const spaceView: SpaceViewRecord = {
      id: svId, version: 0, space_id: spaceId, parent_id: userId, parent_table: 'user_root', alive: true,
      private_pages: [gettingStarted.id], bookmarked_pages: [], joined_teams: [teamId], first_joined_space_time: now,
      settings: {}, notify_desktop: true, notify_email: true, notify_mobile: true,
    };
    save('space_view', spaceView);
    const root = getRecord<UserRootRecord>('user_root', userId);
    if (root) save('user_root', { ...root, space_views: [...(root.space_views ?? []), svId] });
    return { space, spaceView, team };
  });
}

/** Add an existing or placeholder user to a workspace with a role (invite). */
export function addMember(spaceId: string, userId: string, role: string) {
  return tx(() => {
    const space = getRecord<SpaceRecord>('space', spaceId);
    if (!space) throw new Error('workspace record missing');
    const perms = (space.permissions ?? []).filter((p) => p.user_id !== userId);
    perms.push({ type: 'user_permission', role: role as any, user_id: userId, added_timestamp: Date.now() });
    save('space', { ...space, permissions: perms });
    const root = getRecord<UserRootRecord>('user_root', userId);
    const existing = root?.space_views?.map((id) => getRecord<SpaceViewRecord>('space_view', id)).find((sv) => sv?.space_id === spaceId);
    if (!existing) {
      const svId = newId();
      const defaults = space.default_team_ids ?? [];
      save('space_view', {
        id: svId, version: 0, space_id: spaceId, parent_id: userId, parent_table: 'user_root', alive: true,
        private_pages: [], bookmarked_pages: [], joined_teams: defaults, first_joined_space_time: Date.now(), settings: {},
      });
      if (root) save('user_root', { ...root, space_views: [...(root.space_views ?? []), svId] });
      for (const tid of defaults) {
        const team = getRecord<TeamRecord>('team', tid);
        if (team && !team.membership.some((m) => m.user_id === userId)) {
          save('team', { ...team, membership: [...team.membership, { user_id: userId, role: 'member', added_time: Date.now() }] });
        }
      }
    }
  });
}

/** Seed a small, current-looking demo workspace once. Returns the new top-level page ids. */
export function seedDemoContent(spaceId: string, userId: string): string[] {
  const space = getRecord<SpaceRecord>('space', spaceId);
  if (!space || (space.settings as any)?.demo_seed_version) return [];
  return tx(() => {
    const roots: string[] = [];
    for (const template of TEMPLATES.filter((t) => ['roadmap', 'project-tracker', 'meeting-notes', 'team-wiki'].includes(t.id))) {
      const builder = new OpsBuilder(spaceId, userId, Date.now());
      const spec = demoTemplateSpec(template.id, template.build());
      const root = builder.block(spec, spaceId, 'space', { permissions: [{ type: 'user_permission', role: 'editor', user_id: userId }] });
      roots.push(root);
      for (const op of builder.ops) save(op.pointer.table, op.args);
    }
    save('space', { ...space, pages: [...(space.pages ?? []), ...roots], settings: { ...(space.settings ?? {}), demo_seed_version: 1 } });
    return roots;
  });
}

function demoTemplateSpec(id: string, spec: Spec): Spec {
  if (id !== 'roadmap' || !spec.db) return spec;
  const ranges = [[-30, -15], [-10, 10], [15, 45], [50, 75]];
  spec.db.rows = spec.db.rows.map((row, i) => ({
    ...row,
    values: { ...row.values, rmDt: { date: dayOffset(ranges[i % ranges.length][0]), end: dayOffset(ranges[i % ranges.length][1]) } },
  }));
  if (!spec.db.views.some((view) => view.type === 'timeline')) spec.db.views = [...spec.db.views, { type: 'timeline', name: 'Timeline' }];
  if (!spec.db.views.some((view) => view.type === 'chart')) spec.db.views = [...spec.db.views, { type: 'chart', name: 'Chart' }];
  return spec;
}

export { save as saveRecord };

// ---------------------------------------------------------------- template gallery
// Starter templates live in a hidden space that has no members (never in anyone's sidebar). Template roots carry a
// public reader permission so every signed-in user can preview them; "Get template" copies the tree into the user's
// workspace (apps/server/src/api/modules/templates.ts). Re-seeded when TEMPLATE_GALLERY_VERSION changes.
export const TEMPLATE_SPACE_ID = '00000000-0000-4000-8000-00000000c0de';
export const TEMPLATE_USER_ID = '00000000-0000-4000-8000-00000000c0df';
export const TEMPLATE_GALLERY_VERSION = 5;

interface GallerySettings {
  version: number;
  pages: Record<string, string>;
}

let galleryCache: GallerySettings | null = null;

/** Ensure the template gallery exists (idempotent); returns templateId → root block id. */
export function ensureTemplateGallery(): Record<string, string> {
  if (galleryCache && galleryCache.version === TEMPLATE_GALLERY_VERSION) return galleryCache.pages;
  const existing = getRecord<SpaceRecord>('space', TEMPLATE_SPACE_ID);
  const cur = (existing?.settings as { template_gallery?: GallerySettings } | undefined)?.template_gallery;
  if (existing && cur && cur.version === TEMPLATE_GALLERY_VERSION && TEMPLATES.every((t) => cur.pages[t.id])) {
    galleryCache = cur;
    return cur.pages;
  }
  const pages: Record<string, string> = {};
  tx(() => {
    const now = Date.now();
    if (!getRecord('lit_user', TEMPLATE_USER_ID)) {
      save('lit_user', { id: TEMPLATE_USER_ID, version: 0, email: 'templates@litpage.local', name: 'Litpage', given_name: 'Litpage', created_time: now, onboarding_completed: true });
    }
    // retire the previous version's roots
    for (const id of Object.values(cur?.pages ?? {})) {
      const old = getRecord<BlockRecord>('block', id);
      if (old && old.alive) save('block', { ...old, alive: false });
    }
    const builder = new OpsBuilder(TEMPLATE_SPACE_ID, TEMPLATE_USER_ID, now);
    for (const t of TEMPLATES) {
      const spec = t.build();
      pages[t.id] = builder.block(spec, TEMPLATE_SPACE_ID, 'space', {
        permissions: [{ type: 'public_permission', role: 'reader', allow_duplicate: true }],
        ...(spec.type === 'collection_view_page' ? { format: { page_icon: t.icon, page_cover: t.cover, page_cover_position: 0.5 } } : {}),
      });
    }
    for (const op of builder.ops) save(op.pointer.table as any, { ...op.args, version: 0 });
    const space: SpaceRecord = {
      ...(existing ?? {}),
      id: TEMPLATE_SPACE_ID, version: existing?.version ?? 0, name: 'Template gallery', icon: '', domain: 'templates',
      pages: Object.values(pages), permissions: [], plan_type: 'plus', created_by_id: TEMPLATE_USER_ID, created_time: existing?.created_time ?? now,
      settings: { ...(existing?.settings ?? {}), template_gallery: { version: TEMPLATE_GALLERY_VERSION, pages } },
    } as SpaceRecord;
    save('space', space);
  });
  galleryCache = { version: TEMPLATE_GALLERY_VERSION, pages };
  return pages;
}
