"use client";

import { useEffect } from "react";
import Link from "next/link";
import { trackError } from "@/lib/analytics/tracker";

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: Props) {
  useEffect(() => {
    trackError(error, { page: "global", digest: error.digest });
  }, [error]);

  return (
    <div className="min-h-screen bg-[#F2F4F7] flex flex-col items-center justify-center px-6 text-center">
      <span className="text-2xl font-black text-[#0D1B3D] mb-8">
        Collect<span className="text-[#009966]">Boss</span>
      </span>

      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 px-8 py-10 max-w-sm w-full">
        <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl">⚠️</span>
        </div>
        <p className="text-lg font-bold text-gray-800 mb-2">Something went wrong</p>
        <p className="text-sm text-gray-500 leading-relaxed mb-8">
          An unexpected error occurred. Please try again or contact support if the problem persists.
        </p>
        <button
          onClick={reset}
          className="inline-flex items-center justify-center w-full py-3.5 bg-[#009966] text-white font-bold text-sm rounded-2xl hover:bg-emerald-700 transition-colors mb-3"
        >
          Try Again
        </button>
        <Link
          href="/"
          className="inline-flex items-center justify-center w-full py-3 text-sm font-semibold text-gray-500 hover:text-gray-700"
        >
          Go to Dashboard
        </Link>
        {error.digest && (
          <p className="text-[10px] text-gray-300 mt-4 font-mono">
            Error ID: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
