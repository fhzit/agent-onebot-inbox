/** Safe DOM controller for browsing persisted advisory metadata for an explicitly selected account. */
export function populateAiAdvisoryAccounts(accounts: readonly { id: string; alias: string }[]): void {
  for (const selector of ['#aiAdvisoryAccount', '#retentionAccount']) {
    const select = document.querySelector<HTMLSelectElement>(selector);
    if (!select) continue;
    const current = select.value;
    select.replaceChildren();
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = '选择账号';
    select.append(empty);
    for (const account of accounts) {
      const option = document.createElement('option');
      option.value = account.id;
      option.textContent = `${account.alias} (${account.id})`;
      select.append(option);
    }
    if (accounts.some(account => account.id === current)) select.value = current;
  }
}

export type AiAdvisoryPanelOptions = {
  root: ParentNode;
  accountId: () => string;
  get: (path: string) => Promise<unknown>;
  pageSize?: number;
  /** Deployment prefix for API requests, e.g. `/console`; omit for root deployments. */
  basePath?: string;
};

type Advisory = { messageId: string; label: string; confidence: number; model: string; policyVersion: string; createdAt: string };
type Cursor = string | { before: string; before_message_id: string } | { before: string; messageId: string } | null;
type Page = { advisories: Advisory[]; nextCursor: Cursor };
const MAX_PAGE_SIZE = 100;

type RootQuery = ParentNode & { querySelector(selector: string): Element | null };
function findElement<T extends Element>(root: ParentNode, selectors: readonly string[]): T | null {
  const query = root as RootQuery;
  for (const selector of selectors) {
    const found = query.querySelector(selector);
    if (found) return found as T;
    const fallback = query.querySelector(selector.slice(selector.lastIndexOf(' ') + 1));
    if (fallback) return fallback as T;
  }
  return null;
}

export function bindAiAdvisoryPanel(options: AiAdvisoryPanelOptions): { load(): Promise<void>; loadMore(): Promise<void> } {
  const { root } = options;
  const getPage = options.get;
  const status = findElement<HTMLElement>(root, ['[data-ai-advisory-status]', '#aiAdvisoryStatus']);
  const list = findElement<HTMLElement>(root, ['[data-ai-advisory-list]', '#aiAdvisoryList']);
  const loadButton = findElement<HTMLButtonElement>(root, ['[data-ai-advisory-load]', '#aiAdvisoryLoad']);
  const moreButton = findElement<HTMLButtonElement>(root, ['[data-ai-advisory-more]', '#aiAdvisoryMore']);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(options.pageSize ?? 50)));
  let cursor: Cursor = null;
  let busy = false;
  let generation = 0;
  let activeAccountId = options.accountId();

  const setStatus = (text: string) => { if (status) status.textContent = text; };
  const clear = () => { if (list) list.replaceChildren(); cursor = null; if (moreButton) moreButton.hidden = true; };
  const load = async () => { generation++; activeAccountId = options.accountId(); cursor = null; clear(); await fetchPage(false); };
  const loadMore = async () => { if (cursor) await fetchPage(true); };
  const accountControl = findElement<HTMLElement>(root, ['#aiAdvisoryAccount']);
  accountControl?.addEventListener('change', () => { activeAccountId = options.accountId(); clear(); });
  loadButton?.addEventListener('click', () => { void load(); });
  moreButton?.addEventListener('click', () => { void loadMore(); });

  async function fetchPage(append: boolean): Promise<void> {
    if (busy && append) return;
    const requestedAccountId = options.accountId();
    if (!append && requestedAccountId !== activeAccountId) { generation++; activeAccountId = requestedAccountId; clear(); }
    const accountId = requestedAccountId;
    if (!accountId) { clear(); setStatus('Select an account to view advisories.'); return; }
    const requestGeneration = generation;
    busy = true;
    if (loadButton) loadButton.disabled = true;
    if (moreButton) moreButton.disabled = true;
    setStatus('Loading advisories…');
    try {
      const query = new URLSearchParams({ account_id: accountId, limit: String(pageSize) });
      if (append && cursor) {
        if (typeof cursor === 'string') {
          const [before, before_message_id] = cursor.split('|');
          if (!before || !before_message_id) throw new Error('Invalid cursor');
          query.set('before', before);
          query.set('before_message_id', before_message_id);
        } else {
          query.set('before', cursor.before);
          query.set('before_message_id', 'before_message_id' in cursor ? cursor.before_message_id : cursor.messageId);
        }
      }
      if (!append) clear();
      const basePath = (options.basePath ?? '').replace(/\/$/, '');
      const route = `${basePath}/api/ai-advisories?${query.toString()}`;
      let rawPage: unknown;
      try { rawPage = await getPage(route); } catch (error) { throw error; }
      if (requestGeneration !== generation || accountId !== options.accountId()) return;
      const page = parsePage(rawPage);
      cursor = page.nextCursor;
      if (moreButton) moreButton.hidden = !cursor;
      for (const item of page.advisories) renderItem(list, item);
      setStatus(page.advisories.length ? `${append ? 'Loaded' : 'Showing'} ${page.advisories.length} advisory record${page.advisories.length === 1 ? '' : 's'}.` : append ? 'No more advisories.' : 'No advisories found.');
    } catch {
      if (requestGeneration === generation && accountId === options.accountId()) {
        setStatus('Could not load advisories. Please try again.');
        if (moreButton) moreButton.hidden = true;
      }
    } finally {
      if (requestGeneration === generation) {
        busy = false;
        if (loadButton) loadButton.disabled = false;
        if (moreButton) moreButton.disabled = false;
      }
    }
  }
  return {
    load: async () => { generation++; activeAccountId = options.accountId(); cursor = null; clear(); await fetchPage(false); },
    loadMore: async () => { if (cursor) await fetchPage(true); },
  };
}

