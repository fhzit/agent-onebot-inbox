export type ExtractedTask = {
  title: string;
  owner?: string;
  dueAt?: string;
  evidence?: string;
};

export type TaskExtraction = { tasks: ExtractedTask[] };

/** Parse a model-produced JSON task envelope without accepting invented formats. */
export function parseTaskExtraction(input: string): TaskExtraction | null {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const tasks = (value as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) return null;
  const parsed: ExtractedTask[] = [];
  for (const task of tasks) {
    if (!task || typeof task !== 'object' || Array.isArray(task)) return null;
    const item = task as Record<string, unknown>;
    if (typeof item.title !== 'string' || !item.title.trim()) return null;
    const result: ExtractedTask = { title: item.title.trim() };
    for (const key of ['owner', 'dueAt', 'evidence'] as const) {
      const field = item[key];
      if (field === undefined || field === null) continue;
      if (typeof field !== 'string' || !field.trim()) return null;
      if (key === 'dueAt' && !Number.isFinite(Date.parse(field))) return null;
      result[key] = field.trim();
    }
    parsed.push(result);
  }
  return { tasks: parsed };
}
