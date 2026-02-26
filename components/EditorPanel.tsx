'use client';
import dynamic from 'next/dynamic';
import { FileNode } from '@/app/page';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

export default function EditorPanel({ activeFile, onFileUpdate }: {
  activeFile: FileNode | null;
  onFileUpdate: (f: FileNode) => void;
}) {
  if (!activeFile) return (
    <div className="editor-panel">
      <div className="editor-empty">Select a file from the sidebar or generate code via chat.</div>
    </div>
  );

  return (
    <div className="editor-panel">
      <div className="editor-header">
        <span>◻</span>
        <span className="editor-filename">{activeFile.name}</span>
        <span style={{ color: 'var(--text3)', fontSize: 11 }}>— {activeFile.language}</span>
      </div>
      <div style={{ flex: 1 }}>
        <MonacoEditor
          height="100%"
          language={activeFile.language}
          value={activeFile.content}
          theme="vs-dark"
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
          }}
        />
      </div>
    </div>
  );
}