import {defineConfig} from '@playwright/test';
import {fileURLToPath} from 'node:url';
export default defineConfig({testDir:'.',testMatch:'octoberAdminRelease.spec.js',timeout:90000,expect:{timeout:12000},workers:1,reporter:'line',use:{baseURL:'http://127.0.0.1:4198',browserName:'chromium',headless:true,screenshot:'only-on-failure',trace:'retain-on-failure'},webServer:{command:'node tests/browser/serveOctoberAdmin.mjs',cwd:fileURLToPath(new URL('../..',import.meta.url)),url:'http://127.0.0.1:4198/tests/browser/fixtures/october-admin.html',reuseExistingServer:false,timeout:180000}});
