"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Layout from "../../../../components/Layout";
import { apiFetch } from "../../../../src/lib/api";
import './roles-id-edit.css';

// Edit: name + description only (see create page)

interface Role {
  id: string;
  name: string;
  description?: string | null;
  is_system: boolean;
}

export default function EditRolePage() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [orgId, setOrgId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetchingData, setFetchingData] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("accessToken");
    if (!token) {
      router.push("/auth/signin");
      return;
    }
    (async () => {
      try {
        const meRes = await apiFetch<{ data: { user_type: string } }>(
          "/auth/me",
        );
        if (!meRes.success || meRes.data.data.user_type === "user") {
          router.push("/dashboard");
          return;
        }
        const payload = JSON.parse(atob(token.split(".")[1]));
        const oid = payload.org_id;
        if (!oid) {
          setError("No org context");
          setFetchingData(false);
          return;
        }
        setOrgId(oid);

        const rolesRes = await apiFetch<{ data: Role[] }>(
          `/organizations/${oid}/roles`,
        );

        if (rolesRes.success) {
          const role = rolesRes.data.data.find((r) => r.id === id);
          if (role) {
            setName(role.name);
            setDescription(role.description || "");
          } else {
            setError("Role not found");
          }
        }
      } catch {
        setError("Failed to load data");
      } finally {
        setFetchingData(false);
      }
    })();
  }, [router, id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const res = await apiFetch(`/organizations/${orgId}/roles/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          name,
          description,
        }),
      });
      if (res.success) setSuccess("Role updated successfully");
      else setError(res.error || "Update failed");
    } catch {
      setError("Update failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
<div className="page">
        <button className="back-link" onClick={() => router.push("/roles")}>
          <svg
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            viewBox="0 0 24 24"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to Roles
        </button>
        <div className="page-title">Edit Role</div>
        <div className="page-subtitle">Update name and description</div>

        {error && <div className="err-bar">{error}</div>}
        {success && <div className="ok-bar">{success}</div>}

        {fetchingData ? (
          <div style={{ color: "#9a9a9a", fontSize: "13.5px" }}>Loading…</div>
        ) : (
          <div className="form-card">
            <form onSubmit={handleSubmit}>
              <div className="field">
                <label>Role name</label>
                <input
                  className="fi"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label>
                  Description{" "}
                  <span style={{ color: "#bbb", fontWeight: 400 }}>
                    (optional)
                  </span>
                </label>
                <input
                  className="fi"
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div className="form-actions">
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => router.push("/roles")}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={loading}
                >
                  {loading && <span className="spin" />}
                  {loading ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </Layout>
  );
}