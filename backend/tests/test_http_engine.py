import json

import httpx
import pytest

from app.mocks.catalog import MockCatalog
from app.mocks.engine import MockEngine
from app.schemas.survey import SurveyQuestion


def test_http_settings_are_explicit_and_mock_needs_no_credentials(monkeypatch):
    from app.services.http_engine import ModelSettings
    for key in ('SIMULATION_ENGINE', 'LLM_ENDPOINT', 'LLM_MODEL', 'LLM_SOURCE', 'LLM_AUTH_REQUIRED'):
        monkeypatch.delenv(key, raising=False)
    assert ModelSettings.from_env().engine == 'mock'
    monkeypatch.setenv('SIMULATION_ENGINE', 'http')
    with pytest.raises(ValueError):
        ModelSettings.from_env()
    monkeypatch.setenv('LLM_ENDPOINT', 'http://127.0.0.1:8999/v1/chat/completions')
    monkeypatch.setenv('LLM_MODEL', 'fixture')
    monkeypatch.setenv('LLM_SOURCE', 'test')
    assert ModelSettings.from_env().api_key == ''


@pytest.mark.asyncio
async def test_http_answer_contains_context_and_preserves_server_identity():
    from app.services.http_engine import HttpEngine, ModelSettings
    catalog = MockCatalog()
    config = catalog.default_template('en-US', 'interview')
    respondent = MockEngine(catalog).generate_respondents(config.respondentConfigs[:1], 'en-US')[0]
    question = SurveyQuestion(id='policy-choice', type='choice', question='Support?', options=['Yes', 'No'])
    captured = []
    async def handle(request):
        captured.append(json.loads(request.content))
        return httpx.Response(200, json={'choices':[{'message':{'content':json.dumps({'questionId':question.id, 'content':'Fixture answer', 'answerValue':{'type':'choice','value':'Yes'}})}}]})
    client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
    engine = HttpEngine(catalog, ModelSettings(engine='http', endpoint='http://fixture/v1/chat/completions', model='fixture', source='test'), client=client)
    result = await engine.answer(respondent, question, 'en-US', 'interview', config=config, history=[], research_goal='Housing policy')
    assert result.answerValue.value == 'Yes'
    assert result.sentiment is None
    data = json.loads(captured[0]['messages'][-1]['content'])
    assert data['respondent']['id'] == respondent.id
    assert data['question']['options'] == ['Yes','No']
    assert data['researchGoal'] == 'Housing policy'
    assert data['locale'] == 'en-US'
    assert result.questionId == question.id
    await engine.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize('value', ['not-json', '{"answerValue":{"type":"choice","value":"OUTSIDE"}}'])
async def test_invalid_model_output_fails_without_fallback(value):
    from app.services.http_engine import HttpEngine, ModelSettings, ModelCallError
    catalog = MockCatalog()
    config = catalog.default_template('en-US')
    respondent = MockEngine(catalog).generate_respondents(config.respondentConfigs[:1], 'en-US')[0]
    async def handle(request):
        return httpx.Response(200,json={'choices':[{'message':{'content':value}}]})
    engine = HttpEngine(catalog,ModelSettings(engine='http',endpoint='http://fixture',model='fixture',source='test'),client=httpx.AsyncClient(transport=httpx.MockTransport(handle)))
    with pytest.raises(ModelCallError):
        await engine.answer(respondent, SurveyQuestion(id='q',type='choice',question='Q',options=['Yes']), 'en-US','survey',config=config,history=[],research_goal='Policy')
    await engine.aclose()

@pytest.mark.asyncio
async def test_real_http_transport_fixture():
    from model_fixture import serve_fixture
    from app.services.http_engine import HttpEngine, ModelSettings
    catalog=MockCatalog()
    config=catalog.default_template('en-US')
    respondent=MockEngine(catalog).generate_respondents(config.respondentConfigs[:1],'en-US')[0]
    with serve_fixture() as endpoint:
        engine=HttpEngine(catalog,ModelSettings(engine='http',endpoint=endpoint+'/v1/chat/completions',model='fixture',source='test'))
        answer=await engine.answer(respondent,SurveyQuestion(id='x',type='text',question='Transit?'),'en-US','survey',config=config,history=[],research_goal='Transit policy')
        assert 'HTTP FIXTURE' in answer.content
        async with httpx.AsyncClient() as client:
            records=(await client.get(endpoint+'/requests')).json()
        assert len(records)==1
        assert records[0]['researchGoal']=='Transit policy'
        await engine.aclose()

@pytest.mark.asyncio
@pytest.mark.parametrize('value', [True, False, '3'])
async def test_http_scale_rejects_non_numeric_json_types(value):
    from app.services.http_engine import HttpEngine, ModelSettings, ModelCallError
    catalog = MockCatalog()
    config = catalog.default_template('en-US')
    respondent = MockEngine(catalog).generate_respondents(config.respondentConfigs[:1], 'en-US')[0]
    payload = {'questionId': 's', 'content': 'Answer', 'answerValue': {'type': 'scale', 'value': value}}
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, json={'choices': [{'message': {'content': json.dumps(payload)}}]})))
    engine = HttpEngine(catalog, ModelSettings(engine='http', endpoint='http://fixture', model='fixture', source='test'), client=client)
    with pytest.raises(ModelCallError):
        await engine.answer(respondent, SurveyQuestion(id='s', type='scale', question='Q', scale={'min': 0, 'max': 5}), 'en-US', 'survey', config=config, history=[], research_goal='Policy')
    await engine.aclose()


def test_previously_accepted_duplicate_question_ids_remain_readable():
    from app.schemas.survey import SurveyConfig
    config = MockCatalog().default_template('en-US').model_dump()
    config['questions'].append(config['questions'][0].copy())
    assert len(SurveyConfig.model_validate(config).questions) == len(config['questions'])

@pytest.mark.parametrize('question,answer', [
    ({'id':'q','type':'choice','question':'Q','options':['A','B']}, {'type':'choice','value':'C'}),
    ({'id':'q','type':'scale','question':'Q','scale':{'min':1,'max':5}}, {'type':'scale','value':6}),
    ({'id':'q','type':'text','question':'Q'}, {'type':'text','value':'   '}),
    ({'id':'q','type':'text','question':'Q'}, {'type':'choice','value':'A'}),
])
def test_answers_must_obey_current_question_constraints(question, answer):
    from pydantic import TypeAdapter
    from app.schemas.survey import AnswerValue
    from app.services.http_engine import ModelCallError, validate_answer
    with pytest.raises(ModelCallError):
        validate_answer(SurveyQuestion.model_validate(question), TypeAdapter(AnswerValue).validate_python(answer, strict=True))
