"use client";

import { FormEvent, Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import "../../signin/auth-signin.css";

function OtpPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const email = useMemo(
    () => (searchParams.get("email") || "").trim().toLowerCase(),
    [searchParams],
  );
  const devCode = useMemo(() => searchParams.get("devCode") || "", [searchParams]);

  const handleContinue = (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email) {
      setError("Missing email. Please start again.");
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      setError("Enter a valid 6-digit code.");
      return;
    }

    const query = new URLSearchParams({ email, code });
    router.push(`/auth/forgot-password/new-password?${query.toString()}`);
  };

  return (
    <div className="page">
      <div className="wrap">
        <div className="heading">
          <h1>Verify OTP</h1>
          <p>Enter the 6-digit code sent to your email</p>
        </div>

        {error && <div className="err">{error}</div>}
        {devCode && (
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
            Dev reset code: <strong>{devCode}</strong>
          </div>
        )}

        <form onSubmit={handleContinue}>
          <div className="field">
            <label className="field-lbl">Email</label>
            <input className="fi" type="email" value={email} readOnly />
          </div>

          <div className="field">
            <label className="field-lbl">OTP</label>
            <input
              className="fi"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              placeholder="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={6}
              required
            />
          </div>

          <button className="sbtn" type="submit">
            Continue
          </button>
        </form>

        <p className="foot">
          <Link href="/auth/forgot-password">Back to email</Link>
        </p>
      </div>
    </div>
  );
}

export default function OtpPage() {
  return (
    <Suspense fallback={null}>
      <OtpPageContent />
    </Suspense>
  );
}
