// "Store audio locally": when the workspace allows it (Settings › Meeting notes › Store audio locally),
// the microphone audio of a transcription is also recorded on this device (MediaRecorder → IndexedDB) for added
// reliability. Only the recorder has it: the block's "Audio recordings" menu lists the recordings of this note stored
// on this device, downloads them, or deletes them ("Delete recordings"). The newest 10 are kept.
const DB_NAME = 'nc-meeting-audio';
const STORE = 'recordings';
const KEEP = 10;

export interface LocalRecording {
  id: string;
  blockId: string;
  created: number;
  mime: string;
  size: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('blockId', 'blockId');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const r = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(r ? (r as IDBRequest<T>).result : undefined);
    tx.onerror = () => reject(tx.error);
  });
}

export async function listRecordings(blockId?: string): Promise<LocalRecording[]> {
  try {
    const all = ((await withStore<any[]>('readonly', (s) => s.getAll())) ?? []) as (LocalRecording & { blob: Blob })[];
    return all.filter((r) => !blockId || r.blockId === blockId).sort((a, b) => b.created - a.created).map(({ id, blockId: b, created, mime, size }) => ({ id, blockId: b, created, mime, size }));
  } catch {
    return [];
  }
}

export async function downloadRecording(id: string, name: string): Promise<boolean> {
  try {
    const r = (await withStore<any>('readonly', (s) => s.get(id))) as { blob: Blob } | undefined;
    if (!r) return false;
    const url = URL.createObjectURL(r.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } catch {
    return false;
  }
}

export async function deleteRecordings(blockId: string): Promise<void> {
  const list = await listRecordings(blockId);
  for (const r of list) await withStore('readwrite', (s) => { s.delete(r.id); });
}

async function save(blockId: string, blob: Blob) {
  const id = `${blockId}:${Date.now()}`;
  await withStore('readwrite', (s) => { s.put({ id, blockId, created: Date.now(), mime: blob.type, size: blob.size, blob }); });
  const all = await listRecordings();
  for (const old of all.slice(KEEP)) await withStore('readwrite', (s) => { s.delete(old.id); });
}

/** Start recording the microphone for `blockId`; returns a stop function (null when the browser can't record). */
export async function startLocalRecording(blockId: string): Promise<(() => void) | null> {
  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof indexedDB === 'undefined') return null;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return null;
  }
  const chunks: Blob[] = [];
  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(stream);
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    return null;
  }
  rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  rec.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    if (chunks.length) void save(blockId, new Blob(chunks, { type: rec.mimeType || 'audio/webm' })).catch(() => {});
  };
  rec.start(5000);
  return () => {
    try {
      if (rec.state !== 'inactive') rec.stop();
    } catch {
      /* stopped */
    }
  };
}
