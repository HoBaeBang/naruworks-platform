// Keyboard shortcuts modal (Help › More › Keyboard shortcuts, ⌘⌥/).
// Dialog max 960×700 radius 12 (--lp-shadow-outset-screen), title 32px/700, category pills (32px) that scroll to their section
// (scroll-spy), "more…" dropdown (Slash commands), search; rows 44px with monospace key caps.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useUI } from '../../lib/store/ui.ts';
import { Icon } from '../../components/Icon.tsx';
import { openMenu } from '../../components/Menu.tsx';
import { t } from './i18n.ts';
import '../auth/icons.tsx';
import './shortcuts.css';

type Row = [() => string, string[]];
interface Sub { title?: () => string; rows: Row[] }
interface Section { id: string; tab: () => string; title: () => string; icon?: string; subs: Sub[] }

const SECTIONS: Section[] = [
  {
    id: 'popular', icon: 'star',
    tab: () => t('lp.shell.popular', 'Popular'),
    title: () => t('lp.shell.popular', 'Popular'),
    subs: [{
      rows: [
        [() => t('lp.shell.search_this_page', 'Search this page'), ['Cmd', 'F']],
        [() => t('lp.shell.find_anything_or_revisit_a_recent', 'Find anything, or revisit a recent page'), ['Cmd', 'P']],
        [() => t('lp.shell.link_the_selected_text', 'Link the selected text'), ['Cmd', 'K']],
        [() => t('lp.shell.copy_page_link', 'Copy page link'), ['Cmd', 'L']],
        [() => t('lp.shell.previous_page', 'Previous page'), ['Cmd', '[']],
        [() => t('lp.shell.move_forward_one_page', 'Move forward one page'), ['Cmd', ']']],
        [() => t('lp.shell.preview_content_above', 'Preview content above'), ['Ctrl', 'Shift', 'K']],
        [() => t('lp.shell.preview_content_below', 'Preview content below'), ['Ctrl', 'Shift', 'J']],
        [() => t('lp.shell.switch_dark_mode', 'Switch dark mode'), ['Cmd', 'Shift', 'L']],
        [() => t('lp.shell.turn_high_contrast_on_or_off', 'Turn high contrast on or off'), ['Cmd', 'Shift', 'Option', 'L']],
      ],
    }],
  },
  {
    id: 'create', icon: 'pencil',
    tab: () => t('lp.shell.create_style', 'Create & style'),
    title: () => t('lp.shell.create_style', 'Create & style'),
    subs: [{
      rows: [
        [() => t('lp.shell.add_a_line_of_text', 'Add a line of text'), ['Enter']],
        [() => t('lp.shell.add_a_line_break_inside_a', 'Add a line break inside a text block'), ['Shift', 'Enter']],
        [() => t('lp.shell.create_comment', 'Create comment'), ['Cmd', 'Shift', 'M']],
        [() => t('lp.shell.make_selected_text_bold', 'Make selected text bold'), ['Cmd', 'B']],
        [() => t('lp.shell.make_selected_text_italic', 'Make selected text italic'), ['Cmd', 'I']],
        [() => t('lp.shell.underline_the_selected_text', 'Underline the selected text'), ['Cmd', 'U']],
        [() => t('lp.shell.cross_out_the_selected_text', 'Cross out the selected text'), ['Cmd', 'Shift', 'X']],
        [() => t('lp.shell.link_the_selected_text', 'Link the selected text'), ['Cmd', 'K']],
        [() => t('lp.shell.format_as_inline_code', 'Format as inline code'), ['Cmd', 'E']],
        [() => t('lp.shell.remove_formatting_from_selected_text', 'Remove formatting from selected text'), ['Cmd', 'Option', '\\']],
        [() => t('lp.shell.indent_content', 'Indent content'), ['Tab']],
        [() => t('lp.shell.decrease_indentation', 'Decrease indentation'), ['Shift', 'Tab']],
        [() => t('lp.shell.change_the_block_type', 'Change the block type'), ['Cmd', 'Option', '0']],
        [() => t('lp.shell.zoom_in', 'Zoom in'), ['Cmd', '=']],
        [() => t('lp.shell.zoom_out', 'Zoom out'), ['Cmd', '-']],
        [() => t('lp.shell.open_the_parent_page', 'Open the parent page'), ['Cmd', 'Shift', 'U']],
        [() => t('lp.shell.make_copies_of_selected_blocks', 'Make copies of selected blocks'), ['Cmd', 'D']],
      ],
    }],
  },
  {
    id: 'edit', icon: 'squareOnSquareDashed',
    tab: () => t('lp.shell.edit_move', 'Edit & move'),
    title: () => t('lp.shell.edit_move', 'Edit & move'),
    subs: [{
      rows: [
        [() => t('lp.shell.select_this_block', 'Select this block'), ['Esc']],
        [() => t('lp.shell.select_the_current_block', 'Select the current block'), ['Cmd', 'A']],
        [() => t('lp.shell.insert_a_space', 'Insert a space'), ['Space']],
        [() => t('lp.shell.go_left_or_pick_an_adjacent', 'Go left, or pick an adjacent block'), ['Left']],
        [() => t('lp.shell.go_right_or_pick_an_adjacent', 'Go right, or pick an adjacent block'), ['Right']],
        [() => t('lp.shell.go_up_or_pick_an_adjacent', 'Go up, or pick an adjacent block'), ['Up']],
        [() => t('lp.shell.go_down_or_pick_an_adjacent', 'Go down, or pick an adjacent block'), ['Down']],
        [() => t('lp.shell.remove_selected_blocks', 'Remove selected blocks'), ['Backspace']],
        [() => t('lp.shell.remove_selected_content', 'Remove selected content'), ['Delete']],
        [() => t('lp.shell.make_copies_of_selected_blocks', 'Make copies of selected blocks'), ['Cmd', 'D']],
        [() => t('lp.shell.add_a_line_of_text', 'Add a line of text'), ['Enter']],
        [() => t('lp.shell.modify_the_blocks_you_ve_selected', 'Modify the blocks you’ve selected'), ['Cmd', '/']],
        [() => t('lp.shell.shift_selected_block_upward', 'Shift selected block upward'), ['Cmd', 'Shift', 'Up']],
        [() => t('lp.shell.shift_selected_block_downward', 'Shift selected block downward'), ['Cmd', 'Shift', 'Down']],
        [() => t('lp.shell.open_or_collapse_every_toggle', 'Open or collapse every toggle'), ['Cmd', 'Option', 'T']],
        [() => t('lp.shell.highlight_the_selected_text', 'Highlight the selected text'), ['Cmd', 'Shift', 'H']],
      ],
    }],
  },
  {
    id: 'markdown', icon: 'code',
    tab: () => t('lp.shell.markdown', 'Markdown'),
    title: () => t('lp.shell.markdown_style', 'Markdown style'),
    subs: [{
      rows: [
        [() => t('lp.shell.make_text_bold_wrap_it_in', 'Make text bold (wrap it in **)'), ['**text**']],
        [() => t('lp.shell.make_text_italic_wrap_it_in', 'Make text italic (wrap it in *)'), ['*text*']],
        [() => t('lp.shell.format_as_inline_code_wrap_it', 'Format as inline code (wrap it in `)'), ['`code`']],
        [() => t('lp.shell.strikethrough_wrap_with', 'Strikethrough (wrap with ~)'), ['~text~']],
        [() => t('lp.shell.create_an_h1_heading', 'Create an H1 heading'), ['#', 'Space']],
        [() => t('lp.shell.create_an_h2_heading', 'Create an H2 heading'), ['##', 'Space']],
        [() => t('lp.shell.create_an_h3_heading', 'Create an H3 heading'), ['###', 'Space']],
        [() => t('lp.shell.create_a_bulleted_list', 'Create a bulleted list'), ['- / * /', '/ •', 'Space']],
        [() => t('lp.shell.create_a_numbered_list', 'Create a numbered list'), ['1.', 'Space']],
        [() => t('lp.shell.insert_a_to_do_item', 'Insert a to-do item'), ['[]', 'Space']],
        [() => t('lp.shell.create_a_toggle_list', 'Create a toggle list'), ['>', 'Space']],
        [() => t('lp.shell.create_a_quote_block', 'Create a quote block'), ['"', 'Space']],
      ],
    }],
  },
  {
    id: 'commands', icon: 'command',
    tab: () => t('lp.shell.commands', 'Commands'),
    title: () => t('lp.shell.commands', 'Commands'),
    subs: [
      {
        title: () => t('lp.shell.at_commands', 'At commands'),
        rows: [
          [() => t('lp.shell.mention_someone', 'Mention someone'), ['@person']],
          [() => t('lp.shell.mention_this_page', 'Mention this page'), ['@page']],
          [() => t('lp.shell.mention_this_date', 'Mention this date'), ['@date']],
          [() => t('lp.shell.set_a_reminder', 'Set a reminder'), ['@remind']],
        ],
      },
      {
        title: () => t('lp.shell.create_commands', 'Create commands'),
        rows: [
          [() => t('lp.shell.create_a_subpage', 'Create a subpage'), ['+sub-page name']],
          [() => t('lp.shell.make_a_page_in_another_location', 'Make a page in another location'), ['+new page name']],
          [() => t('lp.shell.add_a_page_link', 'Add a page link'), ['+page name']],
        ],
      },
      {
        title: () => t('lp.shell.bracket_commands', 'Bracket commands'),
        rows: [
          [() => t('lp.shell.add_a_page_link', 'Add a page link'), ['[[page name']],
          [() => t('lp.shell.create_a_subpage', 'Create a subpage'), ['[[sub-page name']],
          [() => t('lp.shell.make_a_page_in_another_location', 'Make a page in another location'), ['[[new page name']],
        ],
      },
    ],
  },
  {
    id: 'slash',
    tab: () => t('lp.shell.slash_commands', 'Slash commands'),
    title: () => t('lp.shell.slash_commands', 'Slash commands'),
    subs: [
      {
        title: () => t('lp.shell.basic', 'Basic'),
        rows: [
          [() => t('lp.shell.create_a_text_block', 'Create a text block'), ['/text']],
          [() => t('lp.shell.create_a_new_page', 'Add a page'), ['/page']],
          [() => t('lp.shell.create_a_bulleted_list', 'Create a bulleted list'), ['/bullet']],
          [() => t('lp.shell.create_a_numbered_list', 'Create a numbered list'), ['/num']],
          [() => t('lp.shell.start_a_checklist', 'Start a checklist'), ['/todo']],
          [() => t('lp.shell.create_a_toggle_list', 'Create a toggle list'), ['/toggle']],
          [() => t('lp.shell.create_divider', 'Create divider'), ['/div']],
          [() => t('lp.shell.create_a_quote_block', 'Create a quote block'), ['/quote']],
          [() => t('lp.shell.create_an_h1_heading', 'Create an H1 heading'), ['/h1']],
          [() => t('lp.shell.create_an_h2_heading', 'Create an H2 heading'), ['/h2']],
          [() => t('lp.shell.create_an_h3_heading', 'Create an H3 heading'), ['/h3']],
          [() => t('lp.shell.insert_a_page_link', 'Insert a page link'), ['/link']],
        ],
      },
      {
        title: () => t('lp.shell.inline', 'Inline'),
        rows: [
          [() => t('lp.shell.tag_someone_or_a_page', 'Tag someone or a page'), ['/mention']],
          [() => t('lp.shell.insert_a_date_reminder', 'Insert a date/reminder'), ['/date']],
          [() => t('lp.shell.add_a_tex_equation', 'Insert a TeX formula'), ['/equation']],
          [() => t('lp.shell.open_the_emoji_picker', 'Open the emoji picker'), ['/emoji']],
        ],
      },
      {
        title: () => t('lp.shell.media', 'Media'),
        rows: [
          [() => t('lp.shell.insert_an_image_file_or_link', 'Insert an image file or link'), ['/image']],
          [() => t('lp.shell.embed_pdf', 'Embed PDF'), ['/pdf']],
          [() => t('lp.shell.create_a_web_bookmark', 'Create a web bookmark'), ['/book']],
          [() => t('lp.shell.insert_a_video_file_or_link', 'Insert a video file or link'), ['/video']],
          [() => t('lp.shell.insert_an_audio_file_or_link', 'Insert an audio file or link'), ['/audio']],
          [() => t('lp.shell.create_a_code_block', 'Create a code block'), ['/code']],
          [() => t('lp.shell.upload_file', 'Upload file'), ['/file']],
          [() => t('lp.shell.add_embed', 'Add embed'), ['/embed']],
        ],
      },
      {
        title: () => t('lp.shell.advanced', 'Advanced'),
        rows: [
          [() => t('lp.shell.duplicate_this_block', 'Duplicate this block'), ['/duplicate']],
          [() => t('lp.shell.put_this_block_on_another_page', 'Put this block on another page'), ['/moveto']],
          [() => t('lp.shell.delete_this_block', 'Delete this block'), ['/delete']],
          [() => t('lp.shell.insert_a_table_of_contents', 'Insert a table of contents'), ['/toc']],
          [() => t('lp.shell.create_a_template_button', 'Create a template button'), ['/button']],
          [() => t('lp.shell.insert_the_breadcrumb_menu', 'Insert the breadcrumb menu'), ['/bread']],
          [() => t('lp.shell.add_a_math_equation', 'Add a math equation'), ['/math']],
        ],
      },
    ],
  },
];

