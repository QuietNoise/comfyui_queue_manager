const envo = process.env.ENVO;

/** @type {import('next').NextConfig} */
const nextConfig = (envo === 'prod') ? {
    output: 'export',
    distDir: '../../web/.gui',
    basePath: "/extensions/comfyui_queue_manager/.gui",
    assetPrefix: "/extensions/comfyui_queue_manager/.gui",
} : {
    distDir: 'dist-dev',
};

export default nextConfig;
