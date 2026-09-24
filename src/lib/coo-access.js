// The COO workspace is private to the owner during its initial rollout.
// Analytics/admin permissions do not grant access to this workspace.
export function canAccessCoo(access) {
  return access?.role === 'owner';
}
