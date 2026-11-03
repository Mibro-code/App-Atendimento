export function proposalOriginId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : undefined;
}
export function withProposalOrigin(path: string, origin?: string): string {
  const id = proposalOriginId(origin);
  return id ? `${path}${path.includes('?') ? '&' : '?'}atendimento=${encodeURIComponent(id)}` : path;
}
