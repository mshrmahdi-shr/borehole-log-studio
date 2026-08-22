import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AppealAI — Gaming Account Appeal Assistant",
  description: "Organize evidence, understand moderation notices, and prepare a truthful appeal.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
