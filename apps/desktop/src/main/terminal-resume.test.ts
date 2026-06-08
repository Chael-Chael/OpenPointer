import { describe, expect, it } from 'vitest';
import { buildResumeTerminalSpawn, withExecutableArgs } from './terminal-resume.js';

describe('buildResumeTerminalSpawn', () => {
  it('passes the Claude resume session id as a command argument', () => {
    const result = buildResumeTerminalSpawn(
      {
        executable: 'claude',
        args: ['--resume', '584aa4df-df2a-4d85-8456-1f05bb093d51', '--model', 'sonnet', '--effort', 'medium'],
        title: 'OpenPointer Claude'
      },
      'D:\\OpenMagicPointer'
    );

    expect(result.executable).toBe('cmd.exe');
    expect(result.args).toEqual([
      '/d',
      '/c',
      'start',
      '""',
      'cmd.exe',
      '/k',
      'title OpenPointer Claude && cd /d "D:\\OpenMagicPointer" && call claude --resume 584aa4df-df2a-4d85-8456-1f05bb093d51 --model sonnet --effort medium'
    ]);
  });

  it('quotes executable paths and cwd values with spaces', () => {
    const result = buildResumeTerminalSpawn(
      {
        executable: 'C:\\Program Files\\Claude\\claude.exe',
        args: ['--resume', 'session-id'],
        title: 'OpenPointer Claude'
      },
      'D:\\Open Magic Pointer'
    );

    expect(result.args.at(-1)).toBe(
      'title OpenPointer Claude && cd /d "D:\\Open Magic Pointer" && call "C:\\Program Files\\Claude\\claude.exe" --resume session-id'
    );
  });
});

describe('withExecutableArgs', () => {
  it('keeps extra executable-field arguments before generated resume args', () => {
    expect(
      withExecutableArgs({
        executable: 'claude --permission-mode auto',
        args: ['--resume', 'session-id'],
        title: 'OpenPointer Claude'
      })
    ).toEqual({
      executable: 'claude',
      args: ['--permission-mode', 'auto', '--resume', 'session-id'],
      title: 'OpenPointer Claude'
    });
  });

  it('handles quoted executable paths with extra args', () => {
    expect(
      withExecutableArgs({
        executable: '"C:\\Program Files\\Claude\\claude.exe" --permission-mode auto',
        args: ['--resume', 'session-id'],
        title: 'OpenPointer Claude'
      })
    ).toEqual({
      executable: 'C:\\Program Files\\Claude\\claude.exe',
      args: ['--permission-mode', 'auto', '--resume', 'session-id'],
      title: 'OpenPointer Claude'
    });
  });

  it('handles unquoted Windows executable paths with extra args', () => {
    expect(
      withExecutableArgs({
        executable: 'C:\\Program Files\\Claude\\claude.exe --permission-mode auto',
        args: ['--resume', 'session-id'],
        title: 'OpenPointer Claude'
      })
    ).toEqual({
      executable: 'C:\\Program Files\\Claude\\claude.exe',
      args: ['--permission-mode', 'auto', '--resume', 'session-id'],
      title: 'OpenPointer Claude'
    });
  });
});
