
// tracker, meeting notes, reading list, …). Picking one gives this empty database the template's properties, views
// and sample rows (server: applyTemplateToDatabase); the block keeps its place, type and any name already typed.
import { api } from '../../lib/api.ts';
import { records } from '../../lib/store/records.ts';
import { useUI } from '../../lib/store/ui.ts';
import { openMenu } from '../../components/Menu.tsx';
import type { Anchor } from '../../components/overlay.tsx';
import { t } from '../shell/i18n.ts';
import { categoryLabel, invalidateTemplates, loadTemplates, type TemplateInfo } from './api.ts';

const hasDatabase = (x: TemplateInfo) => !!x.outline?.db || !!x.outline?.blocks?.some((b) => b.db);

export async function applyTemplateToDatabase(templateId: string, blockId: string) {
  const res = await api<{ recordMap: any }>('applyTemplateToDatabase', { templateId, blockId });
  records.mergeRecordMap(res.recordMap);
  invalidateTemplates();
}

/** Menu of database templates; `onPicked` runs once the database was set up. */
export async function openDatabaseTemplates(anchor: Anchor, blockId: string, onPicked?: () => void) {
  let list: TemplateInfo[] = [];
  try {
    list = (await loadTemplates()).filter(hasDatabase);
  } catch (e) {
    useUI.getState().toast((e as Error).message);
    return;
  }
  openMenu(anchor, {
    width: 300,
    maxHeight: '60vh',
    search: t('lp.templates.search_templates_ea73', 'Search templates…'),
    className: 'nc-db-templates-menu',
    sections: [{
      title: t('lp.templates.database_templates', 'Database templates'),
      items: list.map((x) => ({
        id: x.id,
        label: x.name,
        text: `${x.name} ${x.tags.join(' ')}`,
        icon: <span style={{ fontSize: 16, lineHeight: 1 }}>{x.icon}</span>,
        description: `${categoryLabel(x.category)} · ${x.tags.join(', ')}`,
        onSelect: () => {
          void applyTemplateToDatabase(x.id, blockId)
            .then(() => {
              useUI.getState().toast(t('lp.templates.template_applied', 'Template applied'));
              onPicked?.();
            })
            .catch((e) => useUI.getState().toast((e as Error).message));
        },
      })),
    }],
    emptyText: t('lp.templates.no_templates_match_your_search', 'No templates match your search'),
  }, { placement: 'right-start' });
}