/** Tabs shown in the pill row; the rest live in the "more…" dropdown. */
/** widths of the tab glyphs (svg viewBox width at 20px height) */
const TAB_ICON_WIDTH: Record<string, number> = { popular: 15.2, create: 11.62, edit: 15.51, markdown: 17.46, commands: 13.75 };
const PRIMARY_TABS = ['popular', 'create', 'edit', 'markdown', 'commands'];

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function keyLabel(k: string): string {
  if (isMac) return k;
  if (k === 'Cmd') return 'Ctrl';
  if (k === 'Option') return 'Alt';
  return k;
}

export function ShortcutsModal() {
  const close = () => useUI.getState().set({ shortcutsOpen: false });
  const [active, setActive] = useState('popular');
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef(new Map<string, HTMLDivElement>());
  const firstTab = useRef<HTMLDivElement>(null);
  const scrollingTo = useRef<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('.lit-overlay-container .nc-overlay')) return;
      e.preventDefault();
      e.stopPropagation();
      if (searching) {
        setSearching(false);
        setQ('');
      } else close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [searching]);

  // scroll-spy: the category pill follows the section at the top of the list
  const onScroll = () => {
    const sc = scroller.current;
    if (!sc || q) return;
    if (scrollingTo.current) return;
    const top = sc.getBoundingClientRect().top + 24;
    let current = SECTIONS[0].id;
    for (const s of SECTIONS) {
      const el = sectionRefs.current.get(s.id);
      if (el && el.getBoundingClientRect().top <= top) current = s.id;
    }
    if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2) current = SECTIONS[SECTIONS.length - 1].id;
    setActive(current);
  };

  // the selected section scrolls to the top of the list (under the 16px fade), including Popular on open
  useLayoutEffect(() => {
    const el = sectionRefs.current.get(SECTIONS[0].id);
    if (scroller.current && el) scroller.current.scrollTop = el.offsetTop;
  }, []);
  // …and focuses the first pill ("Popular" shows the focus-visible ring after ⌘⌥/)
  useEffect(() => {
    firstTab.current?.focus({ preventScroll: true });
  }, []);

  const jump = (id: string) => {
    const sc = scroller.current;
    const el = sectionRefs.current.get(id);
    setActive(id);
    if (!sc || !el) return;
    scrollingTo.current = id;
    sc.scrollTo({ top: el.offsetTop, behavior: 'smooth' });
    setTimeout(() => { scrollingTo.current = null; }, 600);
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return SECTIONS;
    return SECTIONS.map((s) => ({
      ...s,
      subs: s.subs
        .map((sub) => ({ ...sub, rows: sub.rows.filter(([label, keys]) => label().toLowerCase().includes(needle) || keys.join(' ').toLowerCase().includes(needle)) }))
        .filter((sub) => sub.rows.length),
    })).filter((s) => s.subs.length);
  }, [q]);

  const moreSelected = !PRIMARY_TABS.includes(active);

  return createPortal(
    <div className="nc-kbd-layer" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="lit-modal-underlay nc-kbd-underlay" onMouseDown={close} />
      <div className="lit-dialog nc-kbd-dialog" role="dialog" aria-label={t('lp.shell.keyboard_shortcuts', 'Keyboard shortcuts')}>
        <div className="nc-kbd-inner">
          <h1 className="nc-kbd-title">{t('lp.shell.keyboard_shortcuts', 'Keyboard shortcuts')}</h1>
          <div className="nc-kbd-toolbar">
            {searching ? (
              <div className="nc-kbd-search">
                <Icon name="magnifyingGlass" size={18} style={{ color: 'var(--lp-icon-secondary)' }} />
                <input autoFocus placeholder={t('lp.shell.search_f54f', 'Search…')} value={q} onChange={(e) => setQ(e.target.value)} />
                <div role="button" aria-label={t('lp.shell.close_search', 'Close search')} className="nc-kbd-iconbtn" onClick={() => { setSearching(false); setQ(''); }}>
                  <Icon name="close" size={16} style={{ color: 'var(--lp-icon-secondary)' }} />
                </div>
              </div>
            ) : (
              <>
                <div className="nc-kbd-tabs">
                  {SECTIONS.filter((s) => PRIMARY_TABS.includes(s.id)).map((s, i) => (
                    <div
                      key={s.id}
                      ref={i === 0 ? firstTab : undefined}
                      role="button"
                      tabIndex={0}
                      aria-pressed={active === s.id}
                      className={`nc-kbd-tab ${active === s.id ? 'selected' : ''}`}
                      onClick={() => jump(s.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(s.id); } }}
                    >
                      {/* the glyphs are 20px tall with cropped viewBoxes (width auto): keep their widths */}
                      {s.icon && <span className="nc-kbd-tab-icon" style={{ width: TAB_ICON_WIDTH[s.id] ?? 20 }}><Icon name={s.icon} size={16} style={{ color: 'var(--lp-icon-secondary)' }} /></span>}
                      <span>{s.tab()}</span>
                    </div>
                  ))}
                  <div
                    role="button"
                    aria-haspopup="dialog"
                    className={`nc-kbd-tab ${moreSelected ? 'selected' : ''}`}
                    onClick={(e) => openMenu(e.currentTarget as HTMLElement, {
                      width: 240,
                      sections: [{
                        items: SECTIONS.filter((s) => !PRIMARY_TABS.includes(s.id)).map((s) => ({
                          label: s.tab(),
                          icon: <span className="nc-kbd-slash">/</span>,
                          onSelect: () => jump(s.id),
                        })),
                      }],
                    }, { placement: 'bottom-start' })}
                  >
                    <span>{t('lp.shell.more_ccd7', 'more…')}</span>
                  </div>
                </div>
                <div role="button" aria-label={t('lp.shell.search_f54f', 'Search…')} className="nc-kbd-iconbtn round" onClick={() => setSearching(true)}>
                  <Icon name="magnifyingGlass" size={20} style={{ color: 'var(--lp-icon-secondary)' }} />
                </div>
              </>
            )}
          </div>
          {/* plain overflow:auto (no .lit-scroller gutter: rows span the full 896px) */}
          <div className="nc-kbd-list" ref={scroller} onScroll={onScroll}>
            <div className="nc-kbd-fade" />
            {filtered.length === 0 && (
              <div className="nc-kbd-empty">
                <div className="title">{t('lp.shell.no_matches', 'No matches')}</div>
                <div className="desc">{t('lp.shell.search_another_term_or_browse_the', 'Search another term or browse the categories above.')}</div>
              </div>
            )}
            {filtered.map((s) => (
              <div key={s.id} className="nc-kbd-section" ref={(el) => { if (el) sectionRefs.current.set(s.id, el); }} data-section={s.id}>
                <h2>{s.title()}</h2>
                {s.subs.map((sub, i) => (
                  <div key={i}>
                    {sub.title && <h3>{sub.title()}</h3>}
                    {sub.rows.map(([label, keys], j) => (
                      <div key={j} className="nc-kbd-row">
                        <span className="nc-kbd-action">{label()}</span>
                        <div className="nc-kbd-keys">
                          {keys.map((k, n) => <div key={n} className="nc-kbd-key"><code>{keyLabel(k)}</code></div>)}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
