/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
  // Local development: send /api to the Go server (on Vercel, Services route /api to it).
  async rewrites() {
    const api = process.env.API_DEV_URL;
    return api ? [{ source: "/api/:path*", destination: `${api}/api/:path*` }] : [];
  },
};

export default nextConfig;
