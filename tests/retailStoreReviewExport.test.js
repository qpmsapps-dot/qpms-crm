import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {buildRetailStoreReviewWorkbook}from'../src/utils/retailStoreReviewExport.js';
import {parseStoreReview,validateStoreReview}from'../backend/services/retailStoreImportValidation.js';
import path from 'node:path';
const real=process.env.RETAIL_STORE_REVIEW_WORKBOOK;
test('real XLSX review preserves source identities and rejects spreadsheet-only approval',{skip:!real},async()=>{
 const p=parseStoreReview(fs.readFileSync(real),'review.xlsx');const evidenceRoot=path.dirname(path.dirname(real));
 const stores=JSON.parse(fs.readFileSync(path.join(evidenceRoot,'artifacts/retail-store-aop-upload-20261028/production-before-release.json'))).canonical;assert.equal(stores.length,130);
 const review=validateStoreReview(p,stores);const original=JSON.stringify(review);const book=await buildRetailStoreReviewWorkbook(review,{filename:'review.xlsx'});const bytes=Buffer.from(await book.xlsx.writeBuffer());
 const round=parseStoreReview(bytes,'export.xlsx');assert.deepEqual(round.rows,p.rows);assert.notEqual(round.checksum,p.checksum);assert.equal(JSON.stringify(review),original);
 const rereview=validateStoreReview(round,stores);assert.equal(rereview.identity_ready,0);assert.equal(rereview.aop_ready,0);assert.equal(book.getWorksheet('Proposed stores').rowCount,730);assert.equal(book.getWorksheet('Existing codes').rowCount,126);
 assert.equal(book.getWorksheet('Identity decisions').rowCount,855);assert.equal(book.getWorksheet('Independent AOP').rowCount,855);
 assert.equal(book.getWorksheet('Identity decisions').getCell('J2').value,'');assert.equal(book.getWorksheet('Independent AOP').getCell('Q2').value,'');
 for(const s of book.worksheets){assert.ok(s.autoFilter);assert.ok(s.views[0].ySplit===1);}
 const states=book.getWorksheet('State summary');assert.equal(states.getCell('A3').value,'PY');assert.equal(states.getCell('B3').value,'TN');assert.equal(states.getCell('B4').value,'KN');
 const source=book.getWorksheet('STORE UPLOAD REVIEW');source.getCell('Q2').value='YES';source.getCell('R2').value='SPREADSHEET-ONLY';
 const edited=parseStoreReview(Buffer.from(await book.xlsx.writeBuffer()),'edited.xlsx');assert.equal(validateStoreReview(edited,stores).identity_ready,0);
 assert.ok(rereview.rows.filter(r=>r.store_code==='U1KA').every(r=>r.issues.includes('DUPLICATE_UPLOAD_CODE')));
 fs.mkdirSync('artifacts/retail-store-excel-review-20261028',{recursive:true});fs.writeFileSync('artifacts/retail-store-excel-review-20261028/review.xlsx',bytes);
});
test('missing preview cannot export a misleading workbook',async()=>{await assert.rejects(()=>buildRetailStoreReviewWorkbook({}),/Validate/);});
