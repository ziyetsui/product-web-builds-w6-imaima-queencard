import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "../index.css";

export const metadata: Metadata = {
  title: "ima ima queencard | 爆款图驱动的图文生成工具",
  description: "上传参考图，ima ima queencard 识别爆款版式与平台语感，快速生成成套小红书图文。副业博主必备的内容创作神器。",
  authors: [{ name: "ima ima queencard" }],
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    shortcut: "/favicon.ico",
  },
  openGraph: {
    title: "ima ima queencard | 爆款图驱动的图文生成工具",
    description: "上传参考图，ima ima queencard 识别爆款版式与平台语感，快速生成成套小红书图文。",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" data-scroll-behavior="smooth">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Alfa+Slab+One&family=Manrope:wght@400;500;600;700;800&family=Pinyon+Script&family=Playfair+Display:wght@700;800;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
