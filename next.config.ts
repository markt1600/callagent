import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Twilio's SDK pulls in Node-only modules; keep it external to the server bundle.
  serverExternalPackages: ["twilio"],
};

export default nextConfig;
