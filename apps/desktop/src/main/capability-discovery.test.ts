import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { builtInSkillCapabilities, capabilitiesFromCcSwitchRows, mergeCapabilityItems, scanNativeCapabilities } from './capability-discovery.js';

function makeHome(): string {
  return mkdtempSync(join(tmpdir(), 'openpointer-capabilities-'));
}

function writeText(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

describe('capability discovery', () => {
  it('merges cc-switch and native MCP sources into a de-duplicated union', async () => {
    const home = makeHome();
    try {
      writeText(
        join(home, '.codex', 'config.toml'),
        ['[mcp_servers.zotero]', 'command = "zotero-mcp"', '', '[mcp_servers.figma]', 'url = "https://mcp.figma.com/mcp"'].join('\n')
      );
      writeText(
        join(home, '.config', 'opencode', 'opencode.json'),
        JSON.stringify({
          mcp: {
            zotero: {
              enabled: true,
              type: 'local',
              command: ['zotero-mcp', 'serve']
            }
          }
        })
      );

      const ccSwitch = capabilitiesFromCcSwitchRows(
        [
          {
            name: 'zotero',
            description: 'Reference manager MCP',
            server_config: JSON.stringify({ command: ['zotero-mcp', 'serve'] }),
            enabled_codex: 1
          }
        ],
        []
      );
      const native = await scanNativeCapabilities({ homeDir: home, appDataDir: join(home, 'AppData', 'Roaming') });
      const merged = mergeCapabilityItems([...ccSwitch, ...native]);

      const zotero = merged.mcp.find((item) => item.name === 'zotero');
      expect(zotero).toBeDefined();
      expect(zotero?.sources).toEqual(['native', 'cc-switch']);
      expect(zotero?.backendIds).toEqual(['codex', 'opencode']);
      expect(merged.mcp.map((item) => item.name).sort()).toEqual(['figma', 'zotero']);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('reads SKILL.md metadata and merges duplicate skills across sources', async () => {
    const home = makeHome();
    try {
      const skillBody = ['---', 'name: paper-reader', 'description: Read and summarize academic papers.', '---', '', '# Paper Reader'].join('\n');
      writeText(join(home, '.codex', 'skills', 'paper-reader', 'SKILL.md'), skillBody);
      writeText(join(home, '.claude', 'skills', 'paper-reader', 'SKILL.md'), skillBody);

      const ccSwitch = capabilitiesFromCcSwitchRows([], [
        {
          name: 'paper-reader',
          description: 'Older database description',
          directory: 'paper-reader',
          enabled_codex: 1
        }
      ]);
      const native = await scanNativeCapabilities({ homeDir: home, appDataDir: join(home, 'AppData', 'Roaming') });
      const merged = mergeCapabilityItems([...ccSwitch, ...native]);

      expect(merged.skills).toHaveLength(1);
      expect(merged.skills[0]).toMatchObject({
        name: 'paper-reader',
        description: 'Read and summarize academic papers.',
        backendIds: ['claude-agent', 'codex'],
        sources: ['native', 'cc-switch']
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('provides built-in skill registry metadata for common pointer workflows', () => {
    const skills = builtInSkillCapabilities();
    const names = skills.map((item) => item.name);

    expect(names).toEqual(expect.arrayContaining(['openpointer.generic-cua', 'openpointer.text-selection', 'openpointer.browser', 'openpointer.document-pdf', 'openpointer.code']));
    expect(skills.find((item) => item.name === 'openpointer.generic-cua')).toMatchObject({
      sources: ['built-in'],
      requiredTools: expect.arrayContaining(['cua:get_window_state', 'cua:click']),
      executionTemplate: {
        verification: {
          strategy: 'uia-state'
        }
      }
    });
  });
});
