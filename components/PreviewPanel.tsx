'use client';
import { useMemo, useState } from 'react';
import { FileNode } from '@/app/page';

export default function PreviewPanel({ files, projectType }: { 
  files: FileNode[];
  projectType: string;
}) {
  const [output, setOutput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishUrl, setPublishUrl] = useState('');
  const htmlFile = files.find(f => f.language === 'html');
  const cssFile = files.find(f => f.language === 'css');
  const jsFile = files.find(f => f.language === 'javascript' || f.language === 'js');

  const previewHtml = useMemo(() => {
    if (!htmlFile) return null;
    let html = htmlFile.content;
    if (cssFile) html = html.replace('</head>', `<style>${cssFile.content}</style></head>`);
    if (jsFile) html = html.replace('</body>', `<script>${jsFile.content}</script></body>`);
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
    } catch (e) {
      setOutput('Error: Could not execute code.');
    } finally {
      setIsRunning(false);
    }
  };

  const publishApp = async () => {
    setIsPublishing(true);
    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files, projectName: 'based-app' }),
      });
      const data = await res.json();
      if (data.url) setPublishUrl(data.url);
      else alert('Publish failed: ' + data.error);
    } catch (e) {
      alert('Publish failed');
    } finally {
      setIsPublishing(false);
    }
  };

  if (projectType === 'python' || projectType === 'node') {
    return (
      <div className="preview-panel">
        <div className="preview-header">
          <span>⬡ Terminal Output</span>
          <button className="run-btn" onClick={runCode} disabled={isRunning || files.length === 0}>
            {isRunning ? '⏳ Running...' : '▶ Run'}
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
        <div className="preview-actions">
          <button className="run-btn" onClick={publishApp} disabled={isPublishing}>
            {isPublishing ? '... Publishing' : '◆ Publish'}
          </button>
        </div>
      </div>
      {publishUrl && (
        <div className="publish-url-bar">
          <a href={publishUrl} target="_blank" rel="noreferrer" className="publish-link">
            ▸ {publishUrl}
          </a>
        </div>
      )}
      <iframe
        className="preview-frame"
        srcDoc={previewHtml}
        sandbox="allow-scripts allow-same-origin"
        title="Preview"
      />
    </div>
  );
}