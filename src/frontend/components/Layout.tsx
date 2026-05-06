"use client";

import { useState, useEffect, useRef, ReactNode } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { apiFetch } from "../src/lib/api";
import { PERMISSION_MODULE_ENABLED } from "../src/lib/permissions";
import "./layout.css";

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
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  return (email ?? "U").slice(0, 2).toUpperCase();
}

interface LayoutProps {
  children: ReactNode;
}

function isSuperAdminUserType(userType?: string) {
  if (!userType) return false;
  const normalized = userType.toLowerCase().replace(/-/g, "_");
  return normalized === "super_admin" || normalized === "superadmin";
}

function hasOrgAdminRole(roles: string[]) {
  const normalized = roles.map((r) => r.toLowerCase().replace(/-/g, "_"));
  return (
    normalized.includes("org_admin") ||
    normalized.includes("tenant_admin") ||
    normalized.includes("admin")
  );
}

function extractRolesFromToken(token: string): string[] {
  try {
    const payload = JSON.parse(atob(token.split(".")[1])) as {
      role?: string;
      roles?: string[];
    };
    const merged = [
      ...(Array.isArray(payload.roles) ? payload.roles : []),
      ...(payload.role ? [payload.role] : []),
    ];
    return Array.from(new Set(merged));
  } catch {
    return [];
  }
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
  // null = no restriction (super_admin / org_admin), string[] = allowed module IDs for regular users
  const [userModules, setUserModules] = useState<string[] | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  useEffect(() => {
    (async () => {
      const token = localStorage.getItem("accessToken");
      if (!token) {
        router.push("/auth/signin");
        return;
      }
      try {
        const uRes = await apiFetch<{ data: User }>("/auth/me");
        if (!uRes.success) throw new Error("Unauthorized");
        const userData = uRes.data.data;
        setUser(userData);

        const loginTokenRoles = token ? extractRolesFromToken(token) : [];
        const isSuperFromToken = loginTokenRoles
          .map((r) => r.toLowerCase().replace(/-/g, "_"))
          .includes("super_admin");

        if (isSuperAdminUserType(userData.user_type) || isSuperFromToken) {
          // Super admins see all organizations
          const oRes = await apiFetch<{
            data: { id: string; name: string; slug: string }[];
          }>("/admin/organizations");
          if (oRes.success) {
            const allOrgs = oRes.data.data.map((o) => ({
              ...o,
              role: "super_admin",
            }));
            setOrgs(allOrgs);
            // Set current org from JWT if one is already selected
            const jwtPayload = JSON.parse(atob(token.split(".")[1]));
            const currentOrgId = jwtPayload.org_id;
            if (currentOrgId) {
              const cur = allOrgs.find((o) => o.id === currentOrgId);
              if (cur) setCur(cur);
            }
          }
        } else {
          // Regular users see their own orgs
          const oRes = await apiFetch<{ data: Org[] }>("/organizations");
          if (oRes.success && oRes.data.data.length > 0) {
            setOrgs(oRes.data.data);
            // Set current org from JWT if one is already selected
            const jwtPayload = JSON.parse(atob(token.split(".")[1]));
            const currentOrgId = jwtPayload.org_id;
            const cur = oRes.data.data.find((o) => o.id === currentOrgId);

            if (cur) {
              setCur(cur);
            } else {
              // Keep UI + token context in sync: when token has no org_id,
              // automatically switch to the first available org.
              const fallbackOrg = oRes.data.data[0];
              const switchRes = await apiFetch<{
                data: {
                  access_token: string;
                  refresh_token: string;
                  organization: { role: string };
                };
              }>("/organizations/switch", {
                method: "POST",
                body: JSON.stringify({ organization_id: fallbackOrg.id }),
              });

              if (switchRes.success) {
                localStorage.setItem(
                  "accessToken",
                  switchRes.data.data.access_token,
                );
                localStorage.setItem(
                  "refreshToken",
                  switchRes.data.data.refresh_token,
                );
                setCur({
                  ...fallbackOrg,
                  role: switchRes.data.data.organization.role,
                });
                window.location.reload();
                return;
              }

              // Fallback visual selection if token switch fails for any reason.
              setCur(fallbackOrg);
            }
          }
        }
        // Module sidebar + page guards (see PERMISSION_MODULE_ENABLED in src/lib/permissions.ts)
        const freshToken = localStorage.getItem("accessToken");
        if (freshToken) {
          try {
            if (!PERMISSION_MODULE_ENABLED) {
              sessionStorage.removeItem("userModules");
              sessionStorage.setItem("userModulesUnrestricted", "1");
            } else {
              const jwtParsed = JSON.parse(atob(freshToken.split(".")[1])) as {
                org_id?: string;
              };
              const freshRoles = extractRolesFromToken(freshToken);
              const freshOrgId: string | undefined = jwtParsed.org_id;
              const isSA =
                isSuperAdminUserType(userData.user_type) ||
                freshRoles
                  .map((r) => r.toLowerCase().replace(/-/g, "_"))
                  .includes("super_admin");
              const isOA = hasOrgAdminRole(freshRoles);

              if (isSA || isOA) {
                sessionStorage.removeItem("userModules");
                sessionStorage.setItem("userModulesUnrestricted", "1");
              } else if (freshOrgId) {
                const mpRes = await apiFetch<{
                  data: { modules: string[] };
                }>(`/organizations/${freshOrgId}/my-permissions`);
                if (mpRes.success) {
                  const modules = mpRes.data.data.modules;
                  setUserModules(modules);
                  sessionStorage.setItem("userModules", JSON.stringify(modules));
                  sessionStorage.removeItem("userModulesUnrestricted");
                }
              }
            }
          } catch {
            // ignore — sidebar defaults to showing everything if fetch fails
          }
        }
      } catch {
        router.push("/auth/signin");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setMobileSidebarOpen(false);
      setOpen(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  useEffect(() => {
    if (!mobileSidebarOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [mobileSidebarOpen]);

  const switchOrg = async (org: Org) => {
    if (org.id === cur?.id) {
      setOpen(false);
      return;
    }
    setSwitching(true);
    try {
      const res = await apiFetch<{
        data: {
          access_token: string;
          refresh_token: string;
          organization: { role: string };
        };
      }>("/organizations/switch", {
        method: "POST",
        body: JSON.stringify({ organization_id: org.id }),
      });
      if (res.success) {
        localStorage.setItem("accessToken", res.data.data.access_token);
        localStorage.setItem("refreshToken", res.data.data.refresh_token);
        // Clear cached modules — they will be re-fetched on the next page load
        sessionStorage.removeItem("userModules");
        sessionStorage.removeItem("userModulesUnrestricted");
        setCur({ ...org, role: res.data.data.organization.role });
        window.location.reload();
      }
    } finally {
      setSwitching(false);
      setOpen(false);
    }
  };

  const resetOrgContext = async () => {
    if (!isSuperAdmin) return;
    setSwitching(true);
    try {
      const res = await apiFetch<{
        data: {
          access_token: string;
          refresh_token: string;
        };
      }>("/organizations/reset", {
        method: "POST",
      });
      if (res.success) {
        localStorage.setItem("accessToken", res.data.data.access_token);
        localStorage.setItem("refreshToken", res.data.data.refresh_token);
        sessionStorage.removeItem("userModules");
        sessionStorage.removeItem("userModulesUnrestricted");
        setCur(null);
        window.location.reload();
      }
    } finally {
      setSwitching(false);
      setOpen(false);
    }
  };

  const signOut = () => {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    router.push("/auth/signin");
  };

  const curIdx = orgs.findIndex((o) => o.id === cur?.id);

  // Read roles from current JWT claim (scoped to active org)
  const jwtRoles: string[] = (() => {
    try {
      const token = localStorage.getItem("accessToken");
      if (!token) return [];
      return extractRolesFromToken(token);
    } catch { return []; }
  })();
  const normalizedJwtRoles = jwtRoles.map((r) =>
    r.toLowerCase().replace(/-/g, "_"),
  );
  const isSuperAdmin =
    isSuperAdminUserType(user?.user_type) ||
    isSuperAdminUserType(user?.role) ||
    normalizedJwtRoles.includes("super_admin");
  const isOrgAdmin = hasOrgAdminRole(jwtRoles) || isSuperAdmin;

  // Returns true if the user has access to a given module.
  // null userModules means unrestricted (super_admin / org_admin).
  const hasModule = (moduleId: string) =>
    userModules === null || userModules.includes(moduleId);

  // Determine breadcrumb based on pathname
  const getBreadcrumb = () => {
    if (pathname === "/dashboard")
      return { section: "Dashboard", page: "Overview" };
    if (pathname === "/documents")
      return { section: "Knowledge Base", page: "Documents" };
    if (pathname === "/web-urls")
      return { section: "Knowledge Base", page: "Web URLs" };
    if (pathname === "/ai_assistant")
      return { section: "Home", page: "AI Assistant" };
    if (pathname === "/users")
      return { section: "User Management", page: "Users" };
    if (pathname === "/users/create")
      return { section: "User Management", page: "Create User" };
    if (pathname.startsWith("/users/"))
      return { section: "User Management", page: "Edit User" };
    if (pathname === "/profile")
      return { section: "Account", page: "My Profile" };
    if (pathname === "/roles")
      return { section: "User Management", page: "Roles" };
    if (pathname === "/roles/create")
      return { section: "User Management", page: "Create Role" };
    if (pathname.startsWith("/roles/") && pathname.endsWith("/permissions"))
      return { section: "User Management", page: "Role Permissions" };
    if (pathname.startsWith("/roles/"))
      return { section: "User Management", page: "Edit Role" };
    if (pathname === "/admin/super-admins")
      return { section: "Administration", page: "Super Admins" };
    if (pathname === "/admin/super-admins/create")
      return { section: "Administration", page: "Create Super Admin" };
    if (pathname.startsWith("/admin/super-admins/"))
      return { section: "Administration", page: "Edit Super Admin" };
    if (pathname === "/admin/org-admins")
      return { section: "Administration", page: "Org Admins" };
    if (pathname === "/admin/org-admins/create")
      return { section: "Administration", page: "Create Org Admin" };
    if (pathname.startsWith("/admin/org-admins/"))
      return { section: "Administration", page: "Edit Org Admin" };
    if (pathname === "/admin/organizations")
      return { section: "Administration", page: "Organizations" };
    if (pathname === "/admin/organizations/create")
      return { section: "Administration", page: "Create Organization" };
    if (pathname.startsWith("/admin/organizations/"))
      return { section: "Administration", page: "Edit Organization" };
    if (pathname === "/admin/org-permissions")
      return { section: "Administration", page: "Org Permissions" };
    if (pathname.startsWith("/admin/org-permissions/"))
      return { section: "Administration", page: "Manage Org Permissions" };
    return { section: "Dashboard", page: "Overview" };
  };

  const breadcrumb = getBreadcrumb();

  if (loading)
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#faf9f7",
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            border: "2.5px solid #e5e5e5",
            borderTopColor: "#1a1a1a",
            borderRadius: "50%",
            animation: "spin .65s linear infinite",
          }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );

  return (
    <>
      {switching && (
        <div className="overlay">
          <div className="overlay-card">
            <div className="mini-spin" />
            <span style={{ fontSize: "14px", fontWeight: 500 }}>
              Switching organization...
            </span>
          </div>
        </div>
      )}

      {mobileSidebarOpen && (
        <div
          className="mobile-sidebar-backdrop"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      <div className="layout">
        {/* Sidebar */}
        <aside className={`sidebar${mobileSidebarOpen ? " open" : ""}`}>
          <div className="sidebar-top">
            <div className="sidebar-top-row">
              <div className="brand">Platform</div>
              <button
                className="sidebar-close-btn"
                onClick={() => setMobileSidebarOpen(false)}
                aria-label="Close sidebar"
              >
                ×
              </button>
            </div>
            <div className="brand-sub">Multi-tenant SaaS</div>
          </div>

          <div className="sidebar-nav-scroll">
          {isSuperAdmin && (
            <div className="nav-section">
              <div className="nav-label">Administration</div>
              <Link
                href="/admin/super-admins"
                className={`nav-item${pathname.startsWith("/admin/super-admins") ? " active" : ""}`}
              >
                <svg
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <circle cx="12" cy="8" r="4" />
                  <path d="M12 14c-6 0-8 2-8 4v1h16v-1c0-2-2-4-8-4z" />
                  <path d="M18.5 2.5l.5 2 2 .5-2 .5-.5 2-.5-2-2-.5 2-.5z" />
                </svg>
                Super Admins
              </Link>
              <Link
                href="/admin/org-admins"
                className={`nav-item${pathname.startsWith("/admin/org-admins") ? " active" : ""}`}
              >
                <svg
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
                Org Admins
              </Link>
              <Link
                href="/admin/organizations"
                className={`nav-item${pathname.startsWith("/admin/organizations") ? " active" : ""}`}
              >
                <svg
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
                Organizations
              </Link>
              <Link
                href="/admin/org-permissions"
                className={`nav-item${pathname.startsWith("/admin/org-permissions") ? " active" : ""}`}
              >
                <svg
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                Permissions
              </Link>
            </div>
          )}

          {isOrgAdmin && (
            <div className="nav-section">
              <div className="nav-label">User Management</div>
              <Link
                href="/users"
                className={`nav-item${pathname === "/users" || pathname.startsWith("/users/") ? " active" : ""}`}
              >
                <svg
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
                </svg>
                Users
              </Link>
              <Link
                href="/roles"
                className={`nav-item${pathname === "/roles" || pathname.startsWith("/roles/") ? " active" : ""}`}
              >
                <svg
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                Roles
              </Link>
            </div>
          )}

          <div className="nav-section">
            <div className="nav-label">Home</div>
            <Link
              href="/dashboard"
              className={`nav-item${pathname === "/dashboard" ? " active" : ""}`}
            >
              <svg
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
              Dashboard
            </Link>
            {hasModule("ai_assistant") && (
              <Link
                href="/ai_assistant"
                className={`nav-item nav-ai${pathname === "/ai_assistant" ? " active" : ""}`}
              >
                <svg
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                  <circle cx="18" cy="5" r="3" />
                </svg>
                <span className="nav-ai-text">AI Assistant</span>
              </Link>
            )}
            <Link
              href="/profile"
              className={`nav-item${pathname === "/profile" ? " active" : ""}`}
            >
              <svg
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              My Profile
            </Link>
          </div>

          {(hasModule("documents") || hasModule("web_urls")) && (
          <div className="nav-section">
            <div className="nav-label">Knowledge Base</div>
            {hasModule("documents") && (
            <Link
              href="/documents"
              className={`nav-item${pathname === "/documents" ? " active" : ""}`}
            >
              <svg
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Documents
            </Link>
            )}
            {hasModule("web_urls") && (
            <Link
              href="/web-urls"
              className={`nav-item${pathname === "/web-urls" ? " active" : ""}`}
            >
              <svg
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              Web URLs
            </Link>
            )}
          </div>
          )}
          </div>

          <div className="sidebar-footer">
            <div
              className="user-profile"
              onClick={() => router.push("/profile")}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter") router.push("/profile");
              }}
            >
              <div className="avatar">
                {initials(user?.full_name, user?.email)}
              </div>
              <div className="user-info">
                <div className="user-name">{user?.full_name || "User"}</div>
                <div className="user-email">{user?.email}</div>
              </div>
              <button
                className="signout-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  signOut();
                }}
              >
                <svg
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
              </button>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <div className="main">
          {/* Topbar */}
          <div className="topbar">
            <div className="breadcrumb">
              <button
                className="mobile-menu-btn"
                onClick={() => setMobileSidebarOpen(true)}
                aria-label="Open sidebar"
              >
                <svg
                  width="18"
                  height="18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
              <span>{breadcrumb.section}</span>
              <svg
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span className="breadcrumb-active">{breadcrumb.page}</span>
            </div>

            <div className="ts-wrap" ref={dropRef}>
              <button className="ts-btn" onClick={() => setOpen(!open)}>
                <div
                  className="ts-dot"
                  style={{ background: DOT_COLORS[curIdx % DOT_COLORS.length] }}
                >
                  {cur?.name
                    .split(" ")
                    .map((w) => w[0])
                    .join("")
                    .toUpperCase()
                    .slice(0, 2) || "ORG"}
                </div>
                <span>{cur?.name || "Select org"}</span>
                <svg
                  width="12"
                  height="12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  viewBox="0 0 24 24"
                  style={{
                    transition: "transform 0.2s",
                    transform: open ? "rotate(180deg)" : "none",
                  }}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>

              {open && (
                <div className="ts-drop">
                  {isSuperAdmin && (
                    <div className="drop-item" onClick={resetOrgContext}>
                      <div
                        className="ts-dot"
                        style={{ background: "#6b7280" }}
                      >
                        SA
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: "13px", fontWeight: 500 }}>
                          Reset Organization Context
                        </div>
                        <div style={{ fontSize: "11px", color: "#9a9a9a" }}>
                          Show all organizations
                        </div>
                      </div>
                    </div>
                  )}
                  {orgs.map((org, idx) => (
                    <div
                      key={org.id}
                      className="drop-item"
                      onClick={() => switchOrg(org)}
                    >
                      <div
                        className="ts-dot"
                        style={{
                          background: DOT_COLORS[idx % DOT_COLORS.length],
                        }}
                      >
                        {org.name
                          .split(" ")
                          .map((w) => w[0])
                          .join("")
                          .toUpperCase()
                          .slice(0, 2)}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: "13px", fontWeight: 500 }}>
                          {org.name}
                        </div>
                        <div style={{ fontSize: "11px", color: "#9a9a9a" }}>
                          {org.role}
                        </div>
                      </div>
                      {org.id === cur?.id && (
                        <svg
                          width="16"
                          height="16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          viewBox="0 0 24 24"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Page Content */}
          <div className="content-wrapper">{children}</div>
        </div>
      </div>
    </>
  );
}
