/** Pure contract for staged attachment delivery. It performs no I/O and never retries. */
export type AttachmentDeliveryState =
  | { status: 'not_started' }
  | { status: 'upload_failed'; error: string }
  | { status: 'pending_send'; uploadedFileId: string }
  | { status: 'send_succeeded'; uploadedFileId: string; messageId: string | null }
  | { status: 'send_uncertain'; uploadedFileId: string; error: string };

export type AttachmentDeliveryEvent =
  | { type: 'upload_failed'; error: string }
  | { type: 'upload_succeeded'; uploadedFileId: string }
  | { type: 'send_succeeded'; messageId?: string | null }
  | { type: 'send_uncertain'; error: string };

/** Invalid/repeated events are rejected; in particular, uncertainty cannot transition to send again. */
export function transitionAttachmentDelivery(
  state: AttachmentDeliveryState,
  event: AttachmentDeliveryEvent,
): AttachmentDeliveryState {
  if (state.status === 'not_started') {
    if (event.type === 'upload_failed') return { status: 'upload_failed', error: event.error };
    if (event.type === 'upload_succeeded' && event.uploadedFileId.trim()) {
      return { status: 'pending_send', uploadedFileId: event.uploadedFileId };
    }
    throw new Error('Attachment delivery requires a valid upload result first');
  }
  if (state.status === 'pending_send') {
    if (event.type === 'send_succeeded') return { status: 'send_succeeded', uploadedFileId: state.uploadedFileId, messageId: event.messageId ?? null };
    if (event.type === 'send_uncertain') return { status: 'send_uncertain', uploadedFileId: state.uploadedFileId, error: event.error };
    throw new Error('Attachment delivery is pending send; upload cannot be repeated');
  }
  if (state.status === 'send_uncertain') throw new Error('Send outcome is uncertain; automatic resend is forbidden');
  throw new Error(`Attachment delivery is terminal (${state.status})`);
}

export function canSendAttachment(state: AttachmentDeliveryState): state is Extract<AttachmentDeliveryState, { status: 'pending_send' }> {
  return state.status === 'pending_send';
}
