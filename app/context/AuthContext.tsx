"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from "react";
import { useRouter, usePathname } from "next/navigation";
import { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseclient";

type AuthContextType = {
  user: User | null;
  loading: boolean;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
});

const PUBLIC_ROUTES = new Set([
  "/",
  "/login",
  "/signup",
  "/pro",
  "/update-password",
]);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const isPublicRoute = useMemo(() => {
    if (!pathname) return true;
    // also treat any auth callback routes as public if you ever add them
    if (pathname.startsWith("/auth")) return true;
    return PUBLIC_ROUTES.has(pathname);
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      setLoading(true);
      const { data } = await supabase.auth.getSession();

      if (!cancelled) {
        setUser(data?.session?.user ?? null);
        setLoading(false);
      }
    }

    loadSession();

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
      }
    );

    return () => {
      cancelled = true;
      listener?.subscription.unsubscribe();
    };
  }, []);

  // 🔒 Redirect ONLY on protected routes, and only after loading finishes
  useEffect(() => {
    if (loading) return;
    if (isPublicRoute) return;

    if (!user) {
      router.push("/login");
    }
  }, [loading, user, router, isPublicRoute]);

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
