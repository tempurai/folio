/// <reference types="vite/client" />

import type { TememoryApi } from '../../shared/ipc';

declare global {
  interface Window {
    /** preload 注入的桌面端 API；纯浏览器预览时为 undefined（走 mockProvider） */
    tememory?: TememoryApi;
  }
}

export {};
