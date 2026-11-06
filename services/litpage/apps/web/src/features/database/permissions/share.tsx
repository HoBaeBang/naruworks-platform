// Database parts of the Share menu: the database-only roles “Can edit content” and
// "Can also create entries" (Can open and create / Can comment and create / Can only create) and the "Entry-level access"
// section (rules: anyone selected in a Person / Created by property gets a role on that page). Rules the data
// source (collection.permission_rules); the server applies them (packages/shared/src/database/access.ts).
import { useState } from 'react';
import type { BlockRecord, CollectionRecord, Permission, PropertySchema, Role } from '@nc/shared/records.ts';
import { PAGE_RULE_ROLES, isDatabaseBlock, pageAccessRulesOf, ruleCandidateProperties, type PageAccessRule } from '@nc/shared/database/index.ts';
import { newId } from '@nc/shared/ids.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { Icon } from '../../../components/Icon.tsx';
import type { MenuItemDef, MenuSectionDef } from '../../../components/Menu.tsx';
import { openOverlay } from '../../../components/overlay.tsx';
import { run } from '../../../lib/blocks.ts';
import { useCollection } from '../../../lib/hooks.ts';
import { records } from '../../../lib/store/records.ts';
import { PropertyIcon } from '../properties/PropertyCell.tsx';
import { Toggle } from '../properties/editors/DatePicker.tsx';
import { newPropertyId } from '../actions.ts';
import { openNestedMenu } from '../menus.ts';
import './permissions.css';

const RULE_ROLE_LABEL: Record<string, string> = { editor: 'Full access', read_and_write: 'Can edit', comment_only: 'Can comment', reader: 'Can view' };
const RULE_ROLE_CAPTION: Record<string, string> = { editor: 'Edit, suggest, comment, and share with others', read_and_write: 'Edit, suggest, and comment', comment_only: 'Suggest and comment', reader: '' };

/** Roles of the Share menu role picker for a page: databases add "Can edit content" after "Can edit". */
export function rolesForPage(page: BlockRecord | undefined): Role[] {
  return isDatabaseBlock(page) ? ['editor', 'read_and_write', 'content_only_editor', 'comment_only', 'reader'] : ['editor', 'read_and_write', 'comment_only', 'reader'];
}

export const CONTENT_EDITOR_LABEL = 'Can edit content';
export const CONTENT_EDITOR_CAPTION = 'Can edit content, but can’t edit the table’s layouts or structure';

type Target = { type: 'user'; userId: string } | { type: 'space' };

function matches(p: Permission, t: Target): boolean {
  return t.type === 'user' ? p.type === 'user_permission' && p.user_id === t.userId : p.type === 'space_permission';
}

function permissionOf(page: BlockRecord | undefined, t: Target): Permission | undefined {
  return (page?.permissions ?? []).find((p) => matches(p, t));
}

/** Role label including the database "create" variants (null = use the plain role label). */
export function dbRoleLabel(page: BlockRecord | undefined, t: Target): string | null {
  if (!isDatabaseBlock(page)) return null;
  const p = permissionOf(page, t);
  if (!p?.can_create_pages_in_collection) return null;
  if (p.role === 'none') return 'Can only create';
  if (p.role === 'reader') return 'Can open and create';
  if (p.role === 'comment_only') return 'Can comment and create';
  return null;
}

function setPermission(page: BlockRecord, t: Target, patch: Partial<Permission> | null) {
  const perms = page.permissions ?? [];
  const cur = perms.find((p) => matches(p, t));
  const rest = perms.filter((p) => !matches(p, t));
  const next = patch === null ? rest : [...rest, { ...(cur ?? { type: t.type === 'user' ? 'user_permission' : 'space_permission', role: 'reader', ...(t.type === 'user' ? { user_id: t.userId } : {}), added_timestamp: Date.now() }), ...patch } as Permission];
  run('updateDatabasePermission', (tx) => tx.update('block', page.id, [], { permissions: next }));
}

/** "Created by" property of the data source (created when missing; hidden in views). */
function ensureCreatedBy(c: CollectionRecord): string {
  const found = Object.entries(c.schema).find(([, p]) => p.type === 'created_by')?.[0];
  if (found) return found;
  const pid = newPropertyId(c.schema);
  run('addCreatedByForRule', (tx) => tx.set('collection', c.id, ['schema', pid], { name: 'Created by', type: 'created_by' } as PropertySchema));
  return pid;
}

