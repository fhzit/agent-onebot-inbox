import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectAttachmentUploadAction } from '../src/attachment-upload-policy.js';

test('selects explicitly declared NapCat upload actions by target', () => {
  assert.equal(selectAttachmentUploadAction('napcat', 'group'), 'upload_group_file');
  assert.equal(selectAttachmentUploadAction('napcat', 'private'), 'upload_private_file');
});

test('fails closed when a provider has no declared upload capability', () => {
  for (const provider of ['snowluma', 'unknown', '', 'NAPCAT']) {
    assert.throws(() => selectAttachmentUploadAction(provider, 'group'), /not supported/);
    assert.throws(() => selectAttachmentUploadAction(provider, 'private'), /not supported/);
  }
});
