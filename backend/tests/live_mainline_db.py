"""Opt-in disposable PostgreSQL verification; no default database or credentials."""
import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys
from uuid import UUID, uuid4
import asyncpg

async def main():
    url=os.environ['DATABASE_URL'].replace('postgresql+asyncpg://','postgresql://')
    if os.environ.get('MAINLINE_DISPOSABLE_DB')!='true':
        raise RuntimeError('Requires MAINLINE_DISPOSABLE_DB=true and a dedicated test database')
    cases=[json.loads(line) for line in Path(os.environ['MAINLINE_BROWSER_LOG']).read_text().splitlines() if line.startswith('{"source":')]
    assert len(cases)==4
    db=await asyncpg.connect(url)
    for case in cases:
        row=await db.fetchrow('SELECT * FROM research_rounds WHERE id=$1',UUID(case['roundId']))
        assert row['status']=='completed'
        context=json.loads(row['execution_context'])
        assert context['source']==case['source']
        assert context['researchGoal']=='Transit policy research goal'
        count=await db.fetchval('SELECT count(*) FROM responses r JOIN round_respondents p ON r.round_respondent_id=p.id WHERE p.round_id=$1',row['id'])
        assert count==case['answers']
    print('PostgreSQL: 4 browser rounds, source/context and answer counts match',flush=True)
    row=dict(await db.fetchrow('SELECT * FROM research_rounds WHERE id=$1',UUID(cases[0]['roundId'])))
    config=dict(await db.fetchrow('SELECT * FROM config_versions WHERE id=$1',row['config_version_id']))
    qv=dict(await db.fetchrow('SELECT * FROM questionnaire_versions WHERE id=$1',config['questionnaire_version_id']))
    q=dict(await db.fetchrow('SELECT * FROM questionnaires WHERE id=$1',row['questionnaire_id']))
    project=dict(await db.fetchrow('SELECT * FROM projects WHERE id=$1',row['project_id']))
    user=dict(await db.fetchrow('SELECT * FROM users WHERE id=$1',project['owner_user_id']))
    name='mainline_migration_'+uuid4().hex[:12]
    await db.execute(f'CREATE DATABASE {name}')
    probe_url=url.rsplit('/',1)[0]+'/'+name
    env={**os.environ,'DATABASE_URL':probe_url.replace('postgresql://','postgresql+asyncpg://')}
    probe=None
    try:
        subprocess.run([sys.executable,'-m','alembic','upgrade','20260912_0002'],env=env,check=True)
        probe=await asyncpg.connect(probe_url)
        row.pop('execution_context');row['active_respondent_id']=None
        for table,data in [('users',user),('projects',project),('questionnaires',q),('questionnaire_versions',qv),('config_versions',config),('research_rounds',row)]:
            keys=list(data)
            await probe.execute(f'INSERT INTO {table} ({",".join(keys)}) VALUES ({",".join("$"+str(i+1) for i in range(len(keys)))})',*[data[k] for k in keys])
        before=dict(await probe.fetchrow('SELECT * FROM research_rounds WHERE id=$1',row['id']))
        subprocess.run([sys.executable,'-m','alembic','upgrade','head'],env=env,check=True)
        after=dict(await probe.fetchrow('SELECT * FROM research_rounds WHERE id=$1',row['id']))
        assert after.pop('execution_context') is None
        assert before==after
        assert await probe.fetchval('SELECT version_num FROM alembic_version')=='20260927_0003'
        print('Migration 0002 → 0003: existing round unchanged, source NULL, no recreation')
    finally:
        if probe: await probe.close()
        await db.execute(f'DROP DATABASE {name}')
        await db.close()

if __name__=='__main__':
    asyncio.run(main())
