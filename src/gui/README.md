The frontend is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Gotchas
### Frontend in development mode vs production mode
Coding front end in development mode (with `npm run dev`) is faster but not without its drawbacks.
Since the app will be served on `http://localhost:3000/` means you are not running the NextJS app within the ComfyUI environment and thus you will not have access to the comfyui front end wrapper and messaging that comes from it.

To see the full functionality of the front end, you need to run the ComfyUI app with the front end must be built in production mode `npm run build`. In this mode however you loose the instant refresh of the code changes and as such you will need to rebuild the app every time you make a change to the code.

#### Cross-Origin issues
When running the front end in development mode, you will run into CORS issues when trying to access the ComfyUI APIs.
Since dev mode frontend and comfyui are running on different URLs, you will run into CORS issues.
To fix this run ComfyUI with the `--enable-cors-header http://localhost:3000` param (allowing dev mode front end to request comfyui apis) i.e.:

```
python main.py --listen 0.0.0.0 --port 8188 --enable-cors-header http://localhost:3000
```
