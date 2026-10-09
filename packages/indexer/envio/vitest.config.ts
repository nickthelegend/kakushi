import {defineConfig} from 'vitest/config';
// Keep this isolated Envio runtime suite out of the sibling RPC indexer's default test glob.
export default defineConfig({test:{include:['test/**/*.envio-test.ts'],maxWorkers:1}});
