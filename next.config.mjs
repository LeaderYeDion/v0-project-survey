/** @type {import('next').NextConfig} */
const surveyBackendUrl =
  process.env.SURVEY_BACKEND_URL ?? "http://127.0.0.1:8000"

const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [
      {
        source: "/survey-api/:path*",
        destination: `${surveyBackendUrl}/api/:path*`,
      },
    ]
  },
}

export default nextConfig
