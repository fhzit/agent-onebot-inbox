/** Operator-controlled metadata-only retention preview/apply panel. */
export type RetentionPanelOptions = {
  root: ParentNode;
  accountId: () => string;
  post: (path: string, body: unknown) => Promise<Record<string, unknown>>;
  confirm: (message: string) => boolean;
};

export function bindAiAdvisoryRetentionPanel(options: RetentionPanelOptions): void {
  const get = <T extends HTMLElement>(selector: string) => options.root.querySelector(selector) as T | null;
  const status = get<HTMLElement>('[data-retention-status]');
  const list = get<HTMLElement>('[data-retention-list]');
  const previewButton = get<HTMLButtonElement>('[data-retention-preview]');
  const applyButton = get<HTMLButtonElement>('[data-retention-apply]');
  if (applyButton) applyButton.disabled = true;
  let token = '';
  let account = '';
  const clear = (message: string) => {
    token = ''; account = ''; if (applyButton) applyButton.disabled = true;
    list?.replaceChildren(); if (status) status.textContent = message;
  };
  const preview = async () => {
    const selected = options.accountId(); clear(selected ? 'Loading preview; no records are deleted.' : 'Select an account.');
    if (!selected) return;
    if (previewButton) previewButton.disabled = true;
    try {
      const data = await options.post('/api/admin/ai-advisory-retention/preview', { accountId: selected });
      if (selected !== options.accountId()) return;
      if (typeof data.confirmation_token !== 'string' || !Array.isArray(data.candidates)) throw new Error('Invalid preview');
      token = data.confirmation_token; account = selected;
      for (const candidate of data.candidates as Record<string, unknown>[]) {
        const article = list?.ownerDocument.createElement('article');
        if (!article) continue;
        const heading = article.ownerDocument.createElement('strong');
        heading.textContent = 'Expired advisory metadata';
        const detail = article.ownerDocument.createElement('span');
        detail.textContent = `Account ${String(candidate.accountId ?? '')} · Message ID ${String(candidate.messageId ?? '')} · Policy ${String(candidate.policyVersion ?? '')}`;
        article.append(heading, detail); list?.append(article);
      }
      if (status) status.textContent = `Preview: ${data.cutoff}; ${String(data.retentionDays)} days; ${data.candidates.length} of ${String(data.limit)} in this batch${data.hasMore ? '; more remain' : ''}. Message bodies are not shown.`;
      if (applyButton) applyButton.disabled = false;
    } catch { clear('Preview failed; retry.'); }
    finally { if (previewButton) previewButton.disabled = false; }
  };
  const resetForAccount = () => {
    token = '';
    account = '';
    if (applyButton) applyButton.disabled = true;
    list?.replaceChildren();
    if (status) status.textContent = '选择账号并预览；不会自动删除。';
  };
  get<HTMLSelectElement>('#retentionAccount')?.addEventListener('change', resetForAccount);
  const apply = async () => {
    if (!token || !account || account !== options.accountId()) return;
    if (!options.confirm(`Apply this preview to account ${account}? Only the listed advisory metadata will be deleted; messages are not deleted.`)) return;
    const currentToken = token, currentAccount = account;
    if (applyButton) applyButton.disabled = true;
    try {
      const result = await options.post('/api/admin/ai-advisory-retention/apply', { accountId: currentAccount, confirmation_token: currentToken });
      clear(`Cleanup complete: requested ${String(result.requested)}, deleted ${String(result.deleted)} advisory metadata records.`);
    } catch { clear('Apply failed; preview again before retrying.'); }
  };
  previewButton?.addEventListener('click', () => { void preview(); });
  applyButton?.addEventListener('click', () => { void apply(); });
}

export function createAiAdvisoryRetentionPanelRuntime() {
  const documentRef = globalThis.document;
  const api = (globalThis as typeof globalThis & { api?: (path: string, options?: RequestInit) => Promise<Record<string, unknown>> }).api;
  if (!documentRef || typeof api !== 'function') return;
  bindAiAdvisoryRetentionPanel({
    root: documentRef,
    accountId: () => (documentRef.getElementById('retentionAccount') as HTMLSelectElement | null)?.value ?? '',
    confirm: message => globalThis.confirm(message),
    post: (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}
