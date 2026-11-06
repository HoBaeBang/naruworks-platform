
//   import { runAutofill } from '../ai/autofill.ts';
//   await runAutofill(rowId, propId, 'summary');                  // Summary
//   await runAutofill(rowId, propId, 'keywords');                 // Key info
//   await runAutofill(rowId, propId, 'translation', { language: 'Korean' });
//   await runAutofill(rowId, propId, 'custom', { prompt: 'Classify the sentiment' });
// The server builds the row context (title, properties, page body), asks Claude, and returns the value
// already encoded for the property type; this helper writes it with a transaction (undoable, synced).

import { api } from '../../lib/api.ts';
import { run, setProperty } from '../../lib/blocks.ts';
import { useAiStatus, NO_KEY_MESSAGE } from './aiApi.ts';

export type AutofillKind = 'summary' | 'keywords' | 'translation' | 'custom';

export interface AutofillResult {
  text: string;
  value: unknown[];
}


export async function fetchAutofill(rowId: string, propId: string, kind: AutofillKind, opts?: { prompt?: string; language?: string }): Promise<AutofillResult> {
  try {
    return await api<AutofillResult>('aiAutofill', { rowId, propId, kind, prompt: opts?.prompt, language: opts?.language });
  } catch (e: any) {
    if (e?.message === NO_KEY_MESSAGE) useAiStatus.getState().markUnconfigured();
    throw e;
  }
}


export async function runAutofill(rowId: string, propId: string, kind: AutofillKind, opts?: { prompt?: string; language?: string }): Promise<AutofillResult> {
  const res = await fetchAutofill(rowId, propId, kind, opts);
  run('aiAutofill', (tx) => setProperty(tx, rowId, propId, res.value));
  return res;
}


export async function runAutofillAll(rowIds: string[], propId: string, kind: AutofillKind, opts?: { prompt?: string; language?: string; concurrency?: number; onProgress?: (done: number, total: number) => void }) {
  let done = 0;
  const queue = [...rowIds];
  const errors: { rowId: string; message: string }[] = [];
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift()!;
      try {
        await runAutofill(id, propId, kind, opts);
      } catch (e: any) {
        errors.push({ rowId: id, message: e?.message ?? 'Failed' });
        if (e?.message === NO_KEY_MESSAGE) queue.length = 0;
      }
      opts?.onProgress?.(++done, rowIds.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts?.concurrency ?? 3, rowIds.length)) }, worker));
  return { errors };
}
