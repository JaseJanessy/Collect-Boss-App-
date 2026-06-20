"use client";

import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Construction } from "lucide-react";

interface StubPageProps {
  title: string;
  description?: string;
}

export function StubPage({ title, description }: StubPageProps) {
  return (
    <div className="flex flex-col h-full">
      <PageHeader title={title} subtitle={description} />
      <EmptyState
        icon={<Construction className="w-7 h-7" />}
        title="Coming Soon"
        description="This section is being built. Check back in the next step."
        className="flex-1"
      />
    </div>
  );
}
