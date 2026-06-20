"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PrimaryButton } from "@/components/ui/primary-button";
import { AuthShell, AuthCard, AuthField, AuthError } from "./auth-shell";
import { signIn } from "@/lib/auth/session";
import { Mail, Lock, ArrowRight, Loader2 } from "lucide-react";

export function LoginPage() {
  const router = useRouter();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

  // Per-field errors
  const [emailErr, setEmailErr]     = useState("");
  const [passErr, setPassErr]       = useState("");

  function validate(): boolean {
    let ok = true;
    setEmailErr("");
    setPassErr("");
    if (!email.trim()) {
      setEmailErr("Email address is required.");
      ok = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailErr("Please enter a valid email address.");
      ok = false;
    }
    if (!password) {
      setPassErr("Password is required.");
      ok = false;
    }
    return ok;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    setError("");

    const result = await signIn(email, password);

    if (!result.success) {
      setError(result.error ?? "Login failed. Please try again.");
      setLoading(false);
      return;
    }

    // Redirect — proxy will handle if business profile is missing
    router.push("/");
    router.refresh();
  }

  return (
    <AuthShell>
      <div className="mb-6">
        <h1 className="text-2xl font-black text-[#0D1B3D]">Welcome Back</h1>
        <p className="text-sm text-gray-500 mt-1 leading-relaxed">
          Sign in to manage your collection cases.
        </p>
      </div>

      <AuthCard>
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

          <AuthField
            label="Password"
            type="password"
            placeholder="Enter your password"
            value={password}
            onChange={setPassword}
            error={passErr}
            icon={<Lock className="w-4 h-4" />}
            autoComplete="current-password"
          />

          <div className="flex justify-end">
            <Link
              href="/forgot-password"
              className="text-xs text-[#009966] font-semibold hover:underline"
            >
              Forgot password?
            </Link>
          </div>

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
            {loading ? "Signing in…" : "Sign In"}
          </PrimaryButton>
        </form>
      </AuthCard>

      <p className="text-sm text-center text-gray-500 mt-5">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="text-[#009966] font-bold hover:underline">
          Register here
        </Link>
      </p>
    </AuthShell>
  );
}
