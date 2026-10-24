import assert from 'node:assert/strict'
import test from 'node:test'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const base=process.env.MAINLINE_BASE_URL ?? 'http://127.0.0.1:3101'
const password=process.env.MAINLINE_TEST_PASSWORD ?? 'mainline-local-password-only'

test('chosen English survives login with a Chinese-default account',async t=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close())
 const page=await browser.newPage()
 await page.goto(base+'/login')
 await page.getByRole('button',{name:'English',exact:true}).click()
 await page.locator('#username').fill('researcher01')
 await page.locator('#password').fill(password)
 await page.locator('button[type="submit"]').click()
 await page.waitForURL(base+'/')
 await page.getByRole('button',{name:'Create project',exact:true}).first().waitFor({timeout:5000})
 assert.equal(await page.locator('html').getAttribute('lang'),'en-US')
})

async function login(page,locale,username='researcher01') {
 await page.goto(base+'/login')
 await page.getByRole('button',{name:locale==='en-US'?'English':'中文',exact:true}).click()
 await page.locator('#username').fill(username)
 await page.locator('#password').fill(password)
 await page.locator('button[type="submit"]').click()
 await page.waitForURL(base+'/')
 await page.getByRole('button',{name:locale==='en-US'?'Create project':'创建项目',exact:true}).first().waitFor()
}
async function api(page,locale,path,method='GET',data) {
 const cookies=await page.context().cookies()
 const csrf=cookies.find(x=>x.name==='survey_csrf')?.value
 const response=await page.request.fetch(base+'/survey-api'+path,{method,data,headers:{'Accept-Language':locale,'X-CSRF-Token':csrf??'',Origin:base}})
 assert.ok(response.ok(),`${method} ${path}: ${response.status()} ${await response.text()}`)
 return response.status()===204?null:response.json()
}
const source=process.env.MAINLINE_SOURCE??'mock'
for(const locale of ['en-US','zh-CN']) for(const mode of ['survey','interview']) {
 test(`${source} ${locale} ${mode}: edit → generate → DB API → refresh → relogin`,{timeout:120000},async t=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close())
  const context=await browser.newContext({viewport:{width:1440,height:1000}})
  let page=await context.newPage()
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await login(page,locale)
  const en=locale==='en-US'
  const title=`Mainline ${source} ${locale} ${mode} ${Date.now()}`
  await page.getByRole('button',{name:en?'Create project':'创建项目',exact:true}).first().click()
  await page.locator('#project-name').fill(title)
  await page.locator('#research-goal').fill('Transit policy research goal')
  await page.locator('#principal-name').fill('Mainline researcher')
  const projectResponse=page.waitForResponse(r=>r.url().endsWith('/projects')&&r.request().method()==='POST')
  await page.getByRole('dialog').getByRole('button',{name:en?'Create':'创建',exact:true}).click()
  const project=await (await projectResponse).json()
  // Seed a compact complete instrument via the public owner-scoped API, then edit it in the UI.
  const config={title,description:'Initial policy description',maxResponseTime:60,questions:mode==='survey'?[
   {id:'q-text',type:'text',question:'What would improved transit change?'},
   {id:'q-choice',type:'choice',question:'Support?',options:['Yes','No']},
   {id:'q-scale',type:'scale',question:'Rate the benefit',scale:{min:1,max:5}},
  ]:[{id:'i1',type:'text',question:'Describe your commute'},{id:'i2',type:'text',question:'Explain your previous answer'}],
   respondentConfigs:[{id:'group',gender:en?'Any':'不限',ageRange:'25-35',occupation:'Teacher',city:'Initial city',income:'5000',count:2}],
   inferenceConfig:{enabled:true,profileEnabled:true,attitudeEnabled:false,profileTasks:[{id:'profile',name:'Profile demo',options:['X','Y'],multiple:false,enabled:true}],attitudeTasks:[]}}
  const questionnaire=await api(page,locale,`/projects/${project.id}/questionnaires`,'POST',{mode,config,schemaVersion:1})
  await page.reload()
  await page.locator('#title').waitFor()
  const savedResponse=page.waitForResponse(r=>r.url().endsWith('/questionnaires/'+questionnaire.id)&&r.request().method()==='PATCH')
  await page.locator('#description').fill('Edited transit policy description')
  await page.getByPlaceholder(en?'e.g. Seattle':'如 北京',{exact:true}).fill('Mainline City')
  const start=page.getByRole('button',{name:mode==='survey'?(en?'Start survey simulation':'开始问卷模拟'):(en?'Start interview simulation':'开始访谈模拟'),exact:true})
  assert.equal(await start.isDisabled(),true,'cannot start stale draft')
  await savedResponse
  const createdResponse=page.waitForResponse(r=>r.url().endsWith('/rounds')&&r.request().method()==='POST')
  await start.click()
  const created=await (await createdResponse).json()
  assert.equal(created.locale,locale)
  assert.equal(created.config.description,'Edited transit policy description')
  assert.equal(created.config.respondentConfigs[0].city,'Mainline City')
  let result
  for(let attempt=0;attempt<100;attempt++){
   result=await api(page,locale,`/rounds/${created.id}`)
   if(['completed','completed_with_errors','failed'].includes(result.status))break
   await new Promise(r=>setTimeout(r,250))
  }
  assert.equal(result.status,'completed')
  assert.equal(result.progress.completedRespondents,2)
  assert.equal(result.executionSource.source,source)
  assert.equal(result.progress.answeredQuestions,mode==='survey'?6:4)
  assert.equal(result.inferenceResults.length,source==='mock'&&mode==='interview'?2:0)
  const sourcePanel=page.getByTestId('execution-source')
  await sourcePanel.filter({hasText:'completed'}).waitFor()
  assert.match(await sourcePanel.innerText(),new RegExp(source))
  const recordsBefore=source==='test'?(await (await page.request.get('http://127.0.0.1:8999/requests')).json()).length:0
  await page.reload()
  await page.getByTestId('execution-source').filter({hasText:title}).waitFor()
  assert.equal(await page.locator('#title').inputValue(),title)
  await page.close();page=await context.newPage()
  await page.goto(base+'/')
  await page.getByTestId('execution-source').filter({hasText:title}).waitFor()
  await page.getByRole('button',{name:en?'Sign out':'退出登录',exact:true}).click()
  await login(page,locale)
  await page.getByTestId('execution-source').filter({hasText:title}).waitFor()
  if(source==='test'){
   const records=await (await page.request.get('http://127.0.0.1:8999/requests')).json()
   assert.equal(records.length,recordsBefore,'viewing history must not call the model')
   const own=records.filter(x=>x.title===title)
   assert.equal(own.length,mode==='survey'?6:4)
   assert.ok(own.every(x=>x.locale===locale&&x.respondent.city==='Mainline City'&&x.researchGoal==='Transit policy research goal'))
   if(mode==='interview')assert.deepEqual(own.map(x=>x.history.length),[0,2,0,2])
  }
  if(mode==='interview') {
   await page.getByRole('button').filter({hasText:result.respondents[0].name}).first().click()
   await page.getByText(result.sessions[0].dialog.find(m=>m.role==='respondent').content,{exact:true}).first().waitFor()
  } else {
   await page.getByText(String(result.responses[0].answers['q-text'].value),{exact:true}).first().waitFor()
  }
  await page.screenshot({path:`deploy/runtime/mainline/${source}-${locale}-${mode}.png`})
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({source,locale,mode,roundId:result.id,questionnaireId:questionnaire.id,projectId:project.id,answers:result.progress.answeredQuestions}))
 })
}

