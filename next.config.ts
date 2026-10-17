import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  async headers() {
    return [{
      source: "/driver/sw.js",
      headers: [
        { key: "Cache-Control", value: "no-store, max-age=0" },
        { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Content-Security-Policy", value: "default-src 'none'; script-src 'self'; connect-src 'self'" },
      ],
    }];
  },
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
