import type { Metadata } from "next";
import { Inter } from 'next/font/google';
import { AuthProvider } from "@/lib/auth";
import { NotificationsProvider } from "@/lib/notifications";
import { MessagesProvider } from "@/lib/messages";
import "./globals.css";

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter'
});

export const metadata: Metadata = {
  title: "Edge Athlete",
  description: "Connect athletes, clubs, leagues, and fans",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
          crossOrigin="anonymous"
        />
      </head>
      <body className={`${inter.className} antialiased`}>
        <AuthProvider>
          <NotificationsProvider>
            <MessagesProvider>
              {children}
            </MessagesProvider>
          </NotificationsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
