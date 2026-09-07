import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactCompiler: true,
  /*
   * Dev-only. Next blocks cross-origin requests to its dev resources by default, which
   * stops the app hydrating when it's opened on anything but `localhost`. Allowing the
   * loopback IP and LAN address makes it possible to run two independent sessions side by
   * side (different origins get different localStorage) for testing real-time delivery,
   * and to open the app on a phone. Has no effect on a production build.
   */
  allowedDevOrigins: ['127.0.0.1', '192.168.68.52'],
};

export default nextConfig;
