// Browser tests use the isolated fixture server on 8895. It returns deterministic
// fake points for interaction tests only and never loads a model. The stable
// companion on 8788 and real cameras are never touched.
//   ln -s <companion>/node_modules/@playwright motion/node_modules/@playwright
//   node motion/node_modules/@playwright/test/cli.js test -c motion/playwright.config.mjs
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const python = process.env.KLOBFLOW_MOTION_PYTHON || '.venv-motion/bin/python';

export default {
  testDir: './browser-tests',
  timeout: 90000,
  workers: 1,
  reporter: [['list']],
  outputDir: '../review/rewrite/playwright-results',
  use: {
    baseURL: 'http://localhost:8895',
    headless: true,
    viewport: {width: 1440, height: 900},
    launchOptions: {executablePath: process.env.KLOBFLOW_BROWSER},
  },
  webServer: {
    command: `${python} -m motion.tests.browser_server`,
    cwd: root,
    url: 'http://localhost:8895/api/status',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
};
