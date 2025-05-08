const envo = process.env.ENVO;

/** @type {import('next').NextConfig} */
const nextConfig = (envo === 'prod') ? {
    output: 'export',
    distDir: '../../web/.gui',
    basePath: "/extensions/comfyui_queue_manager/.gui",
    assetPrefix: "/extensions/comfyui_queue_manager/.gui",
    async generateBuildId() {
      return "prod";          // remove manifest folder hash
    },
    experimental: {
      legacyBrowsers: false,
    },
    webpack: (config, { isServer }) => {
      if (!isServer) {
        // Disable chunking for client-side bundles
        config.optimization.splitChunks = false;
        config.optimization.runtimeChunk = false;

        // Disable file name hashing for client-side bundles
        config.output.filename      = 'static/chunks/[name].js';
        config.output.chunkFilename = 'static/chunks/[name].js';
      }
      return config;
    },
} : {
    distDir: 'dist-dev',
};

export default nextConfig;
