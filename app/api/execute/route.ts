import { NextRequest, NextResponse } from 'next/server';
import { Sandbox } from 'e2b';

async function run(sandbox: Sandbox, cmd: string, cwd?: string) {
  const result = await sandbox.commands.run(cmd, { cwd });
  return (result.stdout || result.stderr || '').trim() || 'No output';
}

export async function POST(req: NextRequest) {
  try {
    const { files, projectType } = await req.json();

    const sandbox = await Sandbox.create({ apiKey: process.env.E2B_API_KEY });
    const workdir = '/home/user/project';
    await sandbox.commands.run(`mkdir -p ${workdir}`);

    for (const file of files) {
      await sandbox.files.write(`${workdir}/${file.name}`, file.content);
    }

    let output = '';

    if (projectType === 'python') {
      const main = files.find((f: any) => f.name.endsWith('.py') && (f.name === 'main.py' || files.length === 1));
      const entry = main?.name ?? files.find((f: any) => f.name.endsWith('.py'))?.name;
      if (!entry) throw new Error('No Python file found');
      output = await run(sandbox, `python3 ${entry}`, workdir);

    } else if (projectType === 'node') {
      const pkgFile = files.find((f: any) => f.name === 'package.json');
      if (pkgFile) await run(sandbox, 'npm install --silent', workdir);
      const entry = files.find((f: any) => ['index.js', 'main.js', 'app.js'].includes(f.name));
      if (!entry) throw new Error('No Node.js entry file found (index.js / main.js / app.js)');
      output = await run(sandbox, `node ${entry.name}`, workdir);

    } else if (projectType === 'java') {
      output += await run(sandbox, 'apt-get install -y -q default-jdk-headless 2>&1 | tail -3');
      const javaFiles = files.filter((f: any) => f.name.endsWith('.java')).map((f: any) => f.name).join(' ');
      const compile = await sandbox.commands.run(`javac ${javaFiles}`, { cwd: workdir });
      if (compile.stderr?.trim()) {
        output = `Compile error:\n${compile.stderr}`;
      } else {
        const main = files.find((f: any) => f.name === 'Main.java') ?? files.find((f: any) => f.name.endsWith('.java'));
        const className = main?.name.replace('.java', '') ?? 'Main';
        output = await run(sandbox, `java ${className}`, workdir);
      }

    } else if (projectType === 'cpp') {
      const entry = files.find((f: any) => f.name === 'main.cpp') ?? files.find((f: any) => f.name.endsWith('.cpp'));
      if (!entry) throw new Error('No .cpp file found');
      const compile = await sandbox.commands.run(`g++ -std=c++17 ${entry.name} -o program`, { cwd: workdir });
      if (compile.stderr?.trim()) {
        output = `Compile error:\n${compile.stderr}`;
      } else {
        output = await run(sandbox, './program', workdir);
      }

    } else if (projectType === 'go') {
      output += await run(sandbox, 'apt-get install -y -q golang 2>&1 | tail -3');
      const entry = files.find((f: any) => f.name === 'main.go') ?? files.find((f: any) => f.name.endsWith('.go'));
      if (!entry) throw new Error('No .go file found');
      output = await run(sandbox, `go run ${entry.name}`, workdir);

    } else if (projectType === 'rust') {
      // Install rust toolchain (this may take ~60s on cold sandbox — progress shown)
      await run(sandbox, 'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal');
      const entry = files.find((f: any) => f.name === 'main.rs') ?? files.find((f: any) => f.name.endsWith('.rs'));
      if (!entry) throw new Error('No .rs file found');
      const compile = await sandbox.commands.run(`$HOME/.cargo/bin/rustc ${entry.name} -o program`, { cwd: workdir });
      if (compile.stderr?.trim() && !compile.stderr.includes('warning')) {
        output = `Compile error:\n${compile.stderr}`;
      } else {
        output = await run(sandbox, './program', workdir);
      }

    } else if (projectType === 'bash') {
      const entry = files.find((f: any) => f.name.endsWith('.sh')) ?? files[0];
      if (!entry) throw new Error('No shell script found');
      await run(sandbox, `chmod +x ${entry.name}`, workdir);
      output = await run(sandbox, `bash ${entry.name}`, workdir);

    } else {
      output = 'HTML/CSS/JS projects run in the Preview tab — no server execution needed.';
    }

    await sandbox.kill();
    return NextResponse.json({ output });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ output: `Error: ${err.message}` }, { status: 500 });
  }
}
