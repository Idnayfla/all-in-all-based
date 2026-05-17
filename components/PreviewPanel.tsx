'use client';
import { useMemo, useRef, useState } from 'react';
import { FileNode } from '@/app/page';

export default function PreviewPanel({ files, projectType, subscriptionTier, onProRequired }: {
  files: FileNode[];
  projectType: string;
  subscriptionTier?: 'free' | 'pro';
  onProRequired?: () => void;
}) {
  const [output, setOutput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const htmlFile = files.find(f => f.language === 'html');
  const cssFile  = files.find(f => f.language === 'css');
  const jsFile   = files.find(f => f.language === 'javascript' || f.language === 'js');

  const previewHtml = useMemo(() => {
    if (!htmlFile) return null;
    let html = htmlFile.content;
    if (cssFile) html = html.replace('</head>', `<style>${cssFile.content}</style></head>`);
    if (jsFile)  html = html.replace('</body>', `<script>${jsFile.content}</script></body>`);
    if (!html.includes('name="viewport"') && !html.includes("name='viewport'")) {
      html = html.replace('<head>', '<head><meta name="viewport" content="width=device-width, initial-scale=1">');
    }
    return html;
  }, [htmlFile, cssFile, jsFile]);

  const runCode = async () => {
    setIsRunning(true);
    setOutput('');
    try {
      const res = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files, projectType }),
      });
      const data = await res.json();
      setOutput(data.output);
    } catch {
      setOutput('Error: Could not execute code.');
    } finally {
      setIsRunning(false);
    }
  };

  const captureCanvas = async (scale = Math.max(window.devicePixelRatio ?? 1, 2)): Promise<HTMLCanvasElement | null> => {
    const iframe = iframeRef.current;
    if (!iframe?.contentDocument?.body) return null;
    const { default: html2canvas } = await import('html2canvas');
    return html2canvas(iframe.contentDocument.body, {
      useCORS: true,
      allowTaint: true,
      scale,
      width:        iframe.offsetWidth,
      height:       iframe.offsetHeight,
      windowWidth:  iframe.offsetWidth,
      windowHeight: iframe.offsetHeight,
      logging: false,
    });
  };

  const exportPNG = async () => {
    setIsExporting(true);
    setShowExportMenu(false);
    try {
      const canvas = await captureCanvas();
      if (!canvas) return;
      const link = document.createElement('a');
      link.download = 'based-export.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
    } finally { setIsExporting(false); }
  };

  const exportJPG = async () => {
    setIsExporting(true);
    setShowExportMenu(false);
    try {
      const canvas = await captureCanvas();
      if (!canvas) return;
      const link = document.createElement('a');
      link.download = 'based-export.jpg';
      link.href = canvas.toDataURL('image/jpeg', 0.92);
      link.click();
    } finally { setIsExporting(false); }
  };

  const exportGIF = async () => {
    setIsExporting(true);
    setShowExportMenu(false);
    try {
      const iframe = iframeRef.current;
      if (!iframe?.contentDocument?.body) return;

      const { default: html2canvas } = await import('html2canvas');
      // @ts-ignore — gif.js has no types
      const GIF = (await import('gif.js')).default;

      const w          = iframe.offsetWidth;
      const h          = iframe.offsetHeight;
      const frameCount = 16;
      const frameDelay = 120; // ms per frame

      const gifScale = 1.5;
      const gif = new GIF({
        workers: 2,
        quality: 8,
        width:   Math.round(w * gifScale),
        height:  Math.round(h * gifScale),
        workerScript: '/gif.worker.js',
      });

      for (let i = 0; i < frameCount; i++) {
        const canvas = await html2canvas(iframe.contentDocument.body, {
          useCORS: true, allowTaint: true,
          scale: 1.5,
          width: w, height: h, windowWidth: w, windowHeight: h,
          logging: false,
        });
        gif.addFrame(canvas, { delay: frameDelay, copy: true });
        await new Promise(r => setTimeout(r, frameDelay));
      }

      await new Promise<void>((resolve, reject) => {
        gif.on('finished', (blob: Blob) => {
          const url  = URL.createObjectURL(blob);
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
    } finally { setIsExporting(false); }
  };

  const exportPDF = () => {
    iframeRef.current?.contentWindow?.print();
    setShowExportMenu(false);
  };

  if (projectType === 'python' || projectType === 'node') {
    return (
      <div className="preview-panel">
        <div className="preview-header">
          <span>⬡ Terminal Output</span>
          <button className="run-btn" onClick={runCode} disabled={isRunning || files.length === 0}>
            {isRunning ? '◈ Running...' : '▶ Run'}
          </button>
        </div>
        <div className="terminal-output">
          {output ? (
            <pre className="terminal-text">{output}</pre>
          ) : (
            <div className="terminal-empty">Click Run to execute your code in a live sandbox.</div>
          )}
        </div>
      </div>
    );
  }

  if (!previewHtml) return (
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
        <div className="preview-actions" style={{ position: 'relative' }}>
          <button
            className="run-btn"
            onClick={() => setShowExportMenu(s => !s)}
            disabled={isExporting}
          >
            {isExporting ? '◈ Exporting…' : '⬇ Export'}
          </button>
          {showExportMenu && (
            <div className="export-menu">
              <button className="export-menu-item" onClick={exportPNG}>PNG</button>
              <button className="export-menu-item" onClick={subscriptionTier === 'free' ? onProRequired : exportJPG}>
                JPG {subscriptionTier === 'free' && <span className="export-menu-badge export-menu-badge--pro">⬡ Pro</span>}
              </button>
              <button className="export-menu-item" onClick={subscriptionTier === 'free' ? onProRequired : exportGIF}>
                GIF&nbsp;<span className="export-menu-badge">{subscriptionTier === 'free' ? '⬡ Pro' : 'animated'}</span>
              </button>
              <button className="export-menu-item" onClick={subscriptionTier === 'free' ? onProRequired : exportPDF}>
                PDF {subscriptionTier === 'free' && <span className="export-menu-badge export-menu-badge--pro">⬡ Pro</span>}
              </button>
            </div>
          )}
        </div>
      </div>
      <iframe
        ref={iframeRef}
        className="preview-frame"
        srcDoc={previewHtml}
        sandbox="allow-scripts allow-same-origin allow-modals"
        title="Preview"
        onClick={() => setShowExportMenu(false)}
      />
    </div>
  );
}
