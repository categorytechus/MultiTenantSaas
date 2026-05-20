"use client";

import { useState, useEffect, useRef, ReactNode } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { apiFetch } from "../src/lib/api";
import { PERMISSION_MODULE_ENABLED } from "../src/lib/permissions";

interface Org {
  id: string;
  name: string;
  slug: string;
  role: string;
}
interface User {
  id: string;
  email: string;
  full_name?: string;
  name?: string;
  role?: string;
  user_type?: "super_admin" | "user";
}

const DOT_COLORS = ["#1a1a1a", "#2563eb", "#7c3aed", "#0891b2", "#059669"];

function initials(name?: string, email?: string) {
  if (name)
    return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  return (email ?? "U").slice(0, 2).toUpperCase();
}

interface LayoutProps { children: ReactNode; }

function isSuperAdminUserType(userType?: string) {
  if (!userType) return false;
  const n = userType.toLowerCase().replace(/-/g, "_");
  return n === "super_admin" || n === "superadmin";
}

function extractRolesFromToken(token: string): string[] {
  try {
    const payload = JSON.parse(atob(token.split(".")[1])) as { role?: string; roles?: string[] };
    return Array.from(new Set([
      ...(Array.isArray(payload.roles) ? payload.roles : []),
      ...(payload.role ? [payload.role] : []),
    ]));
  } catch { return []; }
}

function extractPrimaryRoleFromToken(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1])) as { role?: string };
    return payload.role ?? null;
  } catch { return null; }
}

