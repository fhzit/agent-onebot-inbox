/** Small DOM adapter for the contact-sync controls used by admin surfaces. */
export type ContactSyncPanelOptions = {
  accountId: () => string;
  post: (path: string, body?: unknown) => Promise<unknown>;
  status: (message: string) => void;
  refresh: () => Promise<void>;
};

/** Bind explicit, account-scoped contact sync actions without exposing credentials. */
export function bindContactSyncPanel(root: ParentNode, options: ContactSyncPanelOptions): void {
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-contact-sync]')];
  for (const button of buttons) {
    button.addEventListener('click', async () => {
      const accountId = options.accountId();
      if (!accountId) { options.status('请先选择账号'); return; }
      const kind = button.dataset.contactSync;
      const groupId = kind === 'members' ? root.querySelector<HTMLInputElement>('[data-contact-group]')?.value.trim() : undefined;
      if (kind !== 'friends' && kind !== 'groups' && kind !== 'members') return;
      if (kind === 'members' && !groupId) { options.status('请输入群号'); return; }
      const path = `/api/admin/accounts/${encodeURIComponent(accountId)}/contacts/sync-${kind}`;
      button.disabled = true;
      options.status('同步中…');
      try {
        const result = await options.post(path, kind === 'members' ? { group_id: groupId } : {});
        const synced = result && typeof result === 'object' && 'synced' in result ? Number((result as { synced: unknown }).synced) : NaN;
        options.status(Number.isFinite(synced) ? `同步完成：${synced} 条` : '同步完成');
        await options.refresh();
      } catch (error) {
        options.status(`同步失败：${error instanceof Error ? error.message : '请求错误'}`);
      } finally { button.disabled = false; }
    });
  }
}
