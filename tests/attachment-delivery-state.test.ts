import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canSendAttachment, transitionAttachmentDelivery, type AttachmentDeliveryState } from '../src/attachments/delivery-state.js';

const start: AttachmentDeliveryState = { status: 'not_started' };

test('upload failure is explicit and terminal', () => {
  const failed = transitionAttachmentDelivery(start, { type: 'upload_failed', error: 'upload rejected' });
  assert.deepEqual(failed, { status: 'upload_failed', error: 'upload rejected' });
  assert.equal(canSendAttachment(failed), false);
  assert.throws(() => transitionAttachmentDelivery(failed, { type: 'upload_succeeded', uploadedFileId: 'f' }), /terminal/);
});

test('successful upload is pending send and permits one send outcome', () => {
  const pending = transitionAttachmentDelivery(start, { type: 'upload_succeeded', uploadedFileId: 'provider-file-1' });
  assert.deepEqual(pending, { status: 'pending_send', uploadedFileId: 'provider-file-1' });
  assert.equal(canSendAttachment(pending), true);
  assert.deepEqual(transitionAttachmentDelivery(pending, { type: 'send_succeeded', messageId: 'm1' }), {
    status: 'send_succeeded', uploadedFileId: 'provider-file-1', messageId: 'm1',
  });
  assert.throws(() => transitionAttachmentDelivery(pending, { type: 'upload_succeeded', uploadedFileId: 'f2' }), /cannot be repeated/);
});

test('uncertain send is terminal and forbids automatic resend', () => {
  const pending = transitionAttachmentDelivery(start, { type: 'upload_succeeded', uploadedFileId: 'provider-file-1' });
  const uncertain = transitionAttachmentDelivery(pending, { type: 'send_uncertain', error: 'connection lost' });
  assert.deepEqual(uncertain, { status: 'send_uncertain', uploadedFileId: 'provider-file-1', error: 'connection lost' });
  assert.equal(canSendAttachment(uncertain), false);
  assert.throws(() => transitionAttachmentDelivery(uncertain, { type: 'send_succeeded', messageId: 'late' }), /automatic resend is forbidden/);
  assert.throws(() => transitionAttachmentDelivery(uncertain, { type: 'send_uncertain', error: 'repeat' }), /automatic resend is forbidden/);
});

test('rejects send before upload and empty uploaded IDs', () => {
  assert.throws(() => transitionAttachmentDelivery(start, { type: 'send_succeeded' }), /upload result first/);
  assert.throws(() => transitionAttachmentDelivery(start, { type: 'upload_succeeded', uploadedFileId: '  ' }), /upload result first/);
});
