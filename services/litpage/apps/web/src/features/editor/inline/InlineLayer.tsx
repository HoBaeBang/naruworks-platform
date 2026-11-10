// Mounts the editor's inline UI once (even with several editor surfaces, e.g. page + side peek): text action
// menu, link hover pill, page mention hover card, trigger decorations, the ⌘F find bar; installs the document listeners
// they need.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { installTextMenuWatcher, TextActionMenu, hideTextMenu } from './TextActionMenu.tsx';
import { installLinkHover, LinkHoverPill } from './LinkPopups.tsx';
import { GroupMentionCard, installAtomInteractions, LinkMentionCard, PageMentionCard } from './HoverCards.tsx';
import { TriggerDecor } from './TriggerDecor.tsx';
import { FindBar, installFindShortcuts } from '../find/FindInPage.tsx';
import './inline.css';

const useLayers = create<{ ids: number[] }>(() => ({ ids: [] }));
let seq = 0;
let uninstall: (() => void) | null = null;

export function InlineLayer({ readOnly }: { readOnly: boolean }) {
  const [id] = useState(() => ++seq);
  const owner = useLayers((s) => s.ids[0] === id);
  useEffect(() => {
    const ids = useLayers.getState().ids;
    if (!ids.length) {
      const a = installTextMenuWatcher();
      const b = installLinkHover();
      const c = installAtomInteractions();
      installFindShortcuts();
      uninstall = () => { a(); b(); c(); };
    }
    useLayers.setState({ ids: [...ids, id] });
    return () => {
      const rest = useLayers.getState().ids.filter((x) => x !== id);
      useLayers.setState({ ids: rest });
      if (!rest.length) {
        uninstall?.();
        uninstall = null;
        hideTextMenu();
      }
    };
  }, [id]);
  if (!owner) return null;
  return (
    <>
      <TextActionMenu readOnly={readOnly} />
      <TriggerDecor />
      <FindBar />
      {createPortal(
        <>
          <LinkHoverPill />
          <PageMentionCard />
          <LinkMentionCard />
          <GroupMentionCard />
        </>,
        document.body,
      )}
    </>
  );
}
