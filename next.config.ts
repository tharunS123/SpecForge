import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prompt templates are read from disk at runtime (lib/prompts/render.ts); make sure they ship with the functions.
  outputFileTracingIncludes: {
    "/api/*": ["./prompts/**/*"],
  },
};

export default nextConfig;