function parsePage(value: unknown): Page {
  if (!value || typeof value !== 'object') throw new Error('Invalid advisory response');
  const data = value as Record<string, unknown>;
  const advisories = data.advisories;
  const rawCursor = data.next_cursor ?? data.nextCursor ?? null;
  if (!Array.isArray(advisories)) throw new Error('Invalid advisory response');
  const records = advisories.map((row): Advisory => {
    if (!row || typeof row !== 'object') throw new Error('Invalid advisory');
    const item = row as Record<string, unknown>;
    if (typeof item.messageId !== 'string' || typeof item.label !== 'string' || typeof item.model !== 'string' || typeof item.policyVersion !== 'string' || typeof item.createdAt !== 'string' || typeof item.confidence !== 'number' || !Number.isFinite(item.confidence)) throw new Error('Invalid advisory');
    return item as Advisory;
  });
  let nextCursor: Cursor = null;
  if (typeof rawCursor === 'string') {
    const [before, before_message_id] = rawCursor.split('|');
    if (!before) throw new Error('Invalid advisory cursor');
    nextCursor = before_message_id ? { before, before_message_id } : rawCursor;
  } else if (rawCursor !== null && typeof rawCursor === 'object') {
    const cursorValue = rawCursor as Record<string, unknown>;
    const before = cursorValue.before;
    const messageId = cursorValue.before_message_id ?? cursorValue.messageId;
    if (typeof before !== 'string' || typeof messageId !== 'string' || !before || !messageId) throw new Error('Invalid advisory cursor');
    nextCursor = { before, before_message_id: messageId };
  } else if (rawCursor !== null) throw new Error('Invalid advisory cursor');
  return { advisories: records, nextCursor };
}

function renderItem(list: HTMLElement | null, item: Advisory): void {
  if (!list) return;
  const doc = list.ownerDocument;
  const row = doc.createElement('article');
  const heading = doc.createElement('h3');
  heading.textContent = item.label;
  const details = doc.createElement('p');
  details.textContent = `Model: ${item.model} · Confidence: ${item.confidence} · Policy: ${item.policyVersion}`;
  const meta = doc.createElement('p');
  meta.textContent = `Message: ${item.messageId} · ${item.createdAt}`;
  row.append(heading, details, meta);
  list.append(row);
}
