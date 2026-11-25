import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-sans",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-ibm-mono",
});

const title = "Northline migration console";
const description =
  "Portfolio demo, not client work. Read-only console for a synthetic Salesforce, Pipedrive, and Zoho migration into HubSpot. No HubSpot token and no live customer data.";

export const metadata: Metadata = {
  metadataBase: new URL("https://crm.quvantic.com"),
  title,
  description,
  applicationName: title,
  authors: [{ name: "Mustafa", url: "https://github.com/mustafaautomation" }],
  creator: "Mustafa",
  keywords: ["HubSpot", "CRM migration", "portfolio demo", "Salesforce", "Pipedrive", "Zoho"],
  alternates: { canonical: "/" },
  openGraph: {
    title,
    description,
    url: "https://crm.quvantic.com",
    siteName: title,
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${mono.variable} antialiased`}>{children}</body>
    </html>
  );
}