function NavItem({ href, active, icon, children, className = "" }: {
  href: string; active: boolean; icon: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors w-full ${
        active
          ? "bg-white text-[#1a1a1a] shadow-sm"
          : "text-[#606060] hover:bg-white hover:text-[#1a1a1a]"
      } ${className}`}
    >
      <span className="w-4 h-4 shrink-0 flex items-center justify-center">{icon}</span>
      {children}
    </Link>
  );
}

export default function Layout({ children }: LayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [cur, setCur] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [userModules, setUserModules] = useState<string[] | null>(null);
  const [modulesResolved, setModulesResolved] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  useEffect(() => {
    (async () => {
      const token = localStorage.getItem("accessToken");
      if (!token) { router.push("/auth/signin"); return; }
      try {
        const uRes = await apiFetch<{ data: User }>("/auth/me");
        if (!uRes.success) throw new Error("Unauthorized");
        const userData = uRes.data.data;
        setUser(userData);
        const primaryRole = extractPrimaryRoleFromToken(token)?.toLowerCase().replace(/-/g, "_");
        const isSuperFromToken = primaryRole === "super_admin";

        if (isSuperAdminUserType(userData.user_type) || isSuperFromToken) {
          const oRes = await apiFetch<{ data: { id: string; name: string; slug: string }[] }>("/admin/organizations");
          if (oRes.success) {
            const allOrgs = oRes.data.data.map((o) => ({ ...o, role: "super_admin" }));
            setOrgs(allOrgs);
            const jwtPayload = JSON.parse(atob(token.split(".")[1]));
            const currentOrgId = jwtPayload.org_id;
            if (currentOrgId) {
              const found = allOrgs.find((o) => o.id === currentOrgId);
              if (found) setCur(found);
            }
          }
        } else {
          const oRes = await apiFetch<{ data: Org[] }>("/organizations/");
          if (oRes.success && oRes.data.data.length > 0) {
            setOrgs(oRes.data.data);
            const jwtPayload = JSON.parse(atob(token.split(".")[1]));
            const currentOrgId = jwtPayload.org_id;
            const found = oRes.data.data.find((o) => o.id === currentOrgId);
            if (found) {
              setCur(found);
            } else {
              const fallbackOrg = oRes.data.data[0];
              const switchRes = await apiFetch<{ data: { access_token: string; refresh_token: string; organization: { role: string } } }>("/organizations/switch", {
                method: "POST",
                body: JSON.stringify({ organization_id: fallbackOrg.id }),
              });
              if (switchRes.success) {
                localStorage.setItem("accessToken", switchRes.data.data.access_token);
                localStorage.setItem("refreshToken", switchRes.data.data.refresh_token);
                setCur({ ...fallbackOrg, role: switchRes.data.data.organization.role });
                window.location.reload();
                return;
              }
              setCur(fallbackOrg);
            }
          } else {
            const jwtPayload = JSON.parse(atob(token.split(".")[1])) as { org_id?: string; tenant_slug?: string };
            if (jwtPayload.org_id) {
              const fallbackOrg: Org = { id: jwtPayload.org_id, name: jwtPayload.tenant_slug || "Current Organization", slug: jwtPayload.tenant_slug || "current-org", role: "user" };
              setOrgs([fallbackOrg]);
              setCur(fallbackOrg);
            }
          }
        }

        const freshToken = localStorage.getItem("accessToken");
        if (freshToken) {
          try {
            if (!PERMISSION_MODULE_ENABLED) {
              sessionStorage.removeItem("userModules");
              sessionStorage.setItem("userModulesUnrestricted", "1");
              setModulesResolved(true);
            } else {
              const jwtParsed = JSON.parse(atob(freshToken.split(".")[1])) as { org_id?: string };
              const freshPrimaryRole = extractPrimaryRoleFromToken(freshToken)?.toLowerCase().replace(/-/g, "_");
              const isSA = isSuperAdminUserType(userData.user_type) || freshPrimaryRole === "super_admin";
              const isOA = freshPrimaryRole === "tenant_admin";
              if (isSA || isOA) {
                sessionStorage.removeItem("userModules");
                sessionStorage.setItem("userModulesUnrestricted", "1");
                setModulesResolved(true);
              } else if (jwtParsed.org_id) {
                const cached = sessionStorage.getItem("userModules");
                if (cached) {
                  try { const modules = JSON.parse(cached) as string[]; setUserModules(Array.isArray(modules) ? modules : []); }
                  catch { setUserModules([]); }
                } else { setUserModules([]); }
                sessionStorage.removeItem("userModulesUnrestricted");
                setModulesResolved(true);
              } else {
                setUserModules([]);
                setModulesResolved(true);
              }
            }
          } catch { setUserModules([]); setModulesResolved(true); }
        } else { setModulesResolved(true); }
      } catch { router.push("/auth/signin"); }
      finally { setLoading(false); }
    })();
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => { setMobileSidebarOpen(false); setOpen(false); }, 0);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  useEffect(() => {
    if (!mobileSidebarOpen) return;
    const orig = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = orig; };
  }, [mobileSidebarOpen]);

  const switchOrg = async (org: Org) => {
    if (org.id === cur?.id) { setOpen(false); return; }
    setSwitching(true);
    try {
      const res = await apiFetch<{ data: { access_token: string; refresh_token: string; organization: { role: string } } }>("/organizations/switch", {
        method: "POST",
        body: JSON.stringify({ organization_id: org.id }),
      });
      if (res.success) {
        localStorage.setItem("accessToken", res.data.data.access_token);
        localStorage.setItem("refreshToken", res.data.data.refresh_token);
        sessionStorage.removeItem("userModules");
        sessionStorage.removeItem("userModulesUnrestricted");
        setCur({ ...org, role: res.data.data.organization.role });
        window.location.reload();
      }
    } finally { setSwitching(false); setOpen(false); }
  };

  const resetOrgContext = async () => {
    if (!isSuperAdmin) return;
    setSwitching(true);
    try {
      const res = await apiFetch<{ data: { access_token: string; refresh_token: string } }>("/organizations/reset", { method: "POST" });
      if (res.success) {
        localStorage.setItem("accessToken", res.data.data.access_token);
        localStorage.setItem("refreshToken", res.data.data.refresh_token);
        sessionStorage.removeItem("userModules");
        sessionStorage.removeItem("userModulesUnrestricted");
        setCur(null);
        window.location.reload();
      }
    } finally { setSwitching(false); setOpen(false); }
  };

  const signOut = () => {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    sessionStorage.removeItem("userModules");
    sessionStorage.removeItem("userModulesUnrestricted");
    router.push("/auth/signin");
  };

  const curIdx = orgs.findIndex((o) => o.id === cur?.id);

  const jwtRoles: string[] = (() => {
    try { const token = localStorage.getItem("accessToken"); if (!token) return []; return extractRolesFromToken(token); } catch { return []; }
  })();
  const normalizedJwtRoles = jwtRoles.map((r) => r.toLowerCase().replace(/-/g, "_"));
  const primaryJwtRole = (() => {
    try { const token = localStorage.getItem("accessToken"); if (!token) return null; return extractPrimaryRoleFromToken(token)?.toLowerCase().replace(/-/g, "_") ?? null; } catch { return null; }
  })();
  const isSuperAdmin = isSuperAdminUserType(user?.user_type) || isSuperAdminUserType(user?.role) || primaryJwtRole === "super_admin" || normalizedJwtRoles.includes("super_admin");
  const isOrgAdmin = primaryJwtRole === "tenant_admin" || isSuperAdmin;

  const hasModule = (moduleId: string) => {
    if (!PERMISSION_MODULE_ENABLED) return true;
    if (isSuperAdmin || isOrgAdmin) return true;
    if (!modulesResolved) return false;
    return userModules?.includes(moduleId) ?? false;
  };

  const getBreadcrumb = () => {
    if (pathname === "/dashboard") return { section: "Dashboard", page: "Overview" };
    if (pathname === "/documents") return { section: "Knowledge Base", page: "Documents" };
    if (pathname === "/web-urls") return { section: "Knowledge Base", page: "Web URLs" };
    if (pathname === "/ai_assistant") return { section: "Home", page: "AI Assistant" };
    if (pathname === "/cost_segregation") return { section: "Tools", page: "Cost Segregation" };
    if (pathname.startsWith("/cost_segregation/")) return { section: "Cost Segregation", page: "Study Wizard" };
    if (pathname === "/users") return { section: "User Management", page: "Users" };
    if (pathname === "/users/create") return { section: "User Management", page: "Create User" };
    if (pathname.startsWith("/users/")) return { section: "User Management", page: "Edit User" };
    if (pathname === "/profile") return { section: "Account", page: "My Profile" };
    if (pathname === "/roles") return { section: "User Management", page: "Roles" };
    if (pathname === "/roles/create") return { section: "User Management", page: "Create Role" };
    if (pathname.startsWith("/roles/") && pathname.endsWith("/permissions")) return { section: "User Management", page: "Role Permissions" };
    if (pathname.startsWith("/roles/")) return { section: "User Management", page: "Edit Role" };
    if (pathname === "/admin/super-admins") return { section: "Administration", page: "Super Admins" };
    if (pathname === "/admin/super-admins/create") return { section: "Administration", page: "Create Super Admin" };
    if (pathname.startsWith("/admin/super-admins/")) return { section: "Administration", page: "Edit Super Admin" };
    if (pathname === "/admin/org-admins") return { section: "Administration", page: "Org Admins" };
    if (pathname === "/admin/org-admins/create") return { section: "Administration", page: "Create Org Admin" };
    if (pathname.startsWith("/admin/org-admins/")) return { section: "Administration", page: "Edit Org Admin" };
    if (pathname === "/admin/organizations") return { section: "Administration", page: "Organizations" };
    if (pathname === "/admin/organizations/create") return { section: "Administration", page: "Create Organization" };
    if (pathname.startsWith("/admin/organizations/")) return { section: "Administration", page: "Edit Organization" };
    if (pathname === "/admin/org-permissions") return { section: "Administration", page: "Org Permissions" };
    if (pathname.startsWith("/admin/org-permissions/")) return { section: "Administration", page: "Manage Org Permissions" };
    if (pathname === "/api-modules") return { section: "Tools", page: "API Modules" };
    return { section: "Dashboard", page: "Overview" };
  };

  const breadcrumb = getBreadcrumb();

  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#faf9f7]">
        <div className="w-7 h-7 border-[2.5px] border-[#e5e5e5] border-t-[#1a1a1a] rounded-full animate-spin" />
      </div>
    );

  return (
    <>
      {switching && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl px-6 py-4 flex items-center gap-3 shadow-xl">
            <div className="w-5 h-5 border-2 border-[#e5e5e5] border-t-[#1a1a1a] rounded-full animate-spin" />
            <span className="text-sm font-medium text-[#1a1a1a]">Switching organization…</span>
          </div>
        </div>
      )}

      {mobileSidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={() => setMobileSidebarOpen(false)} />
      )}

      <div className="layout flex h-screen overflow-hidden bg-white">
        {/* Sidebar */}
        <aside className={`fixed inset-y-0 left-0 z-40 w-[230px] flex flex-col bg-[#faf9f7] border-r border-[#ebe9e6] transition-transform duration-200 ease-in-out lg:static lg:translate-x-0 lg:z-auto ${mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
          {/* Brand */}
          <div className="flex items-start justify-between px-5 pt-5 pb-3 border-b border-[#ebe9e6] shrink-0">
            <div>
              <div className="text-[15px] font-bold text-[#1a1a1a] leading-tight">Platform</div>
              <div className="text-[11px] text-[#9a9a9a] mt-0.5">Multi-tenant SaaS</div>
            </div>
            <button className="lg:hidden text-2xl leading-none text-[#9a9a9a] hover:text-[#1a1a1a] mt-0.5" onClick={() => setMobileSidebarOpen(false)} aria-label="Close sidebar">×</button>
          </div>

          {/* Nav */}
          <div className="flex-1 py-4 px-3 space-y-6 overflow-y-auto">
            {isSuperAdmin && (
              <div>
                <div className="px-2 mb-1.5 text-[10px] font-semibold text-[#b0aaa0] uppercase tracking-wider">Administration</div>
                <NavItem href="/admin/super-admins" active={pathname.startsWith("/admin/super-admins")} icon={<svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M12 14c-6 0-8 2-8 4v1h16v-1c0-2-2-4-8-4z"/><path d="M18.5 2.5l.5 2 2 .5-2 .5-.5 2-.5-2-2-.5 2-.5z"/></svg>}>Super Admins</NavItem>
                <NavItem href="/admin/org-admins" active={pathname.startsWith("/admin/org-admins")} icon={<svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>}>Org Admins</NavItem>
                <NavItem href="/admin/organizations" active={pathname.startsWith("/admin/organizations")} icon={<svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>}>Organizations</NavItem>
                <NavItem href="/admin/org-permissions" active={pathname.startsWith("/admin/org-permissions")} icon={<svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>}>Permissions</NavItem>

              </div>
            )}

            {isOrgAdmin && (
              <div>
                <div className="px-2 mb-1.5 text-[10px] font-semibold text-[#b0aaa0] uppercase tracking-wider">User Management</div>
                <NavItem href="/users" active={pathname === "/users" || pathname.startsWith("/users/")} icon={<svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>}>Users</NavItem>
                <NavItem href="/roles" active={pathname === "/roles" || pathname.startsWith("/roles/")} icon={<svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>}>Roles</NavItem>
              </div>
            )}

            <div>
              <div className="px-2 mb-1.5 text-[10px] font-semibold text-[#b0aaa0] uppercase tracking-wider">Home</div>
              <NavItem href="/dashboard" active={pathname === "/dashboard"} icon={<svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>}>Dashboard</NavItem>
              {hasModule("ai_assistant") && (
                <Link href="/ai_assistant" className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors w-full ${pathname === "/ai_assistant" ? "bg-gradient-to-r from-violet-50 to-blue-50 text-violet-700 shadow-sm" : "text-[#606060] hover:bg-white hover:text-[#1a1a1a]"}`}>
                  <span className="w-4 h-4 shrink-0 flex items-center justify-center">
                    <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/><circle cx="18" cy="5" r="3"/></svg>
                  </span>
                  <span className={pathname === "/ai_assistant" ? "bg-gradient-to-r from-violet-600 to-blue-600 bg-clip-text text-transparent font-semibold" : ""}>AI Assistant</span>
                </Link>
              )}
              {hasModule("cost_seg") && (
                <Link href="/cost_segregation" className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors w-full ${pathname.startsWith("/cost_segregation") ? "bg-gradient-to-r from-emerald-50 to-teal-50 text-emerald-700 shadow-sm" : "text-[#606060] hover:bg-white hover:text-[#1a1a1a]"}`}>
                  <span className="w-4 h-4 shrink-0 flex items-center justify-center">
                    <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
                  </span>
                  <span className={pathname.startsWith("/cost_segregation") ? "bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent font-semibold" : ""}>Cost Segregation</span>
                </Link>
              )}
              <NavItem href="/profile" active={pathname === "/profile"} icon={<svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>}>My Profile</NavItem>
            </div>

            {(hasModule("documents") || hasModule("web_urls")) && (
              <div>
                <div className="px-2 mb-1.5 text-[10px] font-semibold text-[#b0aaa0] uppercase tracking-wider">Knowledge Base</div>
                {hasModule("documents") && (
                  <NavItem href="/documents" active={pathname === "/documents"} icon={<svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>}>Documents</NavItem>
                )}
                {hasModule("web_urls") && (
                  <NavItem href="/web-urls" active={pathname === "/web-urls"} icon={<svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>}>Web URLs</NavItem>
                )}
              </div>
            )}

            {isOrgAdmin && (
              <div>
                <div className="px-2 mb-1.5 text-[10px] font-semibold text-[#b0aaa0] uppercase tracking-wider">Tools</div>
                <NavItem
                  href="/api-modules"
                  active={pathname === "/api-modules"}
                  icon={
                    <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M13 10V3L4 14h7v7l9-11h-7z"/>
                    </svg>
                  }
                >
                  API Modules
                </NavItem>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-3 border-t border-[#ebe9e6] shrink-0">
            <div
              className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-[#ece9e5] cursor-pointer transition-colors"
              onClick={() => router.push("/profile")}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter") router.push("/profile"); }}
            >
              <div className="w-8 h-8 rounded-full bg-[#1a1a1a] text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                {initials(user?.full_name, user?.email)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-[#1a1a1a] truncate">{user?.full_name || "User"}</div>
                <div className="text-[11px] text-[#9a9a9a] truncate">{user?.email}</div>
              </div>
              <button
                className="p-1 text-[#9a9a9a] hover:text-[#1a1a1a] transition-colors shrink-0"
                onClick={(e) => { e.stopPropagation(); signOut(); }}
                aria-label="Sign out"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
                </svg>
              </button>
            </div>
          </div>
        </aside>

        {/* Main */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Topbar */}
          <div className="flex items-center justify-between h-14 px-5 border-b border-[#ebe9e6] bg-white shrink-0">
            {/* Breadcrumb */}
            <div className="flex items-center gap-2 text-[13px]">
              <button className="lg:hidden mr-1 p-1 text-[#9a9a9a] hover:text-[#1a1a1a] transition-colors" onClick={() => setMobileSidebarOpen(true)} aria-label="Open sidebar">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
                </svg>
              </button>
              <span className="text-[#9a9a9a]">{breadcrumb.section}</span>
              <svg className="w-4 h-4 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
              <span className="text-[#1a1a1a] font-medium">{breadcrumb.page}</span>
            </div>

            {/* Org switcher */}
            <div className="relative" ref={dropRef}>
              <button
                className="flex items-center gap-2 px-3 h-8 rounded-lg border border-[#ebe9e6] bg-white text-[13px] font-medium hover:bg-[#faf9f7] transition-colors"
                onClick={() => setOpen(!open)}
              >
                <div
                  className="w-5 h-5 rounded flex items-center justify-center text-white text-[9px] font-bold shrink-0"
                  style={{ background: DOT_COLORS[curIdx >= 0 ? curIdx % DOT_COLORS.length : 0] }}
                >
                  {cur?.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2) || "ORG"}
                </div>
                <span className="max-w-[120px] truncate">{cur?.name || "Select org"}</span>
                <svg className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
              </button>

              {open && (
                <div className="absolute right-0 top-full mt-1.5 w-56 bg-white border border-[#ebe9e6] rounded-xl shadow-lg z-50 py-1 overflow-hidden">
                  {isSuperAdmin && (
                    <div className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-[#faf9f7] cursor-pointer border-b border-[#f0eeeb]" onClick={resetOrgContext}>
                      <div className="w-6 h-6 rounded flex items-center justify-center text-white text-[9px] font-bold bg-[#6b7280] shrink-0">SA</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-[#1a1a1a]">Reset Org Context</div>
                        <div className="text-[11px] text-[#9a9a9a]">Show all organizations</div>
                      </div>
                    </div>
                  )}
                  {orgs.map((org, idx) => (
                    <div key={org.id} className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-[#faf9f7] cursor-pointer" onClick={() => switchOrg(org)}>
                      <div className="w-6 h-6 rounded flex items-center justify-center text-white text-[9px] font-bold shrink-0" style={{ background: DOT_COLORS[idx % DOT_COLORS.length] }}>
                        {org.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-[#1a1a1a] truncate">{org.name}</div>
                        <div className="text-[11px] text-[#9a9a9a]">{org.role}</div>
                      </div>
                      {org.id === cur?.id && (
                        <svg className="w-4 h-4 text-[#1a1a1a] shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-h-0 flex flex-col overflow-y-auto bg-[#f9f9f8] content-wrapper">{children}</div>
        </div>
      </div>
    </>
  );
}
