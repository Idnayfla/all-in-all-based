import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '../_auth';

export async function POST(req: NextRequest) {
  try {
    await getUserId(req);
    const { files, projectName } = await req.json();

    // Create a new site
    const siteRes = await fetch('https://api.netlify.com/api/v1/sites', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.NETLIFY_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: projectName.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now(),
      }),
    });

    const site = await siteRes.json();
    if (!site.id) throw new Error('Failed to create site');

    // Build file digest for deployment
    const fileMap: Record<string, string> = {};
    const fileContents: Record<string, string> = {};

    for (const file of files) {
      const encoder = new TextEncoder();
      const data = encoder.encode(file.content);
      const hashBuffer = await crypto.subtle.digest('SHA-1', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      fileMap[`/${file.name}`] = hashHex;
      fileContents[hashHex] = file.content;
    }

    // Create deployment
    const deployRes = await fetch(`https://api.netlify.com/api/v1/sites/${site.id}/deploys`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.NETLIFY_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ files: fileMap }),
    });

    const deploy = await deployRes.json();
    if (!deploy.id) throw new Error('Failed to create deployment');

    // Upload required files
    for (const [sha, content] of Object.entries(fileContents)) {
      if (deploy.required?.includes(sha)) {
        const fileName =
          Object.entries(fileMap).find(([, hash]) => hash === sha)?.[0]?.slice(1) ?? 'index.html';

        await fetch(`https://api.netlify.com/api/v1/deploys/${deploy.id}/files/${fileName}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${process.env.NETLIFY_TOKEN}`,
            'Content-Type': 'application/octet-stream',
          },
          body: content,
        });
      }
    }

    return NextResponse.json({
      url: site.ssl_url || site.url || `https://${site.subdomain}.netlify.app`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
