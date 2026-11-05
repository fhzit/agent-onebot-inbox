export type AdvisoryAccountOption = { id: string; alias?: string };

/** Populate advisory and retention account filters while retaining valid choices. */
export function populateAiAdvisoryAccounts(
  accounts: AdvisoryAccountOption[],
  root: Pick<Document, 'getElementById' | 'createElement'> = document,
): void {
  for (const id of ['aiAdvisoryAccount', 'retentionAccount']) {
    const select = root.getElementById(id) as HTMLSelectElement | null;
    if (!select) continue;
    const previous = select.value;
    const placeholder = root.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '选择账号';
    select.replaceChildren(placeholder);
    for (const account of accounts) {
      const option = root.createElement('option');
      option.value = account.id;
      option.textContent = `${account.alias || account.id} (${account.id})`;
      select.append(option);
    }
    select.value = accounts.some(account => account.id === previous) ? previous : '';
  }
}
