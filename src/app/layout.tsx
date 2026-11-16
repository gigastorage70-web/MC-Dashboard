import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/layout/AppShell";
import { FilterProvider } from "@/components/filters/FilterContext";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "MC QoS Intelligence | MediaCore SMS Analytics Platform",
  description:
    "Enterprise Telecom Messaging Quality of Service (QoS) Intelligence & MediaCore XDR Analytics Platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} antialiased`}>
        <FilterProvider>
          <AppShell>{children}</AppShell>
        </FilterProvider>
      </body>
    </html>
  );
}
