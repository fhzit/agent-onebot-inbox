import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ADMIN_AI_ADVISORY_MARKER, renderAdminAiAdvisoryEmbed } from '../src/admin-ai-advisory-embed.js';

 test('embed replaces marker once and is idempotent when reapplied to transformed template', () => {
  const template = `<main>${ADMIN_AI_ADVISORY_MARKER}</main>`;
  const once = renderAdminAiAdvisoryEmbed(template, '<section id="advisory"></section>', 'boot();');
  assert.match(once, /<section id="advisory"><\/section>\n<script>boot\(\);<\/script>/);
  assert.equal(renderAdminAiAdvisoryEmbed(once.replace(/<section id="advisory"><\/section>\n<script>boot\(\);<\/script>/, ADMIN_AI_ADVISORY_MARKER), '<section id="advisory"></section>', 'boot();'), once);
  assert.throws(() => renderAdminAiAdvisoryEmbed(once, '', ''), /found 0/);
});

test('embed fails for missing or duplicated markers', () => {
  assert.throws(() => renderAdminAiAdvisoryEmbed('<main></main>', '', ''), /found 0/);
  assert.throws(() => renderAdminAiAdvisoryEmbed(`${ADMIN_AI_ADVISORY_MARKER}${ADMIN_AI_ADVISORY_MARKER}`, '', ''), /found 2/);
});

test('panel script text escapes script-closing payloads', () => {
  const result = renderAdminAiAdvisoryEmbed(ADMIN_AI_ADVISORY_MARKER, '<div></div>', 'const payload = "</script><img src=x onerror=alert(1)>";');
  assert.equal(result, '<div></div>\n<script>const payload = "\\u003c/script>\\u003cimg src=x onerror=alert(1)>";</script>');
});
