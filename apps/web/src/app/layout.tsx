import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { ToastProvider } from "@/components/ui";

export const metadata: Metadata = {
  title: { default: "Workora", template: "%s · Workora" },
  description: "Company knowledge and operations assistant",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// Applies the saved theme before first paint to avoid a flash.
const themeScript = `try{var t=localStorage.getItem("workora-theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
