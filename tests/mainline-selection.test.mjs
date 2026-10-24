import assert from 'node:assert/strict'
import test from 'node:test'

test('saved selection is scoped by account and rejects malformed values', async () => {
  const { readSelection, writeSelection } = await import('../lib/mainline-selection.ts')
  const values=new Map()
  const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)}
  writeSelection(storage,'alice',{projectId:'p',questionnaireId:'q',roundId:'r'})
  assert.deepEqual(readSelection(storage,'alice'),{projectId:'p',questionnaireId:'q',roundId:'r'})
  assert.equal(readSelection(storage,'bob'),null)
  values.set('survey-selection:alice','bad json')
  assert.equal(readSelection(storage,'alice'),null)
})

test('run is blocked while the latest edit is not the persisted config', async () => {
  const { isSavedDraft } = await import('../lib/mainline-selection.ts')
  assert.equal(isSavedDraft({title:'new'},JSON.stringify({title:'old'}),'saved'),false)
  assert.equal(isSavedDraft({title:'new'},JSON.stringify({title:'new'}),'failed'),false)
  assert.equal(isSavedDraft({title:'new'},JSON.stringify({title:'new'}),'saved'),true)
})
