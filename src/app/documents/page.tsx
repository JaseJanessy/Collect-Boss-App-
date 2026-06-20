import { DashboardShell } from "@/components/shells/dashboard-shell";
import { MobileShell } from "@/components/shells/mobile-shell";
import { DocumentsIndexPage } from "@/components/pages/legal/documents-index-page";

export default function Documents() {
  return (
    <>
      <MobileShell>
        <DocumentsIndexPage />
      </MobileShell>
      <DashboardShell>
        <DocumentsIndexPage />
      </DashboardShell>
    </>
  );
}
