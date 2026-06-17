'use client';

import React from 'react';

// Inline patterns: **bold**, *italic*, `code`, ![alt](url), [text](url)
// Order matters — bold before italic, image before link
const INLINE_RE =
  /(\*\*([^*]+?)\*\*)|(\*([^*]+?)\*)|(`)([^`]+?)`|!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)/g;

function parseInline(text: string, prefix: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let n = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(INLINE_RE.source, 'g');

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const k = `${prefix}-${n++}`;
    if (m[1]) parts.push(<strong key={k}>{m[2]}</strong>);
    else if (m[3]) parts.push(<em key={k}>{m[4]}</em>);
    else if (m[5]) parts.push(<code key={k}>{m[6]}</code>);
    else if (m[7] !== undefined)
      parts.push(
        <img
          key={k}
          src={m[8]}
          alt={m[7]}
          className="chat-inline-image"
          loading="lazy"
          onError={e => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      );
    else if (m[9])
      parts.push(
        <a key={k} href={m[10]} target="_blank" rel="noreferrer">
          {m[9]}
        </a>
      );
    last = m.index + m[0].length;
  }

  if (last < text.length) parts.push(text.slice(last));
  if (parts.length === 0) return null;
  if (parts.length === 1 && typeof parts[0] === 'string') return parts[0];
  return <React.Fragment key={prefix}>{parts}</React.Fragment>;
}

export default function SimpleMarkdown({ children }: { children: string }) {
  const lines = children.split('\n');
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        code.push(lines[i]);
        i++;
      }
      out.push(
        <pre key={key++}>
          <code className={lang ? `language-${lang}` : ''}>{code.join('\n')}</code>
        </pre>
      );
      i++;
      continue;
    }

    // Headings
    const hm = line.match(/^(#{1,3}) (.*)/);
    if (hm) {
      const level = hm[1].length as 1 | 2 | 3;
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3';
      out.push(<Tag key={key++}>{parseInline(hm[2], `h-${key}`)}</Tag>);
      i++;
      continue;
    }

    // Unordered list
    if (/^[-*•] /.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^[-*•] /.test(lines[i])) {
        items.push(<li key={i}>{parseInline(lines[i].slice(2), `li-${i}`)}</li>);
        i++;
      }
      out.push(<ul key={key++}>{items}</ul>);
      continue;
    }

    // Ordered list
    if (/^\d+\. /.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(<li key={i}>{parseInline(lines[i].replace(/^\d+\. /, ''), `oli-${i}`)}</li>);
        i++;
      }
      out.push(<ol key={key++}>{items}</ol>);
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph — collect consecutive plain lines
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^#{1,3} /.test(lines[i]) &&
      !lines[i].startsWith('```') &&
      !/^[-*•] /.test(lines[i]) &&
      !/^\d+\. /.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    if (para.length > 0) {
      out.push(<p key={key++}>{parseInline(para.join('\n'), `p-${key}`)}</p>);
    }
  }

  return <>{out}</>;
}
