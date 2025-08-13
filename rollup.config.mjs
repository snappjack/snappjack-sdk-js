import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';

export default {
  input: 'src/index.ts',
  output: [
    {
      file: 'dist/snappjack-sdk.js',
      format: 'umd',
      name: 'Snappjack',
      sourcemap: true,
      exports: 'named'
    },
    {
      file: 'dist/snappjack-sdk.min.js', 
      format: 'umd',
      name: 'Snappjack',
      sourcemap: true,
      plugins: [terser()],
      exports: 'named'
    },
    {
      file: 'dist/index.mjs',
      format: 'es',
      sourcemap: true
    }
  ],
  plugins: [
    nodeResolve({
      browser: true
    }),
    typescript({
      tsconfig: './tsconfig.json',
      declaration: false,
      declarationMap: false,
      module: 'ESNext'
    })
  ]
};