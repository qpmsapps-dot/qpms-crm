import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function verifyRetailLayout(page, name) {
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({width, height:1000});
    await page.evaluate(() => document.fonts.ready);
    const overflow = await page.evaluate(() => ({
      page:document.documentElement.scrollWidth - document.documentElement.clientWidth,
      reports:[...document.querySelectorAll('.retail-report,.ifms-dashboard')].map(el => el.scrollWidth-el.clientWidth),
    }));
    if (process.env.RETAIL_LAYOUT_QA_DIR) {
      await fs.mkdir(process.env.RETAIL_LAYOUT_QA_DIR,{recursive:true});
      await page.screenshot({path:path.join(process.env.RETAIL_LAYOUT_QA_DIR,`${name}-${width}.png`),fullPage:true,animations:'disabled'});
    }
    if(overflow.page>1) console.log(await page.evaluate(()=>[...document.querySelectorAll('main *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1&&!el.closest('.overflow-x-auto,.retail-report-table')).slice(0,12).map(el=>({tag:el.tagName,classes:el.className,width:el.clientWidth,text:el.textContent.slice(0,60)}))));
    assert.ok(overflow.page <= 1 && overflow.reports.every(n=>n<=1), `${name} fits ${width}px: ${JSON.stringify(overflow)}`);
  }
}
