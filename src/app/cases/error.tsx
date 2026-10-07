"use client";

import { SectionError } from "@/components/layout/section-error";

export default function SectionErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SectionError error={error} reset={reset} section="cases" />;
}
