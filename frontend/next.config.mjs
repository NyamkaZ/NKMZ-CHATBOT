/** @type {import('next').NextConfig} */
const backend = process.env.INTERNAL_API_URL || "http://localhost:8000";

const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${backend}/api/:path*` },
      { source: "/health", destination: `${backend}/health` },
      { source: "/health/:path*", destination: `${backend}/health/:path*` },
    ];
  },
};

export default nextConfig;
