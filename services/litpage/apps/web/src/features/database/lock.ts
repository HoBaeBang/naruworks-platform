// “Lock database”: block.format.block_locked on the database block. Views, filters, and sorts remain available.
// groups and the property schema freeze for everyone; rows can still be added and edited. The server enforces it
// (apps/server/src/dbaccess.ts), anyone with edit access can toggle it.
import type { BlockRecord } from '@nc/shared/records.ts';
import { me, run, setFormat } from '../../lib/blocks.ts';

export function setDatabaseLocked(block: BlockRecord, locked: boolean) {
  run(locked ? 'lockDatabase' : 'unlockDatabase', (tx) => setFormat(tx, block.id, { block_locked: locked, block_locked_by: locked ? me() : null } as never));
}
