import { NextRequest, NextResponse } from 'next/server';
import { Sandbox } from 'e2b';
import { getUserId } from '../_auth';

interface SandboxFile {
  name: string;
  content: string;
}

export const maxDuration = 120;

async function run(sandbox: Sandbox, cmd: string, cwd?: string) {
  const result = await sandbox.commands.run(cmd, { cwd });
  return { stdout: result.stdout?.trim() ?? '', stderr: result.stderr?.trim() ?? '' };
}

export async function POST(req: NextRequest) {
  try {
    await getUserId(req);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let sandbox: Sandbox | null = null;
  try {
    const { files, projectType }: { files: SandboxFile[]; projectType: string } = await req.json();

    sandbox = await Sandbox.create({ apiKey: process.env.E2B_API_KEY });
    const workdir = '/home/user/project';
    await sandbox.commands.run(`mkdir -p ${workdir}`);

    for (const file of files) {
      await sandbox.files.write(`${workdir}/${file.name}`, file.content);
    }

    let stdout = '';
    let stderr = '';

    if (projectType === 'python') {
      const main =
        files.find((f: SandboxFile) => f.name === 'main.py') ??
        files.find((f: SandboxFile) => f.name.endsWith('.py'));
      if (!main) throw new Error('No Python file found');
      const r = await run(sandbox, `python3 ${main.name}`, workdir);
      stdout = r.stdout;
      stderr = r.stderr;
    } else if (projectType === 'node') {
      const pkgFile = files.find((f: SandboxFile) => f.name === 'package.json');
      if (pkgFile) await run(sandbox, 'npm install --silent', workdir);
      const entry = files.find((f: SandboxFile) => ['index.js', 'main.js', 'app.js'].includes(f.name));
      if (!entry) throw new Error('No Node.js entry file found (index.js / main.js / app.js)');
      const r = await run(sandbox, `node ${entry.name}`, workdir);
      stdout = r.stdout;
      stderr = r.stderr;
    } else if (projectType === 'java') {
      await run(sandbox, 'apt-get install -y -q default-jdk-headless 2>&1 | tail -3');
      const javaFiles = files
        .filter((f: SandboxFile) => f.name.endsWith('.java'))
        .map((f: SandboxFile) => f.name)
        .join(' ');
      const compile = await sandbox.commands.run(`javac ${javaFiles}`, { cwd: workdir });
      if (compile.stderr?.trim()) {
        stderr = `Compile error:\n${compile.stderr}`;
      } else {
        const main =
          files.find((f: SandboxFile) => f.name === 'Main.java') ??
          files.find((f: SandboxFile) => f.name.endsWith('.java'));
        const className = main?.name.replace('.java', '') ?? 'Main';
        const r = await run(sandbox, `java ${className}`, workdir);
        stdout = r.stdout;
        stderr = r.stderr;
      }
    } else if (projectType === 'cpp') {
      const entry =
        files.find((f: SandboxFile) => f.name === 'main.cpp') ??
        files.find((f: SandboxFile) => f.name.endsWith('.cpp'));
      if (!entry) throw new Error('No .cpp file found');
      const compile = await sandbox.commands.run(`g++ -std=c++17 ${entry.name} -o program`, {
        cwd: workdir,
      });
      if (compile.stderr?.trim()) {
        stderr = `Compile error:\n${compile.stderr}`;
      } else {
        const r = await run(sandbox, './program', workdir);
        stdout = r.stdout;
        stderr = r.stderr;
      }
    } else if (projectType === 'go') {
      await run(sandbox, 'apt-get install -y -q golang 2>&1 | tail -3');
      const entry =
        files.find((f: SandboxFile) => f.name === 'main.go') ??
        files.find((f: SandboxFile) => f.name.endsWith('.go'));
      if (!entry) throw new Error('No .go file found');
      const r = await run(sandbox, `go run ${entry.name}`, workdir);
      stdout = r.stdout;
      stderr = r.stderr;
    } else if (projectType === 'rust') {
      await run(
        sandbox,
        'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal'
      );
      const entry =
        files.find((f: SandboxFile) => f.name === 'main.rs') ??
        files.find((f: SandboxFile) => f.name.endsWith('.rs'));
      if (!entry) throw new Error('No .rs file found');
      const compile = await sandbox.commands.run(
        `$HOME/.cargo/bin/rustc ${entry.name} -o program`,
        { cwd: workdir }
      );
      const compileErr = compile.stderr?.trim() ?? '';
      if (compileErr && !compileErr.includes('warning')) {
        stderr = `Compile error:\n${compileErr}`;
      } else {
        if (compileErr) stderr = compileErr; // show warnings
        const r = await run(sandbox, './program', workdir);
        stdout = r.stdout;
        stderr = stderr || r.stderr;
      }
    } else if (projectType === 'bash') {
      const entry = files.find((f: SandboxFile) => f.name.endsWith('.sh')) ?? files[0];
      if (!entry) throw new Error('No shell script found');
      await run(sandbox, `chmod +x ${entry.name}`, workdir);
      const r = await run(sandbox, `bash ${entry.name}`, workdir);
      stdout = r.stdout;
      stderr = r.stderr;
    } else {
      stdout = 'HTML/CSS/JS projects run in the Preview tab — no server execution needed.';
    }

    return NextResponse.json({ output: stdout, stderr });
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json({ output: `Error: ${err instanceof Error ? err.message : String(err)}`, stderr: '' }, { status: 500 });
  } finally {
    if (sandbox) {
      try {
        await sandbox.kill();
      } catch {}
    }
  }
}
