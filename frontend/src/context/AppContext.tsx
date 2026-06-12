import type { ReactNode } from "react";
import { createContext, useContext, useMemo } from "react";

interface AppContextValue {
  appName: "AURA";
  architectureVersion: "2026-structured";
}

const AppContext = createContext<AppContextValue | null>(null);

interface AppContextProviderProps {
  children: ReactNode;
}

export function AppContextProvider({ children }: AppContextProviderProps) {
  const value = useMemo<AppContextValue>(
    () => ({
      appName: "AURA",
      architectureVersion: "2026-structured",
    }),
    [],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) {
    throw new Error("useAppContext must be used inside AppContextProvider");
  }
  return value;
}
