import type { Metadata } from "next";
import "./globals.css";

const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://salem.opencoven.ai";

export const metadata: Metadata = {
  title: "Salem | OpenCoven Documentation Assistant",
  description: "RAG-based documentation assistant for OpenCoven",
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    images: [`${baseUrl}/og-image.png`],
  },
  twitter: {
    card: "summary_large_image",
    title: "Salem | OpenCoven Documentation Assistant",
    description: "RAG-based documentation assistant for OpenCoven",
    images: [`${baseUrl}/og-image.png`],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
