import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests/e2e',timeout:30000,workers:1,use:{baseURL:'http://localhost:5173',channel:process.env.PLAYWRIGHT_CHANNEL??'msedge',headless:true,screenshot:'only-on-failure'},reporter:[['list']],outputDir:'test-results/browser'});
