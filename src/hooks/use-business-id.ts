"use client";

import { useEffect, useState } from "react";
import { getMyBusinessIdClient } from "@/lib/db/businesses-client";

export function useBusinessId(): string | null {
  const [businessId, setBusinessId] = useState<string | null>(null);

  useEffect(() => {
    getMyBusinessIdClient().then(setBusinessId);
  }, []);

  return businessId;
}
