const envo = process.env.ENVO;

/** @type {import('next').NextConfig} */
const nextConfig = (envo === 'prod') ? {
    output: 'export',
    distDir: '../../web/.gui',
    basePath: "/extensions/comfyui_queue_manager/.gui",
    assetPrefix: "/extensions/comfyui_queue_manager/.gui",
    async generateBuildId() {
      // any deterministic string you like
      return "prod";          // will output _next/static/prod/…
    },
    webpack: (config, { isServer }) => {
      if (!isServer) {
        //  main runtime <buildId>.js  →  runtime.js
        config.output.filename      = 'static/chunks/[name].js';
        //  split chunks <name>.<hash>.js → <name>.js
        config.output.chunkFilename = 'static/chunks/[name].js';
      }
      return config;
    },
} : {
    distDir: 'dist-dev',
};

export default nextConfig;
