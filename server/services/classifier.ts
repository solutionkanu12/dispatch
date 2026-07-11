export type AgentId = 'verimath' | 'chainguard';

const CHAINGUARD_KEYWORDS = ['contract', 'audit', 'token', 'mint', 'rug', '0x', 'scan'];

export function classifyRequest(requestText: string): AgentId {
  const normalized = requestText.toLowerCase();
  const matchesChainGuard = CHAINGUARD_KEYWORDS.some((keyword) => normalized.includes(keyword));
  return matchesChainGuard ? 'chainguard' : 'verimath';
}
