"use client";

import { FormEvent, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../../src/lib/api";
import "../signin/auth-signin.css";

export default function SetPasswordPage() {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // If no token in storage, redirect to sign in
    if (!localStorage.getItem("accessToken")) {
      router.push("/auth/signin");
    }
  }, [router]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const res = await apiFetch<{ message?: string }>("/auth/set-password", {
        method: "POST",
        body: JSON.stringify({ newPassword }),
      });

      if (res.success) {
        // Token is now invalidated — clear storage and send to sign in
        localStorage.removeItem("accessToken");
        localStorage.removeItem("refreshToken");
        router.push(
          "/auth/signin?message=Password+set+successfully.+Please+sign+in."
        );
      } else {
        setError(res.error || "Failed to set password");
      }
    } catch {
      setError("Failed to set password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <svg width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>
        <h1 className="auth-title">Set Your Password</h1>
        <p className="auth-subtitle">
          Choose a new password for your account. You will be signed in after setting it.
        </p>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-field">
            <label className="auth-label">New password</label>
            <input
              className="auth-input"
              type="password"
              placeholder="Minimum 8 characters"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={8}
              required
              autoFocus
            />
          </div>
          <div className="auth-field">
            <label className="auth-label">Confirm new password</label>
            <input
              className="auth-input"
              type="password"
              placeholder="Re-enter your new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>
          <button
            className="auth-btn"
            type="submit"
            disabled={loading}
          >
            {loading ? "Setting password…" : "Set Password"}
          </button>
        </form>
      </div>
    </div>
  );
}
