"use client";

import { useState } from "react";
import { PrimaryButton } from "@/components/ui/primary-button";
import { Mail, Smartphone, ArrowRight, CheckCircle2 } from "lucide-react";

interface Props {
  isSignup?: boolean;
}

type Step = "email" | "otp" | "done";

export function LoginPageShell({ isSignup }: Props) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Wordmark */}
      <header className="px-6 py-5">
        <span className="text-2xl font-black text-[#0D1B3D]">
          Collect<span className="text-[#009966]">Boss</span>
        </span>
        <p className="text-xs text-gray-400 mt-0.5">Collect Smart. Recover Better.</p>
      </header>

      <div className="flex-1 px-6 py-8 flex flex-col max-w-sm w-full mx-auto">
        {step === "email" && (
          <>
            <div className="mb-8">
              <h1 className="text-2xl font-black text-[#0D1B3D]">
                {isSignup ? "Create Account" : "Welcome Back"}
              </h1>
              <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">
                {isSignup
                  ? "Enter your email to get started. No password needed."
                  : "Enter your email address. We'll send you a one-time code."}
              </p>
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-bold text-gray-700">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="email"
                    placeholder="you@company.com.my"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-10 pr-4 py-3.5 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition-all"
                  />
                </div>
              </div>

              <PrimaryButton
                fullWidth
                size="lg"
                disabled={!email.includes("@")}
                onClick={() => setStep("otp")}
                icon={<ArrowRight className="w-4 h-4" />}
              >
                Send Login Code
              </PrimaryButton>
            </div>

            <div className="mt-6 bg-blue-50 border border-blue-100 rounded-xl p-4">
              <p className="text-xs font-bold text-blue-800 mb-1">
                No password needed
              </p>
              <p className="text-[11px] text-blue-700 leading-relaxed">
                We send a one-time code to your email. Safer and easier than a
                password — especially for Malaysian business owners on the go.
              </p>
            </div>
          </>
        )}

        {step === "otp" && (
          <>
            <div className="mb-8">
              <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center mb-4">
                <Smartphone className="w-6 h-6 text-[#009966]" />
              </div>
              <h1 className="text-2xl font-black text-[#0D1B3D]">Check Your Email</h1>
              <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">
                We sent a 6-digit code to <strong>{email}</strong>. Enter it below.
              </p>
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex gap-2 justify-between">
                {Array.from({ length: 6 }, (_, i) => (
                  <input
                    key={i}
                    type="text"
                    maxLength={1}
                    className="w-12 h-14 text-center text-xl font-black border-2 border-gray-200 rounded-xl outline-none focus:border-[#009966] focus:ring-2 focus:ring-emerald-200 transition-all"
                  />
                ))}
              </div>

              <PrimaryButton
                fullWidth
                size="lg"
                onClick={() => setStep("done")}
              >
                Verify & Sign In
              </PrimaryButton>

              <button
                onClick={() => setStep("email")}
                className="text-sm text-center text-gray-400 hover:text-gray-600"
              >
                ← Change email address
              </button>
            </div>

            <p className="text-[11px] text-gray-400 text-center mt-4">
              Code expires in 10 minutes. Check your spam folder if it doesn&apos;t arrive.
            </p>
          </>
        )}

        {step === "done" && (
          <div className="flex flex-col items-center text-center py-8">
            <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mb-4">
              <CheckCircle2 className="w-8 h-8 text-[#009966]" />
            </div>
            <h2 className="text-xl font-black text-[#0D1B3D]">Signed In!</h2>
            <p className="text-sm text-gray-500 mt-2">
              Supabase Auth will be connected in Step 5.
            </p>
            <div className="mt-6 w-full">
              <PrimaryButton fullWidth size="lg" onClick={() => {}}>
                Go to Dashboard
              </PrimaryButton>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
