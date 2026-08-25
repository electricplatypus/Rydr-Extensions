import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://byker.co"),
  title: "Rydr Extensions Marketplace",
  description: "Themes, plugins, screensaver widgets, view extensions, and tools for the Rydr motorcycle dashboard.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-[var(--border-subtle)]">
          <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
            <Link href="/" className="text-lg font-bold tracking-tight">
              🏍️ Rydr Extensions
            </Link>
            <nav className="flex items-center gap-4 text-sm text-[var(--text-muted)]">
              <Link href="/" className="hover:text-white">
                Marketplace
              </Link>
              <Link href="/admin" className="hover:text-white">
                Admin
              </Link>
            </nav>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
