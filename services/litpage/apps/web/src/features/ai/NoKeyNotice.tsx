
import { Icon } from '../../components/Icon.tsx';
import { openOverlay, PopoverSurface } from '../../components/overlay.tsx';
import { NO_KEY_MESSAGE, useAiStatus } from './aiApi.ts';

export function openKeyHelp(anchor: HTMLElement) {
  openOverlay((close) => <KeyHelp close={close} />, { anchor, placement: 'bottom-start', offset: 6 });
}

function KeyHelp({ close }: { close: () => void }) {
  const configured = useAiStatus((s) => s.configured);
  return (
    <PopoverSurface width={340}>
      <div className="nc-ai-keyhelp">
        <div className="nc-ai-keyhelp-title">Connect Litpage AI to a model provider</div>
        <p>Litpage AI runs on the provider set up on the server: OpenAI Responses API or the Anthropic Claude API. Add it to apps/server/.env.local and restart the server:</p>
        <pre>NC_AI_PROVIDER=openai{'\n'}OPENAI_API_KEY=sk-proj-…{'\n'}# optional: OPENAI_BASE_URL=https://api.openai.com/v1{'\n'}# or: ANTHROPIC_API_KEY=sk-ant-…</pre>
        <p className="nc-ai-keyhelp-sub">Keys stay on the server and are never sent to the browser.</p>
        <div className="nc-ai-keyhelp-actions">
          {configured && <span className="nc-ai-keyhelp-ok"><Icon name="check" size={14} /> Connected</span>}
          <button
            className="nc-btn outline"
            onClick={() => {
              void useAiStatus.getState().refresh();
            }}
          >
            Check again
          </button>
          <button className="nc-btn primary" onClick={close}>Done</button>
        </div>
      </div>
    </PopoverSurface>
  );
}


export function NoKeyNotice({ compact }: { compact?: boolean }) {
  return (
    <div className={`nc-ai-nokey ${compact ? 'compact' : ''}`} role="status">
      <Icon name="info" size={14} style={{ color: 'var(--lp-blue-icon-accent)', flexShrink: 0 }} />
      <span>{NO_KEY_MESSAGE}.</span>
      <span role="button" className="nc-ai-banner-link" onMouseDown={(e) => e.preventDefault()} onClick={(e) => openKeyHelp(e.currentTarget)}>How to connect</span>
    </div>
  );
}
