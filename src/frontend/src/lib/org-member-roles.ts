/**
 * Roles an org admin may grant to org members: custom org roles plus the
 * global system `org_admin` role (other system roles stay hidden).
 */
export function assignableMemberRoles<T extends { is_system: boolean; name: string }>(
  roles: T[],
): T[] {
  return roles.filter((r) => !r.is_system || r.name === "org_admin");
}
