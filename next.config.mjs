/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'www.taskresponse.com' }],
        destination: 'https://taskresponse.com/:path*',
        permanent: true,
      },
    ];
  },
};
export default nextConfig;
