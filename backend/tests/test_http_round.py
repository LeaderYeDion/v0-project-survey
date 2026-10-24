import asyncio
import json

import httpx
import pytest
from app.mocks.catalog import MockCatalog
from app.services.http_engine import HttpEngine, ModelSettings
from research_support import valid_config
from round_support import build_round_harness


@pytest.mark.asyncio
async def test_round_uses_async_answers_with_frozen_goal_and_per_person_history():
    requests=[]
    async def handle(request):
        data=json.loads(json.loads(request.content)['messages'][-1]['content'])
        requests.append(data)
        q=data['question']
        return httpx.Response(200,json={'choices':[{'message':{'content':json.dumps({'questionId':q['id'],'content':'HTTP RESULT','answerValue':{'type':q['type'],'value':'A'}})}}]})
    engine=HttpEngine(MockCatalog(),ModelSettings(engine='http',endpoint='http://fixture',model='fixture',source='test'),client=httpx.AsyncClient(transport=httpx.MockTransport(handle)))
    config=valid_config()
    config['questions'].append({'id':'followup','type':'text','question':'Why?'})
    config['inferenceConfig']={'enabled':True,'profileEnabled':True,'profileTasks':[{'id':'p','name':'Profile','options':['X']}]}
    harness=await build_round_harness(engine=engine,config=config,mode='interview')
    created=await harness.service.create(harness.owner_id,harness.questionnaire_id,'en-US')
    result=await harness.service.wait(created.id)
    assert result.status=='completed'
    assert len(requests)==4
    assert [len(x['history']) for x in requests]==[0,2,0,2]
    assert all(x['researchGoal']=='Exercise checkpoints' for x in requests)
    assert result.inferenceResults==[]
    assert result.executionSource=={'source':'test','model':'fixture'}
    assert result.sessions[0].dialog[1].content=='HTTP RESULT'
    await engine.aclose()


@pytest.mark.asyncio
async def test_mock_custom_choice_does_not_reuse_unrelated_template_value():
    harness=await build_round_harness(config=valid_config())
    run=await harness.service.create(harness.owner_id,harness.questionnaire_id,'zh-CN')
    result=await harness.service.wait(run.id)
    assert all(r.answers['q1'].value in ['A','B'] for r in result.responses)

@pytest.mark.asyncio
@pytest.mark.parametrize('scenario', ['invalid', 'error', 'timeout', 'cancel', 'slow'])
async def test_http_round_failure_and_late_results(scenario):
    entered=asyncio.Event()
    release=asyncio.Event()
    calls=[]
    async def handle(request):
        data=json.loads(json.loads(request.content)['messages'][-1]['content'])
        calls.append(data)
        entered.set()
        if scenario in ('cancel','slow'):
            await release.wait()
        if scenario=='timeout':
            await asyncio.sleep(1)
        if scenario=='error':
            return httpx.Response(503,text='secret provider body must not leak')
        content='broken' if scenario=='invalid' else json.dumps({'questionId':'q1','content':'A','answerValue':{'type':'choice','value':'A'}})
        return httpx.Response(200,json={'choices':[{'message':{'content':content}}]})
    engine=HttpEngine(MockCatalog(),ModelSettings(engine='http',endpoint='http://fixture',model='fixture',source='test',timeout=0.05 if scenario=='timeout' else 60),client=httpx.AsyncClient(transport=httpx.MockTransport(handle)))
    cfg=valid_config();cfg['respondentConfigs'][0]['count']=1
    harness=await build_round_harness(engine=engine,config=cfg)
    created=await harness.service.create(harness.owner_id,harness.questionnaire_id,'en-US')
    await entered.wait()
    if scenario=='cancel':
        await harness.service.cancel(harness.owner_id,created.id)
        release.set()
    elif scenario=='slow':
        from datetime import UTC,datetime,timedelta
        recovered=await harness.repository.reconcile_interrupted_rounds(datetime.now(UTC)+timedelta(seconds=31))
        assert recovered==()
        release.set()
    result=await harness.service.wait(created.id)
    if scenario=='slow':
        assert result.status=='completed'
        assert result.progress.answeredQuestions==1
    else:
        assert result.progress.answeredQuestions==0
        assert result.status==('cancelled' if scenario=='cancel' else 'completed_with_errors')
        if scenario!='cancel':
            assert result.sessions[0].errorMessage in ('MODEL_TIMEOUT','MODEL_REQUEST_FAILED','MODEL_INVALID_ANSWER')
    assert len(calls)==1
    await engine.aclose()


@pytest.mark.asyncio
async def test_old_round_source_stays_unknown_and_resume_cannot_switch_model():
    from app.api.errors import ApiError
    from round_support import CheckpointGateEngine
    gate=CheckpointGateEngine()
    harness=await build_round_harness(engine=gate)
    created=await harness.service.create(harness.owner_id,harness.questionnaire_id,'en-US')
    await gate.answer_started.wait()
    await harness.service.pause(harness.owner_id,created.id)
    gate.allow_answer.set()
    result=await harness.service.wait(created.id)
    assert result.status=='paused'
    from uuid import UUID
    row=await harness.repository.get_for_owner(harness.owner_id,UUID(created.id))
    harness.repository._rounds[UUID(created.id)].execution_context=None
    old=await harness.service.get(harness.owner_id,created.id)
    assert old.executionSource is None
    gate.execution_source={'source':'test','model':'different'}
    with pytest.raises(ApiError) as exc:
        await harness.service.resume(harness.owner_id,created.id)
    assert exc.value.code=='MODEL_SOURCE_CHANGED'
