import { NextRequest, NextResponse } from 'next/server';
import { Sandbox } from 'e2b';

export async function POST(req: NextRequest) {
  try {
    const { files, projectType } = await req.json();

    const sandbox = await Sandbox.create({
      apiKey: process.env.E2B_API_KEY,
    });

    let output = '';

    if (projectType === 'python') {
      const mainFile = files.find((f: any) => f.name.endsWith('.py'));
      if (!mainFile) throw new Error('No Python file found');

      for (const file of files) {
        await sandbox.files.write(file.name, file.content);
      }

      const result = await sandbox.commands.run(`python3 ${mainFile.name}`);
      output = result.stdout || result.stderr || 'No output';

    } else if (projectType === 'node') {
      for (const file of files) {
        await sandbox.files.write(file.name, file.content);
      }

      const pkgFile = files.find((f: any) => f.name === 'package.json');
      if (pkgFile) {
        await sandbox.commands.run('npm install');
      }

      const mainFile = files.find((f: any) => f.name === 'index.js' || f.name === 'main.js' || f.name === 'app.js');
      if (!mainFile) throw new Error('No Node.js entry file found (index.js/main.js/app.js)');

      const result = await sandbox.commands.run(`node ${mainFile.name}`);
      output = result.stdout || result.stderr || 'No output';

    } else {
      output = 'HTML projects run in the Preview tab — no execution needed.';
    }

    await sandbox.kill();

    return NextResponse.json({ output });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ output: `Error: ${err.message}` }, { status: 500 });
  }
}