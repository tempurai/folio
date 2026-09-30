import { safeStorage } from 'electron';
import type { SecretCipher } from './services.js';

/**
 * 生产用加解密：Electron safeStorage（macOS Keychain / Windows DPAPI / Linux keyring）。
 * API Key 只以密文（base64）落在 state/secrets.json，明文永不写盘、不下发渲染层。
 */
export function createSafeStorageCipher(): SecretCipher {
  return {
    encrypt(plain: string): string {
      return safeStorage.encryptString(plain).toString('base64');
    },
    decrypt(encoded: string): string {
      return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
    },
  };
}
