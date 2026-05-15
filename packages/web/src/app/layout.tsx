import "../styles/globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "URID — Universal Researcher Identity",
  description: "Decentralized identity, reputation, and credentials for researchers",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
