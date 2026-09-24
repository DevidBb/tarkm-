// Access to Artifact runtime capabilities (db, sample, assets).
// Resolves null when the page runs outside a Claude viewer (e.g. the local preview server),
// so every feature that needs a capability must work without it.

export function capability(name) {
  const c = window.claude;
  if (!c || typeof c.use !== 'function') return Promise.resolve(null);
  return c.use(name).catch(() => null);
}

export const isClaudeViewer = () => Boolean(window.claude && typeof window.claude.use === 'function');
