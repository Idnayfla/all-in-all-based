'use client';
import { useMemo, useRef, useState } from 'react';
import { FileNode } from '@/app/page';
import ImageCropModal from './ImageCropModal';

export default function PreviewPanel({
  files,
  projectType,
  subscriptionTier,
  onProRequired,
}: {
  files: FileNode[];
  projectType: string;
  subscriptionTier?: 'free' | 'pro';
  onProRequired?: () => void;
}) {
  const [output, setOutput] = useState('');
  const [stderr, setStderr] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [cropData, setCropData] = useState<{ url: string; format: 'png' | 'jpg' } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Match the renderable web entry point. Icon/logo/avatar requests can come
  // back as a standalone SVG file (language "svg" or a *.svg name) instead of
  // an HTML wrapper — those render fine in the iframe, so treat them as the
  // preview source. Without this, the Preview tab is blank while the file is
  // visible in the Editor tab.
  const isWebFile = (f: FileNode) => {
    const lang = f.language?.toLowerCase();
    const name = f.name?.toLowerCase() ?? '';
    return (
      lang === 'html' ||
      lang === 'svg' ||
      name.endsWith('.html') ||
      name.endsWith('.htm') ||
      name.endsWith('.svg')
    );
  };
  const htmlFile =
    files.find(f => f.language === 'html') ??
    files.find(f => (f.name?.toLowerCase() ?? '').match(/\.html?$/)) ??
    files.find(isWebFile);
  const cssFile = files.find(f => f.language === 'css');
  const jsFile = files.find(f => f.language === 'javascript' || f.language === 'js');

  const previewHtml = useMemo(() => {
    if (!htmlFile) return null;
    let html = htmlFile.content.trim();
    // A bare SVG document (or fragment) has no <html>/<head>/<body>, so the
    // <base>, <style>, viewport, and server-injected safety scripts never get
    // attached. Wrap it in a minimal centered HTML document so it renders.
    const looksLikeFullHtml = /<html[\s>]|<!doctype html/i.test(html);
    const looksLikeSvg = /^<svg[\s>]/i.test(html) || html.startsWith('<?xml');
    if (!looksLikeFullHtml && looksLikeSvg) {
      html = `<!doctype html><html><head><style>html,body{margin:0;height:100%;display:flex;align-items:center;justify-content:center;background:#fff}svg{max-width:100%;max-height:100%}</style></head><body>${html}</body></html>`;
    }
    // srcdoc iframes always have a null/opaque origin (MDN spec) — even with
    // allow-same-origin. Without <base>, relative URLs like /api/sfx?slug=...
    // resolve to null:///api/sfx?slug=... and never reach the server.
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    if (origin) {
      html = html.includes('<head>')
        ? html.replace('<head>', `<head><base href="${origin}">`)
        : `<base href="${origin}">${html}`;
    }
    if (cssFile) html = html.replace('</head>', `<style>${cssFile.content}</style></head>`);
    if (jsFile) {
      html = html.replace('</body>', `<script>${jsFile.content}</script></body>`);
    }
    if (!html.includes('name="viewport"') && !html.includes("name='viewport'")) {
      html = html.replace(
        '<head>',
        '<head><meta name="viewport" content="width=device-width, initial-scale=1">'
      );
    }
    return html;
  }, [htmlFile, cssFile, jsFile]);

  const runCode = async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setIsRunning(true);
    setOutput('');
    setStderr('');
    try {
      const res = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files, projectType }),
        signal: ctrl.signal,
      });
      const data = await res.json();
      setOutput(data.output ?? '');
      setStderr(data.stderr ?? '');
    } catch (err: unknown) {
      if (!(err instanceof Error && err.name === 'AbortError'))
        setOutput('Error: Could not execute code.');
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  };

  const cancelRun = () => {
    abortRef.current?.abort();
    setIsRunning(false);
    setOutput('· Execution cancelled.');
  };

  const openInTab = () => {
    if (!previewHtml) return;
    const blob = new Blob([previewHtml], { type: 'text/html' });
    window.open(URL.createObjectURL(blob), '_blank');
  };

  const captureCanvas = async (
    scale = Math.max(window.devicePixelRatio ?? 1, 2)
  ): Promise<HTMLCanvasElement | null> => {
    const iframe = iframeRef.current;
    if (!iframe?.contentDocument?.body) return null;
    const { default: html2canvas } = await import('html2canvas');
    return html2canvas(iframe.contentDocument.body, {
      useCORS: true,
      allowTaint: true,
      scale,
      width: iframe.offsetWidth,
      height: iframe.offsetHeight,
      windowWidth: iframe.offsetWidth,
      windowHeight: iframe.offsetHeight,
      logging: false,
    });
  };

  const [exportError, setExportError] = useState<string | null>(null);

  const exportPNG = async () => {
    setIsExporting(true);
    setShowExportMenu(false);
    setExportError(null);
    try {
      const canvas = await captureCanvas();
      if (!canvas) return;
      setCropData({ url: canvas.toDataURL('image/png'), format: 'png' });
    } catch (err: unknown) {
      setExportError('Export failed — try opening in a new tab first.');
      console.error('[export PNG]', err);
    } finally {
      setIsExporting(false);
    }
  };

  const exportJPG = async () => {
    setIsExporting(true);
    setShowExportMenu(false);
    setExportError(null);
    try {
      const canvas = await captureCanvas();
      if (!canvas) return;
      setCropData({ url: canvas.toDataURL('image/jpeg', 0.92), format: 'jpg' });
    } catch (err: unknown) {
      setExportError('Export failed — try opening in a new tab first.');
      console.error('[export JPG]', err);
    } finally {
      setIsExporting(false);
    }
  };

  const exportGIF = async () => {
    setIsExporting(true);
    setShowExportMenu(false);
    setExportError(null);
    try {
      const iframe = iframeRef.current;
      if (!iframe?.contentDocument?.body) return;

      const { default: html2canvas } = await import('html2canvas');
      // @ts-ignore — gif.js has no types
      const GIF = (await import('gif.js')).default;

      const w = iframe.offsetWidth;
      const h = iframe.offsetHeight;
      const frameCount = 16;
      const frameDelay = 120; // ms per frame

      const gifScale = 1.5;
      const gif = new GIF({
        workers: 2,
        quality: 8,
        width: Math.round(w * gifScale),
        height: Math.round(h * gifScale),
        workerScript: '/gif.worker.js',
      });

      for (let i = 0; i < frameCount; i++) {
        const canvas = await html2canvas(iframe.contentDocument.body, {
          useCORS: true,
          allowTaint: true,
          scale: 1.5,
          width: w,
          height: h,
          windowWidth: w,
          windowHeight: h,
          logging: false,
        });
        gif.addFrame(canvas, { delay: frameDelay, copy: true });
        await new Promise(r => setTimeout(r, frameDelay));
      }

      await new Promise<void>((resolve, reject) => {
        gif.on('finished', (blob: Blob) => {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.download = 'based-export.gif';
          link.href = url;
          link.click();
          URL.revokeObjectURL(url);
          resolve();
        });
        gif.on('error', reject);
        gif.render();
      });
    } catch (err: unknown) {
      setExportError('GIF export failed — try a simpler animation.');
      console.error('[export GIF]', err);
    } finally {
      setIsExporting(false);
    }
  };

  const exportPDF = async () => {
    setIsExporting(true);
    setShowExportMenu(false);
    setExportError(null);
    try {
      const canvas = await captureCanvas(2);
      if (!canvas) return;
      const { PDFDocument } = await import('pdf-lib');
      const jpegData = canvas.toDataURL('image/jpeg', 0.95).split(',')[1];
      const bytes = new Uint8Array(Array.from(atob(jpegData), c => c.charCodeAt(0)));
      const pdf = await PDFDocument.create();
      const img = await pdf.embedJpg(bytes);
      const page = pdf.addPage([img.width / 2, img.height / 2]);
      page.drawImage(img, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
      const pdfBytes = await pdf.save();
      const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'based-export.pdf';
      a.click();
    } catch (err: unknown) {
      setExportError('PDF export failed — try opening in a new tab first.');
      console.error('[export PDF]', err);
    } finally {
      setIsExporting(false);
    }
  };

  const exportDOCX = async () => {
    setIsExporting(true);
    setShowExportMenu(false);
    setExportError(null);
    try {
      const iframe = iframeRef.current;
      if (!iframe?.contentDocument?.body) return;

      const { Document, Paragraph, TextRun, HeadingLevel, Packer } = await import('docx');

      const children: InstanceType<typeof Paragraph>[] = [];
      const walker = iframe.contentDocument.body.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,td,th');

      walker.forEach(el => {
        const text = (el as HTMLElement).innerText?.trim();
        if (!text) return;
        const tag = el.tagName.toLowerCase();
        const headingMap: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
          h1: HeadingLevel.HEADING_1,
          h2: HeadingLevel.HEADING_2,
          h3: HeadingLevel.HEADING_3,
          h4: HeadingLevel.HEADING_4,
        };
        children.push(
          new Paragraph(
            headingMap[tag] ? { text, heading: headingMap[tag] } : { children: [new TextRun(text)] }
          )
        );
      });

      if (children.length === 0) {
        const lines = (iframe.contentDocument.body.innerText ?? '').split('\n').filter(Boolean);
        lines.forEach(l => children.push(new Paragraph({ children: [new TextRun(l.trim())] })));
      }

      const doc = new Document({ sections: [{ children }] });
      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'based-export.docx';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setExportError('Word export failed — please try again.');
      console.error('[export DOCX]', err);
    } finally {
      setIsExporting(false);
    }
  };

  const exportPPTX = async () => {
    setIsExporting(true);
    setShowExportMenu(false);
    setExportError(null);
    try {
      const canvas = await captureCanvas(2);
      if (!canvas) return;
      const imgData = canvas.toDataURL('image/png');
      // @ts-ignore — pptxgenjs types are loose
      const PptxGenJS = (await import('pptxgenjs')).default;
      const pptx = new PptxGenJS();
      pptx.layout = 'LAYOUT_WIDE';
      const slide = pptx.addSlide();
      slide.addImage({ data: imgData, x: 0, y: 0, w: '100%', h: '100%' });
      await pptx.writeFile({ fileName: 'based-export.pptx' });
    } catch (err: unknown) {
      setExportError('PowerPoint export failed — please try again.');
      console.error('[export PPTX]', err);
    } finally {
      setIsExporting(false);
    }
  };

  const exportXLSX = async () => {
    setIsExporting(true);
    setShowExportMenu(false);
    setExportError(null);
    try {
      const iframe = iframeRef.current;
      if (!iframe?.contentDocument) return;

      const XLSX = await import('xlsx');
      const tables = iframe.contentDocument.querySelectorAll('table');

      if (tables.length === 0) {
        // No table — build a sheet from all visible text content as a fallback
        const lines = (iframe.contentDocument.body.innerText ?? '')
          .split('\n')
          .map(l => l.trim())
          .filter(Boolean)
          .map(l => [l]);
        const ws = XLSX.utils.aoa_to_sheet(lines);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        XLSX.writeFile(wb, 'based-export.xlsx');
        return;
      }

      const wb = XLSX.utils.book_new();
      tables.forEach((table, i) => {
        const ws = XLSX.utils.table_to_sheet(table);
        XLSX.utils.book_append_sheet(wb, ws, `Sheet${i + 1}`);
      });
      XLSX.writeFile(wb, 'based-export.xlsx');
    } catch (err: unknown) {
      setExportError('Excel export failed — please try again.');
      console.error('[export XLSX]', err);
    } finally {
      setIsExporting(false);
    }
  };

  const COMPILED_TYPES = ['python', 'node', 'java', 'cpp', 'go', 'rust', 'bash'];
  const LANG_LABELS: Record<string, string> = {
    python: 'Python',
    node: 'Node.js',
    java: 'Java',
    cpp: 'C++',
    go: 'Go',
    rust: 'Rust',
    bash: 'Bash',
  };
  if (COMPILED_TYPES.includes(projectType)) {
    return (
      <div className="preview-panel">
        <div className="preview-header">
          <span>⬡ {LANG_LABELS[projectType] ?? projectType} — Terminal</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {isRunning ? (
              <button className="run-btn run-btn-cancel" onClick={cancelRun}>
                ◼ Cancel
              </button>
            ) : (
              <button className="run-btn" onClick={runCode} disabled={files.length === 0}>
                ▶ Run
              </button>
            )}
          </div>
        </div>
        <div className="terminal-output">
          {output || stderr ? (
            <>
              {output && <pre className="terminal-text">{output}</pre>}
              {stderr && <pre className="terminal-text terminal-stderr">{stderr}</pre>}
            </>
          ) : (
            <div className="terminal-empty">
              {['java', 'go', 'rust'].includes(projectType)
                ? `Click Run — Based will compile and execute your ${LANG_LABELS[projectType]} code in a sandbox.`
                : 'Click Run to execute your code in a live sandbox.'}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!previewHtml)
    return (
      <div className="preview-panel">
        <div className="preview-header">⬡ Preview</div>
        <div className="preview-empty">
          <div className="preview-empty-icon">⬡</div>
          <div className="preview-empty-text">Generate an HTML project to see a preview here.</div>
        </div>
      </div>
    );

  return (
    <div className="preview-panel">
      <div className="preview-header">
        <span>⬡ Preview — Live</span>
        <div className="preview-actions" style={{ position: 'relative', display: 'flex', gap: 6 }}>
          <button className="run-btn" onClick={openInTab} title="Open in new browser tab">
            ↗ New Tab
          </button>
          <button
            className="run-btn"
            onClick={() => setShowExportMenu(s => !s)}
            disabled={isExporting}
          >
            {isExporting ? '◈ Exporting…' : '⬇ Export'}
          </button>
          {showExportMenu && (
            <div className="export-menu">
              <button className="export-menu-item" onClick={exportPNG}>
                PNG
              </button>
              <button
                className="export-menu-item"
                onClick={subscriptionTier === 'free' ? onProRequired : exportJPG}
              >
                JPG{' '}
                {subscriptionTier === 'free' && (
                  <span className="export-menu-badge export-menu-badge--pro">⬡ Pro</span>
                )}
              </button>
              <button
                className="export-menu-item"
                onClick={subscriptionTier === 'free' ? onProRequired : exportGIF}
              >
                GIF&nbsp;
                <span className="export-menu-badge">
                  {subscriptionTier === 'free' ? '⬡ Pro' : 'animated'}
                </span>
              </button>
              <button
                className="export-menu-item"
                onClick={subscriptionTier === 'free' ? onProRequired : exportPDF}
              >
                PDF{' '}
                {subscriptionTier === 'free' && (
                  <span className="export-menu-badge export-menu-badge--pro">⬡ Pro</span>
                )}
              </button>
              <button className="export-menu-item" onClick={exportXLSX}>
                Excel <span className="export-menu-badge">.xlsx</span>
              </button>
              <button
                className="export-menu-item"
                onClick={subscriptionTier === 'free' ? onProRequired : exportDOCX}
              >
                Word{' '}
                {subscriptionTier === 'free' && (
                  <span className="export-menu-badge export-menu-badge--pro">⬡ Pro</span>
                )}
              </button>
              <button
                className="export-menu-item"
                onClick={subscriptionTier === 'free' ? onProRequired : exportPPTX}
              >
                PowerPoint{' '}
                {subscriptionTier === 'free' && (
                  <span className="export-menu-badge export-menu-badge--pro">⬡ Pro</span>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
      <iframe
        ref={iframeRef}
        className="preview-frame"
        sandbox="allow-scripts allow-same-origin allow-modals allow-forms"
        allow="autoplay"
        title="Preview"
        srcDoc={previewHtml ?? ''}
        onClick={() => setShowExportMenu(false)}
      />
      {cropData && (
        <ImageCropModal
          url={cropData.url}
          format={cropData.format}
          onClose={() => setCropData(null)}
        />
      )}
      {exportError && (
        <div className="export-error-toast" onClick={() => setExportError(null)}>
          {exportError}
        </div>
      )}
    </div>
  );
}
