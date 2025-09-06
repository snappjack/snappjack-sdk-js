import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import terser from '@rollup/plugin-terser';

export default [
  // UMD builds - use index-umd.ts which only exports default
  {
    input: 'src/index-umd.ts',
    output: [
      {
        file: 'dist/snappjack-sdk.js',
        format: 'umd',
        name: 'Snappjack',
        sourcemap: true,
        exports: 'default'  // Export Snappjack class directly as window.Snappjack
      },
      {
        file: 'dist/snappjack-sdk.min.js', 
        format: 'umd',
        name: 'Snappjack',
        sourcemap: true,
        plugins: [terser()],
        exports: 'default'  // Export Snappjack class directly as window.Snappjack
      }
    ],
    plugins: [
      nodeResolve({
        browser: true
      }),
      commonjs(),
      json(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        declarationMap: false,
        module: 'ESNext'
      })
    ]
  },
  // Client-side ES module build
  {
    input: 'src/client.ts',
    output: {
      file: 'dist/client.mjs',
      format: 'es',
      sourcemap: true
    },
    plugins: [
      nodeResolve({
        browser: true
      }),
      commonjs(),
      json(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        declarationMap: false,
        module: 'ESNext'
      })
    ]
  },
  // Client-side CommonJS build for Node.js
  {
    input: 'src/client.ts',
    output: {
      file: 'dist/client.js',
      format: 'cjs',
      sourcemap: true
    },
    plugins: [
      nodeResolve({
        browser: false,
        preferBuiltins: true
      }),
      commonjs(),
      json(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        declarationMap: false,
        module: 'ESNext'
      })
    ]
  },
  // Server-side build - Node.js only
  {
    input: 'src/server.ts',
    output: [
      {
        file: 'dist/server.js',
        format: 'cjs',
        sourcemap: true
      },
      {
        file: 'dist/server.mjs',
        format: 'es',
        sourcemap: true
      }
    ],
    external: ['node:fetch', 'fetch'],
    plugins: [
      nodeResolve({
        preferBuiltins: true
      }),
      commonjs(),
      json(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        declarationMap: false,
        module: 'ESNext'
      })
    ]
  }
];