import Link from "next/link";
import { CollectBossWordmark } from "@/components/brand/wordmark";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#F2F4F7] flex flex-col items-center justify-center px-6 text-center">
      {/* CollectBoss wordmark */}
      <CollectBossWordmark className="mb-8 text-2xl" />

      {/* 404 block */}
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 px-8 py-10 max-w-sm w-full">
        <p className="text-6xl font-black text-[#0D1B3D] leading-none mb-3">404</p>
        <p className="text-lg font-bold text-gray-800 mb-2">Page Not Found</p>
        <p className="text-sm text-gray-500 leading-relaxed mb-8">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link
          href="/"
          className="inline-flex items-center justify-center w-full py-3.5 bg-[#009966] text-white font-bold text-sm rounded-2xl hover:bg-emerald-700 transition-colors"
        >
          Go to Dashboard
        </Link>
        <Link
          href="/cases"
          className="inline-flex items-center justify-center w-full py-3 text-sm font-semibold text-gray-500 hover:text-gray-700 mt-3"
        >
          View Cases
        </Link>
      </div>

      <p className="text-xs text-gray-400 mt-6">
        CollectBoss · Malaysian SME Debt Collection
      </p>
    </div>
  );
}
