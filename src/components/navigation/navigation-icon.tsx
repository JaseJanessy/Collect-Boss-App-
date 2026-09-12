import {
  BarChart2,
  Bell,
  BookOpen,
  Building2,
  CreditCard,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Gauge,
  HelpCircle,
  LayoutList,
  Link2,
  Settings,
  ShieldCheck,
  Users,
  UserRound,
} from "lucide-react";
import type { NavigationIcon as NavigationIconName } from "../../../shared/navigation";

const icons = {
  dashboard: Gauge,
  cases: FolderOpen,
  payments: CreditCard,
  "action-centre": LayoutList,
  reports: BarChart2,
  debtors: UserRound,
  documents: FileText,
  statements: FileSpreadsheet,
  notifications: Bell,
  team: Users,
  billing: CreditCard,
  integrations: Link2,
  settings: Settings,
  "business-profile": Building2,
  "payment-accounts": ShieldCheck,
  support: HelpCircle,
  "beta-guide": BookOpen,
} satisfies Record<NavigationIconName, typeof Gauge>;

export function NavigationIcon({ name, className }: { name: NavigationIconName; className?: string }) {
  const Icon = icons[name];
  return <Icon aria-hidden="true" className={className} />;
}
