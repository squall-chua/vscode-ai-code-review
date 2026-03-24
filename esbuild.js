const esbuild = require('esbuild');
const { execSync } = require('child_process');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: [
    'vscode',
    // Heavy CLI-based providers — resolved from node_modules at runtime
    'ai-sdk-provider-claude-code',
    'ai-sdk-provider-gemini-cli',
    'ai-sdk-provider-opencode-sdk',
    'ai-sdk-provider-codex-cli',
    // Packages with native .wasm or complex binaries that break esbuild
    '@google/gemini-cli-core',
    'web-tree-sitter',
    'tree-sitter-bash',
  ],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

async function build() {
  if (watch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('Watching for changes...');
  } else {
    await esbuild.build(buildOptions);
    console.log('Build complete.');
  }
}

build().catch(() => process.exit(1));
