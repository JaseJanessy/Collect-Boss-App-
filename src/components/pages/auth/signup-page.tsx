"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PrimaryButton } from "@/components/ui/primary-button";
import { AuthShell, AuthCard, AuthField, AuthError, AuthSuccess } from "./auth-shell";
import { signUp } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { track } from "@/lib/analytics/tracker";
import { Mail, Lock, User, ArrowRight, Loader2 } from "lucide-react";

export function SignupPage() {
  const router = useRouter();
  const [name, setName]             = useState("");
  const [email, setEmail]           = useState("");
  const [password, setPassword]     = useState("");
  const [confirm, setConfirm]       = useState("");
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");
  const [success, setSuccess]       = useState(false);

  const [nameErr, setNameErr]       = useState("");
  const [emailErr, setEmailErr]     = useState("");
  const [passErr, setPassErr]       = useState("");
  const [confirmErr, setConfirmErr] = useState("");

  function validate(): boolean {
    let ok = true;
    setNameErr(""); setEmailErr(""); setPassErr(""); setConfirmErr("");

    if (!name.trim()) {
      setNameErr("Your name is required."); ok = false;
    }
    if (!email.trim()) {
      setEmailErr("Email address is required."); ok = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailErr("Please enter a valid email address."); ok = false;
    }
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

    const result = await signUp(email, password, name);

    if (!result.success) {
      setError(result.error ?? "Registration failed. Please try again.");
      setLoading(false);
      return;
    }

    track("user_registered", { method: "email" });

    if (result.needsConfirmation && isSupabaseConfigured) {
      setSuccess(true);
      setLoading(false);
      return;
    }

    // Mock mode or email confirmed immediately → go to onboarding
    router.push("/onboarding/profile");
  }

  if (success) {
    return (
      <AuthShell>
        <div className="text-center py-8">
          <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <Mail className="w-8 h-8 text-[#009966]" />
          </div>
          <h2 className="text-xl font-black text-[#0D1B3D]">Check Your Email</h2>
          <p className="text-sm text-gray-500 mt-2 leading-relaxed max-w-xs mx-auto">
            We sent a confirmation link to <strong>{email}</strong>.
            Click the link to activate your account.
          </p>
          <p className="text-xs text-gray-400 mt-4">
            Check your spam folder if it doesn&apos;t arrive within 5 minutes.
          </p>
          <div className="mt-6">
            <Link
              href="/login"
              className="text-sm font-semibold text-[#009966] hover:underline"
            >
              ← Back to Sign In
            </Link>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="mb-6">
        <h1 className="text-2xl font-black text-[#0D1B3D]">Create Account</h1>
        <p className="text-sm text-gray-500 mt-1 leading-relaxed">
          Start recovering your money smarter. Free to join.
        </p>
      </div>

      <AuthCard>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && <AuthError message={error} />}

          <AuthField
            label="Your Full Name"
            placeholder="e.g. Ahmad bin Hassan"
            value={name}
            onChange={setName}
            error={nameErr}
            icon={<User className="w-4 h-4" />}
            autoComplete="name"
          />

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

          <AuthField
            label="Password"
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
            label="Confirm Password"
            type="password"
            placeholder="Re-enter your password"
            value={confirm}
            onChange={setConfirm}
            error={confirmErr}
            icon={<Lock className="w-4 h-4" />}
            autoComplete="new-password"
          />

          <p className="text-[11px] text-gray-400 leading-relaxed">
            By registering, you agree to CollectBoss&apos;s Terms of Service and
            Privacy Policy. CollectBoss does not provide legal advice.
          </p>

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
            {loading ? "Creating account…" : "Create Account"}
          </PrimaryButton>
        </form>
      </AuthCard>

      <p className="text-sm text-center text-gray-500 mt-5">
        Already have an account?{" "}
        <Link href="/login" className="text-[#009966] font-bold hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
