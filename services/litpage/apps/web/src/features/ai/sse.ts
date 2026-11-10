
export interface SseEvent {
  event: string;
  data: string;
}

export function createSseParser(onEvent: (e: SseEvent) => void) {
  let buf = '';
  let event = '';
  let data: string[] = [];
  const dispatch = () => {
    if (data.length) onEvent({ event: event || 'message', data: data.join('\n') });
    event = '';
    data = [];
  };
  const line = (l: string) => {
    if (l === '') return dispatch();
    if (l.startsWith(':')) return; // comment / keep-alive
    const i = l.indexOf(':');
    const field = i < 0 ? l : l.slice(0, i);
    let value = i < 0 ? '' : l.slice(i + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  };
  return {
    push(chunk: string) {
      buf += chunk;
      let nl: number;
      while ((nl = buf.search(/\r\n|\r|\n/)) >= 0) {
        const l = buf.slice(0, nl);
        const sep = buf.startsWith('\r\n', nl) ? 2 : 1;
        buf = buf.slice(nl + sep);
        line(l);
      }
    },
    end() {
      if (buf) line(buf);
      buf = '';
      dispatch();
    },
  };
}
