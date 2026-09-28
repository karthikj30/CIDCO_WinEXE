import path from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // node_modules is shared with the CIDCO portal one folder up, so the file
  // tracer has to be told the repository root is the boundary. Without it the
  // standalone build writes a layout it cannot then load itself.
  outputFileTracingRoot: path.join(import.meta.dirname, '..'),
  experimental: {
    serverActions: {
      // AQI report bundles include board photographs, so allow large payloads.
      bodySizeLimit: '25mb',
    },
  },
};

export default nextConfig;
