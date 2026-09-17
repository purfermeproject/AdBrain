import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AdBrain",
  description: "AI paid media intelligence system",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
