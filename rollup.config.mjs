import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import terser from '@rollup/plugin-terser';
import replace from '@rollup/plugin-replace';
import dotenv from 'dotenv';
dotenv.config();


// Get server URL from environment or use defaults
const getServerUrl = () => {
  // For development builds, use .env file or localhost
  if ((process.env.NODE_ENV !== 'production') && process.env.SNAPPJACK_SERVER_URL) {
    return process.env.SNAPPJACK_SERVER_URL;
  }
  // For production builds, use the production server
  return 'https://bridge.snappjack.com';
};

// Create replace plugin with server URL
const createReplacePlugin = () => replace({
  __SNAPPJACK_SERVER_URL__: JSON.stringify(getServerUrl()),
  preventAssignment: true
});

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
      createReplacePlugin(),
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
      createReplacePlugin(),
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
      createReplacePlugin(),
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
      createReplacePlugin(),
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