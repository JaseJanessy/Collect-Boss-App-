"use client";

import { useState } from "react";
import Link from "next/link";
import { PrimaryButton } from "@/components/ui/primary-button";
import { AuthShell, AuthCard, AuthField, AuthError } from "./auth-shell";
import { requestPasswordReset } from "@/lib/auth/session";
import { Mail, Loader2, ArrowRight } from "lucide-react";

export function ForgotPasswordPage() {
  const [email, setEmail]     = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [sent, setSent]       = useState(false);
  const [emailErr, setEmailErr] = useState("");

  function validate(): boolean {
    setEmailErr("");
    if (!email.trim()) {
      setEmailErr("Email address is required.");
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailErr("Please enter a valid email address.");
      return false;
    }
    return true;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    setError("");

    const result = await requestPasswordReset(email.trim());

    if (!result.success) {
      setError(result.error ?? "Failed to send reset email. Please try again.");
      setLoading(false);
      return;
    }

    setSent(true);
    setLoading(false);
  }

  return (
    <AuthShell>
      <div className="mb-6">
        <Link
          href="/login"
          className="text-xs font-semibold text-gray-400 hover:text-gray-600 mb-4 inline-block"
        >
          ← Back to Sign In
        </Link>
        <h1 className="text-2xl font-black text-[#0D1B3D]">Reset Password</h1>
        <p className="text-sm text-gray-500 mt-1 leading-relaxed">
          Enter your registered email and we&apos;ll send you a password reset link.
        </p>
      </div>

      <AuthCard>
        {sent ? (
          <div className="flex flex-col items-center text-center py-4 gap-4">
            <div className="w-14 h-14 bg-emerald-50 rounded-full flex items-center justify-center">
              <Mail className="w-7 h-7 text-[#009966]" />
            </div>
            <div>
              <p className="text-base font-black text-[#0D1B3D]">Reset Email Sent</p>
              <p className="text-sm text-gray-500 mt-1 leading-relaxed">
                We sent a reset link to <strong>{email}</strong>.
                Check your inbox and follow the link to set a new password.
              </p>
            </div>
            <p className="text-xs text-gray-400">
              Didn&apos;t receive it? Check your spam folder, or{" "}
              <button
                onClick={() => setSent(false)}
                className="text-[#009966] font-semibold hover:underline"
              >
                try again
              </button>
              .
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {error && <AuthError message={error} />}

            <AuthField
              label="Email Address"
              type="email"
              placeholder="you@company.com.my"
              value={email}
              onChange={setEmail}
              error={emailErr}
              icon={<Mail className="w-4 h-4" />}
              autoComplete="email"
            />

            <PrimaryButton
              type="submit"
              fullWidth
              size="lg"
              disabled={loading}
              icon={
                loading
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <ArrowRight className="w-4 h-4" />
              }
            >
              {loading ? "Sending…" : "Send Reset Link"}
            </PrimaryButton>
          </form>
        )}
      </AuthCard>
    </AuthShell>
  );
}
