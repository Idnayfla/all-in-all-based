// Combine a multi-file project (index.html + style.css + app.js) into a single
// self-contained HTML document — the same way components/PreviewPanel.tsx builds
// its live preview. Shared/gallery contexts only render one HTML string, so the
// referenced style.css / app.js relative paths would otherwise 404 and the app
// renders unstyled. Inlining CSS/JS produces an identical, portable preview.

export interface MergeableFile {
  name?: string;
  language?: string;
  content: string;
}

export function mergeProjectToHtml(files: MergeableFile[]): string | null {
  if (!files?.length) return null;

  const lang = (f: MergeableFile) => f.language?.toLowerCase() ?? '';
  const name = (f: MergeableFile) => f.name?.toLowerCase() ?? '';

  const isWebFile = (f: MergeableFile) =>
    lang(f) === 'html' ||
    lang(f) === 'svg' ||
    name(f).endsWith('.html') ||
    name(f).endsWith('.htm') ||
    name(f).endsWith('.svg');

  const htmlFile =
    files.find(f => name(f) === 'index.html') ??
    files.find(f => lang(f) === 'html') ??
    files.find(f => /\.html?$/.test(name(f))) ??
    files.find(isWebFile) ??
    files[0];

  if (!htmlFile) return null;

  // Inline every CSS and JS file (not just the first) so multi-stylesheet /
  // multi-script projects merge fully.
  const cssFiles = files.filter(f => lang(f) === 'css' || name(f).endsWith('.css'));
  const jsFiles = files.filter(
    f =>
      lang(f) === 'javascript' ||
      lang(f) === 'js' ||
      (name(f).endsWith('.js') && !name(f).endsWith('.json'))
  );

  let html = (htmlFile.content ?? '').trim();

  // Wrap a bare SVG document so it renders centered like the live preview does.
  const looksLikeFullHtml = /<html[\s>]|<!doctype html/i.test(html);
  const looksLikeSvg = /^<svg[\s>]/i.test(html) || html.startsWith('<?xml');
  if (!looksLikeFullHtml && looksLikeSvg) {
    html = `<!doctype html><html><head><style>html,body{margin:0;height:100%;display:flex;align-items:center;justify-content:center;background:#fff}svg{max-width:100%;max-height:100%}</style></head><body>${html}</body></html>`;
  }

  // If there is no <head>/<body> at all, give the content a minimal shell so the
  // injected <style>/<script> have somewhere to attach.
  if (!/<\/head>/i.test(html) && !/<\/body>/i.test(html)) {
    html = `<!doctype html><html><head></head><body>${html}</body></html>`;
  }

  const styleBlock = cssFiles.map(f => `<style>${f.content}</style>`).join('\n');
  const scriptBlock = jsFiles.map(f => `<script>${f.content}</script>`).join('\n');

  if (styleBlock) {
    html = /<\/head>/i.test(html)
      ? html.replace(/<\/head>/i, `${styleBlock}</head>`)
      : `${styleBlock}${html}`;
  }
  if (scriptBlock) {
    html = /<\/body>/i.test(html)
      ? html.replace(/<\/body>/i, `${scriptBlock}</body>`)
      : `${html}${scriptBlock}`;
  }

  if (!/name=["']viewport["']/i.test(html) && /<head>/i.test(html)) {
    html = html.replace(
      /<head>/i,
      '<head><meta name="viewport" content="width=device-width, initial-scale=1">'
    );
  }

  return html;
}
