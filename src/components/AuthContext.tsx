import React, { createContext, useContext } from 'react';

export const mockUserObj = {
  id: "00000000-0000-0000-0000-000000000000",
  email: "demo-user@mustawdae.com",
  role: "authenticated",
  user_metadata: {
    full_name: "Demo User"
  }
};

export interface AuthContextType {
  user: any;
  session: any;
  loading: boolean;
  isAdmin: boolean;
  isGuest: boolean;
  loginWithGoogle: () => Promise<any>;
  loginWithEmail: (emailVal: string, passwordVal: string) => Promise<any>;
  signUpWithEmail: (emailVal: string, passwordVal: string) => Promise<any>;
  logout: () => Promise<void>;
  continueAsGuest: () => void;
  refreshToken: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Pass-through container. Real implementation and state are overridden directly inside App.tsx
  return <>{children}</>;
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    // If used outside of overridden App.tsx context provider, return empty/safe defaults
    return {
      user: null,
      session: null,
      loading: false,
      isAdmin: false,
      isGuest: false,
      loginWithGoogle: async () => {},
      loginWithEmail: async () => {},
      signUpWithEmail: async () => {},
      logout: async () => {},
      continueAsGuest: () => {},
      refreshToken: async () => {},
    } as any;
  }
  return context;
};
