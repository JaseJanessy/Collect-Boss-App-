"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PrimaryButton } from "@/components/ui/primary-button";
import { AuthShell, AuthCard, AuthField, AuthError } from "./auth-shell";
import { updatePassword } from "@/lib/auth/session";
import { Lock, Loader2, CheckCircle2 } from "lucide-react";

export function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword]   = useState("");
  const [confirm, setConfirm]     = useState("");
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState("");
  const [done, setDone]           = useState(false);

  const [passErr, setPassErr]     = useState("");
  const [confirmErr, setConfirmErr] = useState("");

  function validate(): boolean {
    setPassErr(""); setConfirmErr("");
    let ok = true;
    if (!password) {
      setPassErr("Password is required."); ok = false;
    } else if (password.length < 8) {
      setPassErr("Password must be at least 8 characters."); ok = false;
    }
    if (password !== confirm) {
      setConfirmErr("Passwords do not match."); ok = false;
    }
    return ok;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    setError("");

    const result = await updatePassword(password);

    if (!result.success) {
      setError(result.error ?? "Failed to update password.");
      setLoading(false);
      return;
    }

    setDone(true);
    setLoading(false);
    setTimeout(() => router.push("/login"), 3000);
  }

  if (done) {
    return (
      <AuthShell>
        <div className="flex flex-col items-center text-center py-12">
          <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mb-4">
            <CheckCircle2 className="w-8 h-8 text-[#009966]" />
          </div>
          <h2 className="text-xl font-black text-[#0D1B3D]">Password Updated!</h2>
          <p className="text-sm text-gray-500 mt-2">
            Redirecting you to sign in…
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="mb-6">
        <h1 className="text-2xl font-black text-[#0D1B3D]">Set New Password</h1>
        <p className="text-sm text-gray-500 mt-1 leading-relaxed">
          Choose a strong password for your CollectBoss account.
        </p>
      </div>

      <AuthCard>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && <AuthError message={error} />}

          <AuthField
            label="New Password"
            type="password"
            placeholder="At least 8 characters"
            value={password}
            onChange={setPassword}
            error={passErr}
            icon={<Lock className="w-4 h-4" />}
            autoComplete="new-password"
            hint="Minimum 8 characters"
          />

          <AuthField
            label="Confirm New Password"
            type="password"
            placeholder="Re-enter your new password"
            value={confirm}
            onChange={setConfirm}
            error={confirmErr}
            icon={<Lock className="w-4 h-4" />}
            autoComplete="new-password"
          />

          <PrimaryButton
            type="submit"
            fullWidth
            size="lg"
            disabled={loading}
            icon={loading ? <Loader2 className="w-4 h-4 animate-spin" /> : undefined}
          >
            {loading ? "Updating…" : "Update Password"}
          </PrimaryButton>
        </form>
      </AuthCard>

      <p className="text-sm text-center text-gray-500 mt-5">
        <Link href="/login" className="text-[#009966] font-semibold hover:underline">
          ← Back to Sign In
        </Link>
      </p>
    </AuthShell>
  );
}
