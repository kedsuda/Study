/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_PHP_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
