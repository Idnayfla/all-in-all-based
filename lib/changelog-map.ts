export type ChangelogRef = {
  label: string; // e.g. 'v0.1.5'
  title: string; // e.g. 'Resizable Companion'
  anchor: string; // article id on /changelog — `${label.replace(/\./g,'-')}-${title.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'')}` e.g. 'v0-1-5-resizable-companion'
};

/**
 * Maps Supabase feature_request UUID → the changelog entry where it shipped.
 *
 * How to populate:
 * 1. Mark the feature_request as 'done' in Supabase
 * 2. Ship the changelog entry with requestedByCommunity: true and voteRequestId: '<uuid>'
 * 3. Add the UUID here: { label, title, anchor: 'v0-1-5-resizable-companion' }
 */
export const CHANGELOG_MAP: Record<string, ChangelogRef> = {
  // Example:
  // 'f3a1b2c4-...': { label: 'v0.1.5', title: 'Resizable Companion', anchor: 'v0-1-5-resizable-companion' },
};
