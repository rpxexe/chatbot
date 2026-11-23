import type { NextConfig } from "next";

// Proxy /api to the backend so the browser stays same-origin (no CORS setup needed).
const config: NextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${process.env.API_URL ?? "http://localhost:4000"}/api/:path*` }];
  },
};

export default config;
