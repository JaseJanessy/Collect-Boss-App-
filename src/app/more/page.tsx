import { MobileShell } from "@/components/shells/mobile-shell";
import { DashboardShell } from "@/components/shells/dashboard-shell";
import { MorePage } from "@/components/pages/more-page";

export default function More() {
  return (
    <>
      <MobileShell>
        <MorePage />
      </MobileShell>
      <DashboardShell>
        <div className="mx-auto w-full max-w-3xl">
          <MorePage />
        </div>
      </DashboardShell>
    </>
  );
}