if(source==='test') test('history races, active editing, failure, and account isolation', {timeout:120000}, async t=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close())
 const page=await browser.newPage({viewport:{width:1440,height:1000}})
 await login(page,'en-US')
 const project=await api(page,'en-US','/projects','POST',{name:`Boundary ${Date.now()}`,researchGoal:'Boundary check',principalName:'Researcher'})
 const config={title:'Boundary instrument',description:'Frozen',maxResponseTime:10,questions:[{id:'ok',type:'text',question:'[delay=1] First'},{id:'bad',type:'text',question:'[error] Second'}],respondentConfigs:[{id:'g',gender:'Any',ageRange:'25-35',occupation:'Teacher',city:'City',income:'5000',count:1}]}
 const q=await api(page,'en-US',`/projects/${project.id}/questionnaires`,'POST',{mode:'survey',config,schemaVersion:1})
 const previous=await api(page,'en-US',`/questionnaires/${q.id}/rounds`,'POST')
 async function finish(id){for(let i=0;i<100;i++){const r=await api(page,'en-US',`/rounds/${id}`);if(['completed','completed_with_errors','failed','cancelled'].includes(r.status))return r;await new Promise(r=>setTimeout(r,100))}throw Error('round did not finish')}
 await finish(previous.id)
 await page.evaluate(({p,q,r})=>{const key=Object.keys(localStorage).find(k=>k.startsWith('survey-selection:'));localStorage.setItem(key,JSON.stringify({projectId:p,questionnaireId:q,roundId:r}))},{p:project.id,q:q.id,r:previous.id})
 let release, capturedResolve
 const held=new Promise(r=>{release=r}),captured=new Promise(r=>{capturedResolve=r})
 await page.route(`**/rounds/${previous.id}`,async route=>{const response=await route.fetch();capturedResolve();await held;await route.fulfill({response})})
 await page.reload();await captured
 const createdResponse=page.waitForResponse(r=>r.url().endsWith('/rounds')&&r.request().method()==='POST')
 await page.getByRole('button',{name:'Start survey simulation',exact:true}).click()
 const created=await(await createdResponse).json()
 await page.getByTestId('execution-source').waitFor()
 assert.equal(await page.locator('#description').isDisabled(),true,'active configuration must be read-only')
 release()
 const result=await finish(created.id)
 assert.equal(result.status,'completed_with_errors')
 assert.equal(result.progress.answeredQuestions,1,'the successful first answer remains')
 await page.waitForFunction(id=>document.querySelector('[data-testid="execution-source"]')?.getAttribute('data-round-id')===id,created.id)
 await page.getByTestId('execution-source').filter({hasText:'completed_with_errors'}).waitFor()
 assert.equal(await page.getByTestId('execution-source').getAttribute('data-round-id'),created.id)
 await page.unroute(`**/rounds/${previous.id}`)
 const before=(await(await page.request.get('http://127.0.0.1:8999/requests')).json()).length
 await page.reload()
 await page.getByTestId('execution-source').filter({hasText:'completed_with_errors'}).waitFor()
 await page.getByRole('button',{name:'Sign out',exact:true}).click()
 await login(page,'zh-CN')
 await page.getByTestId('execution-source').filter({hasText:'completed_with_errors'}).waitFor()
 assert.equal((await(await page.request.get('http://127.0.0.1:8999/requests')).json()).length,before)
 await page.getByRole('button',{name:'退出登录',exact:true}).click()
 await login(page,'en-US','researcher02')
 const forbidden=await page.request.get(base+`/survey-api/rounds/${created.id}`)
 assert.equal(forbidden.status(),404)
 assert.equal(await page.getByTestId('execution-source').count(),0)
 console.log(JSON.stringify({boundaryRoundId:created.id,status:result.status,answers:result.progress.answeredQuestions,isolation:forbidden.status()}))
})
