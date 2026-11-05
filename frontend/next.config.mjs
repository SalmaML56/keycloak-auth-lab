/** @type {import('next').NextConfig} */
const nextConfig = {
  // Strict Mode is on (default in the App Router). It intentionally runs
  // effects twice in development, which is exactly why the /callback code
  // exchange needs the once-only guard.
  reactStrictMode: true,
};

export default nextConfig;
