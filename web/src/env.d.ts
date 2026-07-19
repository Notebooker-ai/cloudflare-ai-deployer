/// <reference types="astro/client" />

// Bindings/secrets available on the deployed Worker (via Astro.locals.runtime.env).
interface Env {
  SESSION_SECRET: string;
  ASSETS: Fetcher;
}

type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {}
}
