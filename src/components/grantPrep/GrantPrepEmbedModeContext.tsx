'use client';

import { createContext, useContext, type ReactNode } from 'react';

const GrantPrepEmbedModeContext = createContext(false);

export function GrantPrepEmbedModeProvider({
  embedded,
  children,
}: {
  embedded: boolean;
  children: ReactNode;
}) {
  return (
    <GrantPrepEmbedModeContext.Provider value={embedded}>
      {children}
    </GrantPrepEmbedModeContext.Provider>
  );
}

export function useGrantPrepEmbeddedMode() {
  return useContext(GrantPrepEmbedModeContext);
}
