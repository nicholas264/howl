// CRM is restricted to the workspace owner during the initial rollout.
export function canAccessCrm(access) {
  return access?.role === 'owner';
}
