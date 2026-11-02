// Local-only release checks. No credentials, network calls or production mutations.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(!process.env.RETAIL_MIS_PG_TOOLS||!fs.existsSync(path.join(process.env.RETAIL_MIS_PG_TOOLS,'node_modules/embedded-postgres/dist/index.js')))throw Error('Set RETAIL_MIS_PG_TOOLS to an isolated installation of embedded-postgres@17.6.0-beta.15 and pg@8.16.3. Real PostgreSQL checks may not be skipped for release.');
const tests=['backend/tests/retailMisAccess.test.js','backend/tests/retailMisPostgres.test.js','tests/retailMisBrowser.test.js','backend/tests/retailInitialAdminAccess.test.js','backend/tests/retailModuleReportService.test.js','backend/tests/retailModulesB.test.js','backend/tests/retailAttendanceReportScope.test.js','backend/tests/retailAttendanceXlsx.test.js','backend/tests/retailAttendanceUploadSize.test.js','backend/tests/retailAttendancePreviewAudit.test.js','backend/tests/retailOperations.test.js','backend/tests/retailDashboardTrainingCount.test.js','tests/retailUnifiedNavigation.test.js','tests/retailModulesBBrowser.test.js'];
tests.push('backend/tests/retailMisQuotationFormat.test.js','backend/tests/retailOosV2.test.js','backend/tests/retailMisGenerator.test.js','backend/tests/retailWorkflowGaps.test.js');
const r=spawnSync(process.execPath,['--test','--test-concurrency=1',...tests],{cwd:root,env:process.env,stdio:'inherit'});process.exitCode=r.status??1;
