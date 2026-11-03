import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Keep validation builds separate from the running local preview.
  distDir: process.env.CENTRAL_IDENTITY_VALIDATION_BUILD === 'true' ? '.next-validation' : '.next',
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),
  // Next dev normalizes loopback IPs to localhost; preserve the exact origin
  // in the explicitly isolated local preview. Production keeps the default.
  skipMiddlewareUrlNormalize: process.env.CENTRAL_IDENTITY_LOCAL_PREVIEW==='true',
  async headers() {
    if(process.env.CENTRAL_IDENTITY_ENABLED!=='true')return [];
    const parent=new URL(process.env.ATTENDANCE_PUBLIC_URL).origin;
    return [{source:'/:path*',headers:[{key:'Content-Security-Policy',value:`frame-ancestors 'self' ${parent}`}]}];
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
};

export default nextConfig;
