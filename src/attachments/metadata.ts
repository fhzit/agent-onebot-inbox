export type AttachmentMetadata = { type: string; filename: string | null; provider_file_id: string | null; remote_reference: string | null };
const fileTypes = new Set(['image', 'file', 'record', 'video']);

/** Extract only provider metadata; this function performs no network/file access. */
export function extractAttachmentMetadata(segments: ReadonlyArray<{ type: string; data: Record<string, unknown> }>): AttachmentMetadata[] {
  return segments.filter(s => fileTypes.has(s.type)).map(s => ({
    type: s.type,
    filename: typeof s.data.name === 'string' ? s.data.name : typeof s.data.file === 'string' ? safeBasename(s.data.file) : null,
    provider_file_id: typeof s.data.file_id === 'string' ? s.data.file_id : null,
    remote_reference: typeof s.data.url === 'string' ? s.data.url : typeof s.data.file === 'string' ? s.data.file : null,
  }));
}
function safeBasename(value: string): string {
  return value.replace(/\\/g, '/').split('/').pop()?.replace(/[\u0000-\u001f]/g, '') || 'attachment';
}
