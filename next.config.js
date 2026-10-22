/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['lunar-javascript'],
  // 199 服务器在局域网内，开发时通过 IP 直连；Next 16 默认拦截跨源 dev 资源
  allowedDevOrigins: ['192.168.1.199', 'localhost', '127.0.0.1'],
};

module.exports = nextConfig;
