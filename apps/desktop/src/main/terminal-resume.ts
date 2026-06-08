export type ResumeTerminalCommand = {
  executable: string;
  args: string[];
  title: string;
};

export type ResumeTerminalSpawn = {
  executable: string;
  args: string[];
};

export function withExecutableArgs(command: ResumeTerminalCommand): ResumeTerminalCommand {
  const executableValue = command.executable.trim();
  const windowsExecutable = splitUnquotedWindowsExecutable(executableValue);
  if (windowsExecutable) {
    return {
      ...command,
      executable: windowsExecutable.executable,
      args: [...windowsExecutable.args, ...command.args]
    };
  }
  const parts = splitCommandLine(executableValue);
  if (parts.length <= 1) return command;
  const executable = parts[0];
  const extraArgs = parts.slice(1);
  if (!executable) return command;
  return {
    ...command,
    executable,
    args: [...extraArgs, ...command.args]
  };
}

export function buildResumeTerminalSpawn(command: ResumeTerminalCommand, cwd: string): ResumeTerminalSpawn {
  const normalized = withExecutableArgs(command);
  const commandLine = [
    'title',
    escapeTitle(normalized.title),
    '&&',
    'cd',
    '/d',
    quoteCmdArg(cwd),
    '&&',
    'call',
    quoteCmdArg(normalized.executable),
    ...normalized.args.map(quoteCmdArg)
  ].join(' ');

  return {
    executable: 'cmd.exe',
    args: ['/d', '/c', 'start', '""', 'cmd.exe', '/k', commandLine]
  };
}

function splitCommandLine(value: string): string[] {
  if (!value) return [];
  const parts: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === undefined) continue;
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }

  if (current) parts.push(current);
  return parts;
}

function escapeTitle(value: string): string {
  return value.replace(/[&|<>^]/g, '^$&');
}

function splitUnquotedWindowsExecutable(value: string): { executable: string; args: string[] } | null {
  if (!/^[A-Za-z]:\\/.test(value) || value.startsWith('"')) return null;
  const match = /\.(?:exe|cmd|bat|ps1)(?=\s|$)/i.exec(value);
  if (!match || match.index === undefined) return { executable: value, args: [] };
  const executableEnd = match.index + match[0].length;
  const executable = value.slice(0, executableEnd);
  const rest = value.slice(executableEnd).trim();
  return {
    executable,
    args: rest ? splitCommandLine(rest) : []
  };
}

function quoteCmdArg(value: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}
