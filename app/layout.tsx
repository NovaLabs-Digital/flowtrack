import "./globals.css";
import type { ReactNode } from "react";
import { AuthProvider } from "./context/AuthContext";
import { GoogleAnalytics } from "@next/third-parties/google";

export const metadata = {
  title: "FlowTrack",
  description: "Personal finance dashboard",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
      {process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID && (
        <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID} />
      )}
    </html>
  );
}
