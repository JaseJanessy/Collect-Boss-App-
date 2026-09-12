"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { WorkspaceContextResponse } from "@collectboss/workspace-contracts";

const PocketWorkspaceContext = createContext<WorkspaceContextResponse | null>(null);

export function PocketWorkspaceProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: WorkspaceContextResponse;
}) {
  return <PocketWorkspaceContext.Provider value={value}>{children}</PocketWorkspaceContext.Provider>;
}

export function usePocketWorkspace(): WorkspaceContextResponse {
  const value = useContext(PocketWorkspaceContext);
  if (!value) throw new Error("Pocket workspace context is unavailable.");
  return value;
}
