import { Activity, CirclePlus, Ellipsis, House, Users } from "lucide-react";
import type { PocketNavigationIcon as IconName } from "@collectboss/pocket-navigation";

export function PocketNavigationIcon({ name, className }: { name: IconName; className?: string }) {
  const Icon = name === "home"
    ? House
    : name === "customers"
      ? Users
      : name === "add"
        ? CirclePlus
        : name === "activity"
          ? Activity
          : Ellipsis;
  return <Icon aria-hidden="true" className={className} />;
}
