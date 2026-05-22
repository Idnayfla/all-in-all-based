import { FileNode } from '@/app/page';

export function isScreenCaptureSupported(): boolean {
  if (typeof navigator === 'undefined') return false;
  return typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

export interface PreviewCapture {
  source: string;
  label: string;
}

export function capturePreview(files: FileNode[]): PreviewCapture | null {
  if (!files.length) return null;

  const order = ['html', 'css', 'javascript', 'js', 'typescript', 'ts', 'python', 'json'];
  const sorted = [...files].sort((a, b) => {
    const ai = order.indexOf(a.language);
    const bi = order.indexOf(b.language);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const parts = sorted.map(f => `\`\`\`${f.language}\n${f.content}\n\`\`\``);

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
    await new Promise<void>(resolve => {
      video.onloadedmetadata = () => resolve();
    });
    await video.play();

    const MAX_W = 1280;
    let w = video.videoWidth;
    let h = video.videoHeight;
    if (w > MAX_W) {
      h = Math.round((h * MAX_W) / w);
      w = MAX_W;
    }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(video, 0, 0, w, h);

    stream.getTracks().forEach(t => t.stop());
    video.srcObject = null;

    return canvas.toDataURL('image/jpeg', 0.75);
  } catch {
    return null;
  }
}