export function addPageAccessRule(c: CollectionRecord, property: string, role: Role) {
  const rules = pageAccessRulesOf(c).filter((r) => r.property !== property);
  rules.push({ id: newId(), property, role, added_timestamp: Date.now() });
  run('addPageLevelAccessRule', (tx) => tx.update('collection', c.id, [], { permission_rules: rules }));
}

export function updatePageAccessRule(c: CollectionRecord, id: string, role: Role | null) {
  const rules = pageAccessRulesOf(c).flatMap((r) => (r.id !== id ? [r] : role ? [{ ...r, role }] : []));
  run(role ? 'updatePageLevelAccessRule' : 'deletePageLevelAccessRule', (tx) => tx.update('collection', c.id, [], { permission_rules: rules }));
}

/** "How much access should entry creators get?" → page-level rule on Created by (toggleCanCreatePagesInCollection.modal). */
function openCreatorAccessModal(c: CollectionRecord, onDone: () => void) {
  openOverlay((close) => <CreatorAccess c={c} close={close} onDone={onDone} />, { placement: 'center', backdrop: 'dim' });
}

function CreatorAccess({ c, close, onDone }: { c: CollectionRecord; close: () => void; onDone: () => void }) {
  const [role, setRole] = useState<Role>('read_and_write');
  const opts: { id: Role; title: string; sub: string }[] = [
    { id: 'read_and_write', title: 'Can edit the entries they create', sub: 'Edit, suggest, and comment' },
    { id: 'editor', title: 'Have full access to the entries they create', sub: 'Edit, suggest, comment, and share with others' },
  ];
  return (
    <div className="nc-perm-modal" role="dialog" aria-label="How much access should entry creators get?">
      <div className="nc-perm-modal-title">How much access should entry creators get?</div>
      <div className="nc-perm-modal-sub">This applies to all people with Can create access in this table</div>
      {opts.map((o) => (
        <div key={o.id} role="radio" aria-checked={role === o.id} className={`nc-perm-choice ${role === o.id ? 'on' : ''}`} onClick={() => setRole(o.id)}>
          <Icon name={role === o.id ? 'radioOn' : 'radioOff'} size={16} />
          <div><div className="nc-perm-choice-title">{o.title}</div><div className="nc-perm-choice-sub">{o.sub}</div></div>
        </div>
      ))}
      <div className="nc-perm-modal-foot">
        <div role="button" className="nc-btn outline" onClick={close}>Cancel</div>
        <div role="button" className="nc-btn primary" data-testid="create-creator-rule" onClick={() => { addPageAccessRule(c, ensureCreatedBy(records.get<CollectionRecord>('collection', c.id) ?? c), role); close(); onDone(); }}>Create an entry-level access rule</div>
      </div>
    </div>
  );
}

/** Extra role-picker section for database pages: "Can also create entries" + "Can only create". */
export function dbRoleExtras(page: BlockRecord | undefined, t: Target): MenuSectionDef[] | undefined {
  if (!page || !isDatabaseBlock(page)) return undefined;
  const p = permissionOf(page, t);
  const on = !!p?.can_create_pages_in_collection;
  const role = p?.role ?? 'none';
  const c = records.get<CollectionRecord>('collection', page.collection_id ?? '');
  const ensureRule = () => {
    if (c && !pageAccessRulesOf(c).some((r) => c.schema[r.property]?.type === 'created_by')) setTimeout(() => openCreatorAccessModal(c, () => {}), 0);
  };
  const items: MenuItemDef[] = [];
  if (role === 'reader' || role === 'comment_only' || (role === 'none' && on)) {
    items.push({
      id: 'create', label: 'Can also create entries', right: <Toggle on={on} decorative />,
      onSelect: () => {
        setPermission(page, t, { can_create_pages_in_collection: !on });
        if (!on) ensureRule();
      },
    });
  }
  items.push({
    id: 'only-create', label: 'Can only create', checked: role === 'none' && on,
    onSelect: () => {
      setPermission(page, t, { role: 'none', can_create_pages_in_collection: true });
      ensureRule();
    },
  });
  return [{ items }];
}

