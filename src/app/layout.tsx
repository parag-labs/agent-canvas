import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgentCanvas",
  description: "A visual, type-safe platform for designing, running, debugging and evaluating AI-agent workflows.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
