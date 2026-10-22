export type ReverseWsAccount = { id: string; self_id: string };

/** Resolve a reverse-WebSocket account by explicit route or OneBot self_id. */
export function resolveReverseWsAccount<T extends ReverseWsAccount>(
  accounts: readonly T[],
  pathAccountId: string | undefined,
  selfId: string | undefined,
): T | null {
  if (pathAccountId !== undefined) {
    const account = accounts.find(candidate => candidate.id === pathAccountId);
    if (!account || (selfId !== undefined && selfId !== account.self_id)) return null;
    return account;
  }
  if (selfId !== undefined) return accounts.find(candidate => candidate.self_id === selfId) ?? null;
  return accounts.length === 1 ? accounts[0] ?? null : null;
}

/** OneBot v11 action responses have status and retcode; events do not. */
export function classifyActionResponse(packet: unknown, expectedEcho: string): boolean {
  if (packet === null || typeof packet !== 'object' || Array.isArray(packet)) return false;
  const value = packet as Record<string, unknown>;
  return value.echo !== undefined
    && String(value.echo) === expectedEcho
    && (value.status === 'ok' || value.status === 'failed')
    && typeof value.retcode === 'number';
}
