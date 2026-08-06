/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where the customer app is served, for handing over a support session. */
  readonly VITE_CUSTOMER_APP_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
