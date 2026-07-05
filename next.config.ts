/** @author sgz @since 2026-07-03 */
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  // 上层目录也有 lockfile，固定 root 避免 Next.js 误把整个工作区纳入 trace
  turbopack: { root: __dirname },
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
