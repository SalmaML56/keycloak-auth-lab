import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Keycloak Auth Lab",
  description: "OAuth 2.0 Authorization Code + PKCE demo (no auth libraries).",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
