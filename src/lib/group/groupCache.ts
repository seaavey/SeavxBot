import type { GroupMetadata, WASocket } from "@whiskeysockets/baileys";

const TTL_MS = 30_000;

interface Entry {
  meta: GroupMetadata;
  at: number;
}

const cache = new Map<string, Entry>();

/**
 * Group metadata is needed for every inbound group message (roles, mentions)
 * and again for every outgoing group send (sender-key fan-out). Fetching it per
 * message costs a full IQ round trip, so hold it briefly and drop it whenever
 * the group actually changes.
 */
export async function getGroupMetadata(
  sock: WASocket,
  jid: string,
): Promise<GroupMetadata | undefined> {
  const hit = cache.get(jid);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.meta;

  try {
    const meta = await sock.groupMetadata(jid);
    cache.set(jid, { meta, at: Date.now() });
    return meta;
  } catch (err) {
    // A stale entry beats no entry: permissions still resolve while the group
    // is temporarily unreachable.
    console.error(`Failed to fetch metadata for ${jid}:`, err);
    return hit?.meta;
  }
}

/** Called from the group events so a cached copy never outlives a real change. */
export function invalidateGroupMetadata(jid: string): void {
  cache.delete(jid);
}

/**
 * Applies a known change to the cached copy so a follow-up command in the same
 * 30s window sees the new state. `groups.update` arrives later and replaces the
 * whole entry anyway, so this only bridges the gap.
 */
export function patchGroupMetadata(
  jid: string,
  patch: (meta: GroupMetadata) => GroupMetadata,
): void {
  const hit = cache.get(jid);
  if (!hit) return;

  cache.set(jid, { meta: patch(hit.meta), at: hit.at });
}
