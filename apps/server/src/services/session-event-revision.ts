import { createHash } from 'node:crypto';
import type { SessionEventDbRow } from '@agentctl/core/db';
import type { SessionEventRow } from '@agentctl/shared';

type Identity = Pick<SessionEventDbRow, 'sessionId' | 'id' | 'type' | 'createdAt'>;
function prefix(event: Identity): string {
  return (
    JSON.stringify([event.sessionId, event.id, event.type, event.createdAt]).slice(0, -1) + ','
  );
}

function hashParts(event: Identity, data: string, metadata: string): string {
  // Same bytes as JSON.stringify([sessionId, id, type, createdAt, dataObject, metadataObject]).
  return createHash('sha256')
    .update(prefix(event))
    .update(data)
    .update(',')
    .update(metadata)
    .update(']')
    .digest('hex');
}

export function eventDetailRevision(event: SessionEventRow): string {
  return hashParts(event, JSON.stringify(event.data), JSON.stringify(event.metadata) ?? 'null');
}

/** Raw JSON fingerprint; callers also compare parent ID and raw string lengths/nullness. */
export function persistedEventFingerprint(row: SessionEventDbRow): string {
  const metadata = row.metadata ?? 'null';
  if (row.data.isWellFormed() && metadata.isWellFormed()) return hashParts(row, row.data, metadata);
  // UTF-8 replaces lone surrogates. Use a distinct, length-framed UTF-16 domain for those rows.
  return createHash('sha256')
    .update('utf16le\0')
    .update(prefix(row))
    .update(JSON.stringify([row.data.length, metadata.length]))
    .update(row.data, 'utf16le')
    .update(metadata, 'utf16le')
    .digest('hex');
}

/** Validated repository JSON can share one digest with its canonical wire revision. */
export function eventDetailRevisionForRow(
  row: SessionEventDbRow,
  event: SessionEventRow,
  knownFingerprint?: string,
): { revision: string; fingerprint?: string } {
  const data = JSON.stringify(event.data);
  const metadata = JSON.stringify(event.metadata) ?? 'null';
  const canonical = data === row.data && metadata === (row.metadata ?? 'null');
  const revision =
    canonical && knownFingerprint ? knownFingerprint : hashParts(event, data, metadata);
  return { revision, fingerprint: canonical ? revision : knownFingerprint };
}
