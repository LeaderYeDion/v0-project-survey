import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync,writeFileSync} from 'node:fs'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright')
const base=process.env.MAINLINE_BASE_URL??'http://127.0.0.1:3101'
const cases=JSON.parse(readFileSync(process.env.MAINLINE_HISTORY_CASES,'utf8'))
const evidence=process.env.MAINLINE_HISTORY_EVIDENCE

test('persisted histories remain readable across backend restart and source switch',async t=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close())
 const page=await browser.newPage({viewport:{width:1440,height:1000}})
 await page.goto(base+'/login')
 await page.getByRole('button',{name:'English',exact:true}).click()
 await page.locator('#username').fill('researcher01')
 await page.locator('#password').fill(process.env.MAINLINE_TEST_PASSWORD??'mainline-local-password-only')
 await page.locator('button[type="submit"]').click()
 await page.waitForURL(base+'/')
 await page.getByRole('button',{name:'Create project',exact:true}).first().waitFor()
 const records=await (await page.request.get('http://127.0.0.1:8999/requests')).json()
 const snapshots=[]
 for(const item of cases){
  const response=await page.request.get(base+`/survey-api/rounds/${item.roundId}`)
  assert.equal(response.status(),200)
  const r=await response.json();snapshots.push(r)
  assert.equal(r.executionSource?.source??null,item.source)
  await page.locator('#title').waitFor()
  await page.waitForLoadState('networkidle')
  await page.evaluate(r=>{
   const key=Object.keys(localStorage).find(k=>k.startsWith('survey-selection:'))
   localStorage.setItem(key,JSON.stringify({projectId:r.projectId,questionnaireId:r.questionnaireId,roundId:r.id}))
  },r)
  await page.reload()
  await page.getByTestId('execution-source').waitFor()
  assert.equal(await page.getByTestId('execution-source').getAttribute('data-round-id'),r.id)
  assert.match(await page.getByTestId('execution-source').innerText(),item.source?new RegExp(item.source):/unrecorded|legacy/i)
 }
 assert.equal((await(await page.request.get('http://127.0.0.1:8999/requests')).json()).length,records.length)
 if(process.env.MAINLINE_HISTORY_COMPARE==='true') assert.deepEqual(snapshots,JSON.parse(readFileSync(evidence,'utf8')))
 else writeFileSync(evidence,JSON.stringify(snapshots,null,2))
 console.log(JSON.stringify({histories:cases.map(x=>x.roundId),unchanged:process.env.MAINLINE_HISTORY_COMPARE==='true'}))
})
