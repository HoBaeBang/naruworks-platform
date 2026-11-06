# Architecture

Litpage is a single-process web app: a Node server that owns the data and a React client that edits it optimistically.

## Stack

| Area | Choice |
|---|---|
| Web | React 19, TypeScript, Vite, a small in-house router |
| Editor | One `contentEditable` leaf per block (`plaintext-only`) with our own rich-text model |
| Client state | Record store (`table:id` → value, version, role) + transaction queue + undo stack; UI state in zustand |
| Server | Node 26 (type stripping, no build step) + Hono + `node:sqlite` (FTS5 trigram search) + WebSocket |
| Styling | Plain CSS with design tokens (`--lp-*`, `apps/web/src/styles/tokens.css`, palette based on Tailwind CSS colors) |
| Icons | Lucide (`lucide-react`) through one registry (`apps/web/src/components/Icon.tsx`) |
| Tests | Vitest unit tests per package, Playwright end-to-end scripts against a running dev server |

## Layout

```
packages/shared/src/   records, operations (set/update/listAfter/listBefore/listRemove, spliceText), rich text,
                       permissions, database query and formula engine, automations, forms
apps/server/src/       main.ts / app.ts (HTTP + WebSocket), db.ts, records.ts (permissions, transactions),
                       auth.ts, realtime.ts, search.ts, history.ts (versions, activity), seed.ts,
                       api/handlers.ts (core RPC) and api/modules/*.ts (feature RPCs, auto-registered),
                       ai/ (provider layer, tools), agents/, automations/, meetings/,
                       publicApi/ (REST API for integrations)
apps/web/src/          lib/ (api, router, store, hooks), components/ (Icon, Menu, overlay, Modal, Tooltip),
                       features/ (auth, shell, page, editor, database, comments, search, settings, home, ai, …)
e2e/                   one Playwright script per area (lib.mjs: launch, signup, newPage)
```

## Data model

Everything is a record. A record has a table name, an id, a version and a JSON value:

- `block`: pages, content blocks and database rows; trees use the parent's `content[]` plus the child's
  `parent_id` / `parent_table`; deleting sets `alive: false` and removes the id from the parent list;
- `collection` (a database's schema and properties) and `collection_view` (its views);
- `space` (workspace), `space_view` (per-user sidebar state), `team`, `lit_user`, `user_root`, `user_settings`;
- `discussion`, `comment`, `notification`, `page_visit` and feature records (agents, automations, forms…).

Rich text is an array of runs: `[["plain"], ["bold", [["b"]]], ["‣", [["p", pageId]]]]` (`packages/shared/src/richtext.ts`).
Property values use the same run format (select `[["Value"]]`, checkbox `[["Yes"]]`, mentions with `‣`).

## Changes go through transactions

```ts
import { run } from '../../lib/blocks.ts';
run('pageSettings', (tx) => {
  tx.update('block', id, ['format'], { page_full_width: true });
});
```

The client applies operations immediately, batches them (about 80 ms) to the server's `applyChanges` RPC and
rebases on the record map the server returns. Undo/redo replays inverse operations; typing is coalesced by key.
Server-only work (duplicate, permanent delete, search, exports) uses `api('name', body)` RPCs.

**Text sync.** Title edits are sent as `spliceText` operations (`{ base, start, end, insert }`, the range the author saw).
Server and client map the range onto the current text with a character diff, so concurrent edits at different
places in the same block both survive, and undo only reverts your own change. Retries are idempotent by
transaction id. Other properties are last-writer-wins `set`s. See `packages/shared/src/textmerge.ts` and
`e2e/concurrent-typing.mjs`.

**Realtime.** Clients subscribe to their workspaces over a WebSocket (`apps/server/src/realtime.ts`); after each
transaction the server pushes the changed records to the people allowed to see them, and the client merges them.

## AI

All AI features go through one provider configured on the server (`apps/server/src/ai/providers/`): an OpenAI
Responses-compatible endpoint or Anthropic. The server never sends keys to the browser and masks them in logs.
Tests use local mock servers only.

## UI conventions

- Strings: `t('lp.<area>.<slug>', 'English default', values?)` with ICU plural/select; the Korean catalog is
  `apps/web/src/features/shell/i18n.ko-KR.json`.
- Colors, shadows and spacing come from `var(--lp-…)` tokens (light and dark themes); avoid hard-coded colors.
- Menus and popovers: `openMenu(anchor, { sections, search, footer })`, `openOverlay(render, opts)`; tooltips via
  `data-tooltip` attributes.
- Icons: `<Icon name="…">`; add new names to the Lucide table in `Icon.tsx` (or a feature's `registerIcons` map).
- Block renderers live in `*.block.tsx` files and call `registerBlock([...types], Component)`; database views live in
  `*.view.tsx` and call `registerView('board', Component)`.
- New server RPCs: `apps/server/src/api/modules/<area>.ts` exporting `handlers = { name(ctx, body) { … } }`.
