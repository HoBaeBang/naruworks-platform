// Server-sent events parser for streamed HTTP responses (text/event-stream): yields one { event, data } per
// dispatched event. Comments (":"), ids and retry fields are ignored; multi-line data is joined with "\n".

export interface SseEvent {
  event: string | null;
  data: string;
}

export async function* readSse(body: AsyncIterable<Uint8Array>): AsyncGenerator<SseEvent> {
  const dec = new TextDecoder();
  let buf = '';
  let event: string | null = null;
  let data: string[] = [];
  const line = (l: string): SseEvent | null => {
    if (l === '') {
      const out = data.length ? { event, data: data.join('\n') } : null;
      event = null;
      data = [];
      return out;
    }
    if (l.startsWith(':')) return null;
    const i = l.indexOf(':');
    const field = i < 0 ? l : l.slice(0, i);
    let value = i < 0 ? '' : l.slice(i + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
    return null;
  };
  for await (const chunk of body) {
    buf += dec.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.search(/\r\n|\r|\n/)) >= 0) {
      const l = buf.slice(0, nl);
      const sep = buf[nl] === '\r' && buf[nl + 1] === '\n' ? 2 : 1;
      // a lone "\r" at the very end may be the first half of "\r\n": wait for more input
      if (buf[nl] === '\r' && nl + 1 === buf.length) break;
      buf = buf.slice(nl + sep);
      const ev = line(l);
      if (ev) yield ev;
    }
  }
  buf += dec.decode();
  if (buf) {
    const ev = line(buf.replace(/\r$/, ''));
    if (ev) yield ev;
  }
  const last = line('');
  if (last) yield last;
}
