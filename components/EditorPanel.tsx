'use client';
import dynamic from 'next/dynamic';
import { useRef, useState } from 'react';
import { FileNode } from '@/app/page';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

export default function EditorPanel({ activeFile, onFileUpdate }: {
  activeFile: FileNode | null;
  onFileUpdate: (f: FileNode) => void;
}) {
  const editorRef = useRef<any>(null);
  const [copied, setCopied]   = useState(false);
  const [wordWrap, setWordWrap] = useState<'off' | 'on'>('off');

  const copy = async () => {
    if (!activeFile) return;
    await navigator.clipboard.writeText(activeFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const download = () => {
    if (!activeFile) return;
    const blob = new Blob([activeFile.content], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = activeFile.name;
    a.click();
  };

  const format = () => {
    editorRef.current?.getAction('editor.action.formatDocument')?.run();
  };

  const lineCount = activeFile?.content.split('\n').length ?? 0;
  const charCount = activeFile?.content.length ?? 0;

  if (!activeFile) return (
    <div className="editor-panel">
      <div className="editor-empty">
        <div className="editor-empty-icon">{'{ }'}</div>
        <div className="editor-empty-text">Select a file from the sidebar, or describe what to build in chat.</div>
      </div>
    </div>
  );

  return (
    <div className="editor-panel">
      <div className="editor-header">
        <span>◻</span>
        <span className="editor-filename">{activeFile.name}</span>
        <span className="editor-lang">— {activeFile.language}</span>
        <div className="editor-actions">
          <button
            className="editor-action-btn"
            onClick={() => setWordWrap(w => w === 'off' ? 'on' : 'off')}
            title="Toggle word wrap"
          >{wordWrap === 'on' ? '⇌ Wrap on' : '→ Wrap off'}</button>
          <button className="editor-action-btn" onClick={format} title="Format document">◈ Format</button>
          <button className="editor-action-btn" onClick={copy} title="Copy all">
            {copied ? '✓ Copied' : '⎘ Copy'}
          </button>
          <button className="editor-action-btn" onClick={download} title="Download file">↓ Download</button>
        </div>
        <span className="editor-stats">{lineCount.toLocaleString()} lines · {charCount.toLocaleString()} chars</span>
      </div>
      <div style={{ flex: 1 }}>
        <MonacoEditor
          height="100%"
          language={activeFile.language}
          value={activeFile.content}
          theme="vs-dark"
          onMount={ed => { editorRef.current = ed; }}
          onChange={val => onFileUpdate({ ...activeFile, content: val ?? '' })}
          options={{
            fontSize: 13,
            fontFamily: "'Space Mono', monospace",
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            padding: { top: 16, bottom: 16 },
            lineNumbers: 'on',
            renderLineHighlight: 'line',
            tabSize: 2,
            wordWrap,
            formatOnPaste: true,
            bracketPairColorization: { enabled: true },
            smoothScrolling: true,
          }}
        />
      </div>
    </div>
  );
}
