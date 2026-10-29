/** Explicit upload action capability policy. Unknown providers/actions fail closed. */
export type AttachmentUploadProvider = 'napcat' | 'snowluma';
export type AttachmentUploadTargetType = 'group' | 'private';

const UPLOAD_ACTIONS: Readonly<Record<AttachmentUploadProvider, Readonly<Partial<Record<AttachmentUploadTargetType, string>>>>> = Object.freeze({
  napcat: Object.freeze({ group: 'upload_group_file', private: 'upload_private_file' }),
  // SnowLuma's documented action set does not establish upload support.
  snowluma: Object.freeze({}),
});

export function selectAttachmentUploadAction(provider: string, target: AttachmentUploadTargetType): string {
  const actions = Object.hasOwn(UPLOAD_ACTIONS, provider)
    ? UPLOAD_ACTIONS[provider as AttachmentUploadProvider]
    : undefined;
  const action = actions?.[target];
  if (!action) throw new Error(`Attachment upload is not supported for provider ${provider} and target ${target}`);
  return action;
}
