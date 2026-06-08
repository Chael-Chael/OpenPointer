import type { AgentBackendId, CapabilityHint, CapabilityItem, CapabilitySnapshot } from '@openpointer/core';

const MAX_HINTS_PER_KIND = 24;

export function matchCapabilitySnapshot(snapshot: CapabilitySnapshot | null, backend: AgentBackendId, text: string): { mcp: CapabilityHint[]; skills: CapabilityHint[] } {
  if (!snapshot || snapshot.status !== 'ready') return { mcp: [], skills: [] };
  const keywords = extractKeywords(text);
  if (keywords.length === 0) return { mcp: [], skills: [] };
  return {
    mcp: matchItems(snapshot.mcp, backend, keywords),
    skills: matchItems(snapshot.skills, backend, keywords)
  };
}

export function extractKeywords(text: string): string[] {
  const normalized = text.toLowerCase();
  const tokens = normalized.match(/[\p{L}\p{N}_-]{2,}/gu) ?? [];
  return [...new Set(tokens.map((token) => token.trim()).filter((token) => token.length >= 2))].slice(0, 80);
}

function matchItems(items: CapabilityItem[], backend: AgentBackendId, keywords: string[]): CapabilityHint[] {
  return items
    .filter((item) => supportsBackend(item, backend))
    .map((item) => ({ item, matchedKeywords: matchedKeywords(item, keywords) }))
    .filter((result) => result.matchedKeywords.length > 0)
    .sort((a, b) => b.matchedKeywords.length - a.matchedKeywords.length || a.item.name.localeCompare(b.item.name, undefined, { sensitivity: 'base' }))
    .slice(0, MAX_HINTS_PER_KIND)
    .map(({ item, matchedKeywords }) => ({ ...item, matchedKeywords }));
}

function supportsBackend(item: CapabilityItem, backend: AgentBackendId): boolean {
  if (backend === 'auto') return item.backendIds.some((candidate) => candidate !== 'mock' && candidate !== 'local-vlm');
  return item.backendIds.includes(backend);
}

function matchedKeywords(item: CapabilityItem, keywords: string[]): string[] {
  const haystack = [item.name, item.description, ...(item.tags ?? []), ...(item.triggers ?? [])].filter(Boolean).join(' ').toLowerCase();
  const normalizedName = item.name.toLowerCase();
  return keywords.filter((keyword) => haystack.includes(keyword) || keyword.includes(normalizedName));
}
