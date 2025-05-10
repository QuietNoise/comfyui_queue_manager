The frontend is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Gotchas
### Frontend in development mode vs production mode
Coding front end in development mode (with `npm run dev`) is faster thanks to fast reloads.
In queue-manager.js set variable QM_ENVIRONMENT to `development` to enable dev mode source of the nextjs iframe.


#### Cross-Origin issues
When running the front end in development mode, you will run into CORS issues when trying to access the ComfyUI APIs.
Since dev mode frontend and comfyui are running on different URLs, you will run into CORS issues.
To fix this run ComfyUI with the `--enable-cors-header http://localhost:3000` (or whatever post URL / port you gonna use) param (allowing dev mode front end to request comfyui apis) i.e.:

```
python main.py --listen 0.0.0.0 --port 8188 --enable-cors-header http://localhost:3000
```
