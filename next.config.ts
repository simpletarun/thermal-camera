import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // pin the root: an unrelated lockfile in the home dir otherwise gets considered
  turbopack: {
    root: process.cwd(),
  },
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
