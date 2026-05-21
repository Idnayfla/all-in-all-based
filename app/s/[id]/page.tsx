import { createClient } from '@supabase/supabase-js';
import { notFound } from 'next/navigation';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } }
);

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await supabase.from('shares').select('project_name').eq('id', id).single();
  return {
    title: data ? `${data.project_name} — Built with Based` : 'Based',
    description: 'Built with Based AI Dev Studio',
    openGraph: {
      title: data ? `${data.project_name} — Built with Based` : 'Based',
      description: 'Built with Based AI Dev Studio — describe it, Based builds it.',
      url: `https://getbased.dev/s/${id}`,
    },
  };
}

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data, error } = await supabase
    .from('shares')
    .select('project_name, files')
    .eq('id', id)
    .single();

  if (error || !data) notFound();

  const htmlFile =
    data.files.find((f: { name: string; content: string }) => f.name === 'index.html') ??
    data.files[0];
  if (!htmlFile) notFound();

  const srcDoc = htmlFile.content;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: '#0d0d0d',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          borderBottom: '1px solid #222',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{ color: '#8b5cf6', fontWeight: 700, fontFamily: 'monospace', fontSize: 16 }}
          >
            B&gt;
          </span>
          <span style={{ color: '#e5e5e5', fontSize: 14, fontWeight: 500 }}>
            {data.project_name}
          </span>
        </div>
        <a
          href="https://getbased.dev"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            background: '#8b5cf6',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '6px 14px',
            fontSize: 13,
            fontWeight: 600,
            textDecoration: 'none',
            cursor: 'pointer',
          }}
        >
          Build your own →
        </a>
      </div>
      <iframe
        srcDoc={srcDoc}
        style={{ flex: 1, border: 'none', width: '100%' }}
        sandbox="allow-scripts allow-same-origin allow-modals"
        title={data.project_name}
      />
    </div>
  );
}
