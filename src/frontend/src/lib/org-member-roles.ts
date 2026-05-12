const ASSIGNABLE_SYSTEM_ROLES = new Set(["org_admin", "user", "viewer"]);

export function assignableMemberRoles<T extends { is_system: boolean; name: string }>(
  roles: T[],
): T[] {
  return roles.filter((r) => !r.is_system || ASSIGNABLE_SYSTEM_ROLES.has(r.name));
}
