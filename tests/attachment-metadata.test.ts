import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractAttachmentMetadata } from '../src/attachments/metadata.js';

test('extract attachment metadata without fetching provider references', () => {
  const result = extractAttachmentMetadata([
    { type: 'text', data: { text: 'attached' } },
    { type: 'file', data: { file: '/provider/cache/report.pdf', name: '../report.pdf', file_id: 'f-1' } },
    { type: 'image', data: { url: 'https://example.invalid/image' } },
    { type: 'unknown', data: { file: 'discard' } },
  ]);
  assert.deepEqual(result, [
    { type: 'file', filename: '../report.pdf', provider_file_id: 'f-1', remote_reference: '/provider/cache/report.pdf' },
    { type: 'image', filename: null, provider_file_id: null, remote_reference: 'https://example.invalid/image' },
  ]);
});

test('provider path fallback filename is reduced to basename', () => {
  const [item] = extractAttachmentMetadata([{ type: 'file', data: { file: 'C:\\private\\a.pdf' } }]);
  assert.equal(item?.filename, 'a.pdf');
});
