/** Marker used by a future admin template integration point. */
export const ADMIN_AI_ADVISORY_MARKER = '<!-- AI_ADVISORY_PANEL -->';

/** Escape script text so panel-provided strings cannot terminate the enclosing script element. */
export function escapeAdminScriptText(script: string): string {
  return script.replace(/</g, '\\u003c');
}

/**
 * Replace exactly one advisory marker with its panel markup and inline script.
 * This is a pure string transform: it does not parse or mutate the DOM and does
 * not use innerHTML. Callers should only pass trusted, authored panel HTML.
 */
export function renderAdminAiAdvisoryEmbed(template: string, panelHtml: string, panelScript: string): string {
  const occurrences = template.split(ADMIN_AI_ADVISORY_MARKER).length - 1;
  if (occurrences !== 1) {
    throw new Error(`Expected exactly one AI advisory marker; found ${occurrences}`);
  }
  const embed = `${panelHtml}\n<script>${escapeAdminScriptText(panelScript)}</script>`;
  return template.replace(ADMIN_AI_ADVISORY_MARKER, () => embed);
}
