/**
 * @author sgz
 * @since 2026-07-03
 */
import type { Metadata } from "next";
import { Outfit, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { getUser } from '@/lib/auth'
import NavBar from './_components/NavBar'

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Skill Hub - Claude 技能市场",
  description: "浏览、安装和分享 Claude 技能插件",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getUser()

  return (
    <html
      lang="zh-CN"
      className={`${outfit.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <NavBar user={user} />
        {children}
      </body>
    </html>
  );
}