/** Share › "Entry-level access" (rules per data source) under General access. */
export function DatabaseShareSection({ page, canManage }: { page: BlockRecord | undefined; canManage: boolean }) {
  const c = useCollection(isDatabaseBlock(page) ? page?.collection_id : undefined) as CollectionRecord | undefined;
  if (!page || !c || (c.parent_id !== page.id)) return null; // linked views follow their source database
  const rules = pageAccessRulesOf(c);
  const candidates = ruleCandidateProperties(c.schema);
  const roleMenu = (anchor: HTMLElement, rule: PageAccessRule) => openNestedMenu(anchor, {
    width: 260,
    sections: [
      { items: PAGE_RULE_ROLES.map((r) => ({ id: r, label: RULE_ROLE_LABEL[r], description: RULE_ROLE_CAPTION[r] || undefined, checked: rule.role === r, onSelect: () => updatePageAccessRule(c, rule.id, r) })) },
      { items: [{ id: 'delete', label: 'Delete permission rule', icon: 'trash', onSelect: () => updatePageAccessRule(c, rule.id, null) }] },
    ],
  }, { placement: 'bottom-end' });
  return (
    <div className="nc-share-general nc-perm-section" data-testid="entry-level-access">
      <div className="nc-share-section-title">Entry-level access</div>
      {rules.map((r) => {
        const prop = c.schema[r.property];
        return (
          <div key={r.id} className="nc-share-row nc-perm-rule" data-rule={r.id}>
            <div className="nc-share-ga-icon"><PropertyIcon prop={prop} size={18} /></div>
            <div className="who"><div className="name nc-ellipsis">Anyone in {prop?.name ?? 'Untitled property'}</div></div>
            <div role="button" className={`nc-share-role ${canManage ? '' : 'disabled'}`} onClick={(e) => canManage && roleMenu(e.currentTarget, r)}>
              <span>{RULE_ROLE_LABEL[r.role] ?? r.role}</span>
              <Icon name="chevronDown" size={14} style={{ color: 'var(--lp-icon-secondary)' }} />
            </div>
          </div>
        );
      })}
      {canManage && (
        <div role="button" className="nc-share-row nc-perm-add" data-testid="add-page-rule" onClick={(e) => openRuleCreator(e.currentTarget, c, candidates)}>
          <div className="nc-share-ga-icon"><Icon name="plus" size={18} /></div>
          <div className="who">
            <div className="name">Create new rule</div>
            <div className="email">For example, people in Assignees get edit access</div>
          </div>
        </div>
      )}
    </div>
  );
}

function RuleCreator({ c, candidates, close }: { c: CollectionRecord; candidates: [string, PropertySchema][]; close: () => void }) {
  const [prop, setProp] = useState<string | null>(candidates[0]?.[0] ?? null);
  const [role, setRole] = useState<Role>('read_and_write');
  return (
    <div className="nc-perm-creator" data-menu-keys="ignore">
      <div className="nc-perm-creator-title">Choose person field</div>
      {!candidates.length && <div className="nc-perm-empty">No available fields</div>}
      {candidates.map(([id, p]) => (
        <div key={id} role="option" aria-selected={prop === id} className={`nc-perm-option ${prop === id ? 'on' : ''}`} onClick={() => setProp(id)}>
          <PropertyIcon prop={p} size={16} /><span>{p.name}</span>{prop === id && <Icon name="checkmarkSmall" size={14} />}
        </div>
      ))}
      <div className="nc-perm-creator-sub">Grant access to a particular entry for anyone selected in this field</div>
      <div className="nc-perm-roles">
        {PAGE_RULE_ROLES.map((r) => (
          <div key={r} role="option" aria-selected={role === r} className={`nc-perm-option ${role === r ? 'on' : ''}`} onClick={() => setRole(r)}>
            <span>{RULE_ROLE_LABEL[r]}</span>{role === r && <Icon name="checkmarkSmall" size={14} />}
          </div>
        ))}
      </div>
      <div className="nc-perm-creator-foot">
        <div role="button" className={`nc-btn primary ${prop ? '' : 'disabled'}`} data-testid="create-rule" onClick={() => { if (!prop) return; addPageAccessRule(c, prop, role); close(); }}>Create rule</div>
      </div>
    </div>
  );
}

function openRuleCreator(anchor: HTMLElement, c: CollectionRecord, candidates: [string, PropertySchema][]) {
  openOverlay((close) => <div className="nc-popover"><RuleCreator c={c} candidates={candidates} close={close} /></div>, { anchor, placement: 'bottom-start', parent: Number(anchor.closest<HTMLElement>('[data-overlay-id]')?.dataset.overlayId) || undefined });
}

export { toPlainText };
