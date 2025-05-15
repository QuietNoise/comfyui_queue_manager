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
    webpack: (config, { isServer }) => {
      if (!isServer) {
        // Disable chunking for client-side bundles
        config.optimization.splitChunks = false;
        config.optimization.runtimeChunk = false;

        // Disable file name hashing for client-side bundles
        config.output.filename      = 'static/chunks/[name].js';
        config.output.chunkFilename = 'static/chunks/[name].js';
      }

      config.plugins.forEach((plugin) => {
        if (plugin.constructor?.name === 'NextMiniCssExtractPlugin') {
          // patch the existing instance in-place
          plugin.options.filename      = 'static/css/[name].css';
          plugin.options.chunkFilename = 'static/css/[name].css';
        }
      });
      return config;
    },
    sassOptions: {
      // suppress deprecation warnings from any dependency
      quietDeps: true,
    },
} : {
    distDir: 'dist-dev',
    sassOptions: {
      // suppress deprecation warnings from any dependency
      quietDeps: true,
    },
};

export default nextConfig;
