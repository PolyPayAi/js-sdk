import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts'
    },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    minify: false,
    target: 'es2020'
  },
  {
    entry: {
      'ponponpay.min': 'src/global.ts'
    },
    format: ['iife'],
    globalName: 'PonponPay',
    sourcemap: true,
    minify: true,
    clean: false,
    target: 'es2020'
  }
]);
