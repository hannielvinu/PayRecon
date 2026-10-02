import type { Metadata } from "next";
import "./globals.css";
import "./payrecon.css";
import "./site.css";

export const metadata: Metadata = {
  title: "PayRecon | Settlement reconciliation agent",
  description: "Reconcile merchant orders, Razorpay settlement exports, and bank credits with an evidence-first finance agent.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
