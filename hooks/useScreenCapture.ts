import { FileNode } from '@/app/page';

export interface PreviewCapture {
  source: string;
  label: string;
}

export function capturePreview(files: FileNode[]): PreviewCapture | null {
  const htmlFile = files.find(f => f.language === 'html');
  const cssFile = files.find(f => f.language === 'css');
  const jsFile = files.find(f => f.language === 'javascript' || f.language === 'js');

  if (!htmlFile && !cssFile && !jsFile) return null;

  const parts: string[] = [];
  if (htmlFile) parts.push(`\`\`\`html\n${htmlFile.content}\n\`\`\``);
  if (cssFile) parts.push(`\`\`\`css\n${cssFile.content}\n\`\`\``);
  if (jsFile) parts.push(`\`\`\`js\n${jsFile.content}\n\`\`\``);

  return {
    source: parts.join('\n\n'),
    label: `${files.length} file${files.length !== 1 ? 's' : ''} captured`,
  };
}

export async function captureScreen(): Promise<string | null> {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const video = document.createElement('video');
    video.srcObject = stream;
    await new Promise<void>(resolve => { video.onloadedmetadata = () => resolve(); });
    await video.play();

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0);

    stream.getTracks().forEach(t => t.stop());
    video.srcObject = null;

    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}
