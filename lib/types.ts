export interface FileNode {
  name: string;
  content: string;
  language: string;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'file'; name: string; relativePath: string; content: string }
  | {
      type: 'image';
      mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
      data: string;
    }
  | { type: 'pdf'; name: string; storageKey: string }
  | { type: 'generated-image'; url: string; prompt: string }
  | { type: 'generated-video'; url: string; prompt: string }
  | { type: 'generated-music'; url: string; prompt: string }
  | { type: 'clarify'; question: string; options: string[] }
  | { type: 'error'; message: string; prompt?: string; actualError?: string };

export interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export function contentToString(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map(b => b.text)
    .join('\n');
}

export interface Project {
  id: string;
  name: string;
  files: FileNode[];
  messages: Message[];
  updatedAt: number;
  memory?: string;
}
