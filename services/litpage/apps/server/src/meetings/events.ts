// "Meeting note summarized": the hook for Custom Agents subscribes to the meeting-summary event. Called right after a summary is written, with the transcript
// and summary, as the person who produced it. Listeners must not throw (errors are logged).
export interface MeetingSummarizedEvent {
  spaceId: string;
  /** the AI Meeting Notes block */
  blockId: string;
  /** the page (or database row) holding it */
  pageId: string;
  /** who stopped / retried the summary */
  userId: string;
  title: string;
  summaryMarkdown: string;
  transcript: string;
}

const listeners: ((e: MeetingSummarizedEvent) => void | Promise<void>)[] = [];

/** Subscribe to finished meeting summaries (returns an unsubscribe function). */
export function onMeetingNoteSummarized(fn: (e: MeetingSummarizedEvent) => void | Promise<void>): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

export function emitMeetingSummarized(e: MeetingSummarizedEvent) {
  for (const fn of listeners) {
    try {
      const r = fn(e);
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch((err) => console.error('[meetings] summarized listener failed', err));
    } catch (err) {
      console.error('[meetings] summarized listener failed', err);
    }
  }
}
