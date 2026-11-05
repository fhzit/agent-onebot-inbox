import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let html = await readFile(path.join(root, 'public', 'admin.html'), 'utf8');
if (!html.includes('id="ai-advisory-panel"')) {
  const panel = `<section id="ai-advisory-panel" class="panel"><div class="panel-head"><h2>AI 分类建议</h2><span class="label">仅元数据</span></div><div class="filters"><select id="aiAdvisoryAccount" aria-label="选择账号"><option value="">选择账号</option></select><button id="aiAdvisoryLoad" type="button">加载建议</button><button id="aiAdvisoryMore" type="button" hidden>加载更多</button></div><p id="aiAdvisoryStatus" data-ai-advisory-status class="hint" aria-live="polite">选择账号后查看建议</p><div id="aiAdvisoryList" data-ai-advisory-list class="accounts"></div></section>`;
  html = html.replace('<section id="tab-audit"', `${panel}<section id="tab-audit"`);
}
if (!html.includes('id="ai-advisory-retention-panel"')) {
  const panel = `<section id="ai-advisory-retention-panel" class="panel"><div class="panel-head"><h2>AI 建议保留期清理</h2><span class="label">手动操作 · 仅清理建议元数据</span></div><div class="filters"><select id="retentionAccount" aria-label="选择要清理的账号"><option value="">选择账号</option></select><button id="retentionPreview" data-retention-preview type="button">预览过期记录</button><button id="retentionApply" data-retention-apply type="button" disabled>确认并清理</button></div><p id="retentionStatus" data-retention-status class="hint" aria-live="polite">选择账号并预览；不会自动删除。</p><div id="retentionPreviewList" data-retention-list class="accounts"></div></section>`;
  html = html.replace('<section id="tab-audit"', `${panel}<section id="tab-audit"`);
}
html = html.replace('id="contactAccount" required>', 'id="contactAccount" required aria-label="选择要同步联系人的账号">');
html = html.replace('id="contactGroup">', 'id="contactGroup" data-contact-group aria-label="选择群组以同步成员">');
html = html.replace(/id="syncFriends"(?! data-contact-sync)/g, 'id="syncFriends" data-contact-sync="friends"');
html = html.replace(/id="syncGroups"(?! data-contact-sync)/g, 'id="syncGroups" data-contact-sync="groups"');
html = html.replace(/id="syncMembers"(?! data-contact-sync)/g, 'id="syncMembers" data-contact-sync="members"');
html = html.replace('<button id="aiAdvisoryLoad" type="button" data-ai-advisory-load>加载建议</button>', '<button id="aiAdvisoryLoad" type="button">加载建议</button>').replace('<button id="aiAdvisoryMore" type="button" data-ai-advisory-more hidden>加载更多</button>', '<button id="aiAdvisoryMore" type="button" hidden>加载更多</button>');
html = html.replace(/data-ai-advisory-status/g, 'data-ai-advisory-status');
html = html.replace('id="syncFriends" data-contact-sync="friends" data-contact-sync="friends"', 'id="syncFriends" data-contact-sync="friends"');
html = html.replace(/(<button id="sync(?:Friends|Groups|Members)" data-contact-sync="(?:friends|groups|members)")(?: data-contact-sync="(?:friends|groups|members)")+/g, '$1');
html = html.replace('id="contactGroup" data-contact-group aria-label="选择群组以同步成员"', 'id="contactGroup" data-contact-group aria-label="选择群组以同步成员"');
const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
if (!body) throw new Error('admin body not found');

// Transpile authored TypeScript binders into the existing page's single inline script.
const inline = html.match(/<script>([\s\S]*?)<\/script>/);
if (!inline) throw new Error('admin inline script is missing');
let script = inline[1].replace('\n})(\);', '\n})(\);');
const transpileModule = async (file) => {
  const source = ts.transpileModule(await readFile(path.join(root, 'src', file), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return source.replace(/^export\s+/gm, '');
};
for (const name of ['admin-ai-advisory-panel.ts', 'admin-ai-advisory-retention-panel.ts', 'admin-contact-sync-panel.ts', 'admin-account-selector-hydration.ts']) script += "\n" + await transpileModule(name);

script = script.replace("select.value=previous;else if(accounts.length)", "select.value=previous;if(accounts.length&&!select.value)");
script = script.replace("if(accounts.some(a=>a.id===previous))select.value=previous;", "if(accounts.some(a=>a.id===previous))select.value=previous;populateAiAdvisoryAccounts(accounts);");

script += "\n(function(){const api=(path,options={})=>window.api(path,options);bindAiAdvisoryPanel({root:document,accountId:()=>document.getElementById('aiAdvisoryAccount')?.value||'',get:path=>api(path)});bindAiAdvisoryRetentionPanel({root:document,accountId:()=>document.getElementById('retentionAccount')?.value||'',post:(path,body)=>api(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),confirm:message=>window.confirm(message)});bindContactSyncPanel(document,{accountId:()=>document.getElementById('contactAccount')?.value||'',post:(path,body)=>api(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),status:message=>{const element=document.getElementById('contactSyncStatus');if(element)element.textContent=message},refresh:async()=>{document.getElementById('contactAccount')?.dispatchEvent(new Event('change'))}});})();";
const page = html.replace(inline[0], '<script>' + script.replace(/<\/script>/g, '<\\/script>') + '</script>');
const check = spawnSync(process.execPath, ['--check', '-'], { input: script, encoding: 'utf8' });
if (check.status !== 0) throw new Error(`Invalid admin inline script: ${check.stderr}`);
const encoded = Buffer.from(page).toString('base64');
await writeFile(path.join(root, 'src', 'admin-page.ts'), `// Generated from public/admin.html by scripts/embed-admin.mjs.\nexport const adminPage = Buffer.from('${encoded}', 'base64').toString('utf8');\n`);
