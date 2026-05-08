"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "../../../src/lib/api";
import "../signin/auth-signin.css";

type ForgotPasswordResponse = {
  message?: string;
  debug?: { resetCode?: string };
};

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [devResetCode, setDevResetCode] = useState("");

  const handleSendCode = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccessMessage("");

    try {
      const response = await apiFetch<ForgotPasswordResponse>("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });

      if (!response.success) throw new Error(response.error);

      const normalizedEmail = email.trim().toLowerCase();
      const maybeCode = response.data?.debug?.resetCode;

      setSuccessMessage(
        response.data?.message ||
          "If the email exists, a password reset code has been sent.",
      );
      setDevResetCode(maybeCode || "");

      const query = new URLSearchParams({ email: normalizedEmail });
      if (maybeCode) query.set("devCode", maybeCode);
      router.push(`/auth/forgot-password/otp?${query.toString()}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <div className="wrap">
        <div className="heading">
          <h1>Reset your password</h1>
          <p>Enter your email to receive a reset code</p>
        </div>

        {error && <div className="err">{error}</div>}
        {successMessage && (
          <div
            style={{
              background: "#f0fdf4",
              border: "1px solid #86efac",
              color: "#166534",
              padding: "10px 13px",
              borderRadius: "8px",
              fontSize: "13px",
              marginBottom: "16px",
            }}
          >
            {successMessage}
          </div>
        )}
        {devResetCode && (
          <div
            style={{
              background: "#fffbeb",
              border: "1px solid #fde68a",
              color: "#92400e",
              padding: "10px 13px",
              borderRadius: "8px",
              fontSize: "13px",
              marginBottom: "16px",
            }}
          >
            Dev reset code: <strong>{devResetCode}</strong>
          </div>
        )}

        <form onSubmit={handleSendCode}>
          <div className="field">
            <label className="field-lbl">Email</label>
            <input
              className="fi"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <button className="sbtn" type="submit" disabled={loading}>
            {loading && <span className="spin" />}
            {loading ? "Sending code..." : "Continue"}
          </button>
        </form>

        <p className="foot">
          Remembered your password? <Link href="/auth/signin">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
