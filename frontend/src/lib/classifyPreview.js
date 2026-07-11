/**
 * Client-side preview of routing, used only to aim the packet animation at an
 * agent card the instant a request is submitted, before the real POST
 * /api/dispatch response comes back. This is cosmetic only: the actual
 * routing decision is made server-side by server/services/classifier.ts, and
 * the agent_id in the real response always overrides this guess once it
 * arrives. The keyword list below is copied verbatim from classifier.ts so
 * the preview matches the real decision in the overwhelming common case.
 */
const CHAINGUARD_KEYWORDS = ['contract', 'audit', 'token', 'mint', 'rug', '0x', 'scan'];

export function classifyPreview(requestText) {
  const normalized = requestText.toLowerCase();
  const matchesChainGuard = CHAINGUARD_KEYWORDS.some((keyword) => normalized.includes(keyword));
  return matchesChainGuard ? 'chainguard' : 'verimath';
}
