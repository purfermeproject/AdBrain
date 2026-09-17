export const DEFAULT_WORKSPACE_ID =
  process.env.DEFAULT_WORKSPACE_ID || "00000000-0000-0000-0000-000000000001";

export function getWorkspaceId(input?: string | null) {
  return input || DEFAULT_WORKSPACE_ID;
}
