from __future__ import annotations

import asyncio
import random
from dataclasses import dataclass
from uuid import UUID, uuid4

from app.mocks.catalog import MockCatalog
from app.mocks.engine import MockEngine
from app.repositories.memory import MemoryRepository
from app.schemas.research import CreateProject, CreateQuestionnaire
from app.services.analytics_service import AnalyticsService
from app.services.research_service import ResearchService
from app.services.run_service import RunService
from research_support import FakeResearchRepository, valid_config


CATALOG = MockCatalog()


class CheckpointGateEngine(MockEngine):
    def __init__(self) -> None:
        super().__init__(CATALOG, random.Random(7), delay_scale=0)
        self.answer_started = asyncio.Event()
        self.allow_answer = asyncio.Event()

    async def wait_before_answer(self) -> None:
        self.answer_started.set()
        await self.allow_answer.wait()


class FailFirstAnswerEngine(MockEngine):
    def __init__(self) -> None:
        super().__init__(CATALOG, random.Random(11), delay_scale=0)
        self._failed = False

    def generate_answer(self, *args, **kwargs):
        if not self._failed:
            self._failed = True
            raise RuntimeError("respondent generation failed")
        return super().generate_answer(*args, **kwargs)


@dataclass(slots=True)
class RoundHarness:
    owner_id: UUID
    questionnaire_id: UUID
    repository: MemoryRepository
    research_repository: FakeResearchRepository
    research: ResearchService
    service: RunService


async def build_round_harness(
    *,
    engine: MockEngine | None = None,
    repository: MemoryRepository | None = None,
    config: dict | None = None,
    mode: str = "survey",
) -> RoundHarness:
    owner_id = uuid4()
    round_repository = repository or MemoryRepository()
    research_repository = FakeResearchRepository()
    research = ResearchService(research_repository)
    project = await research.create_project(
        owner_id,
        CreateProject(
            name="Durable study",
            researchGoal="Exercise checkpoints",
            principalName="Alice",
        ),
    )
    questionnaire = await research.create_questionnaire(
        owner_id,
        project.id,
        CreateQuestionnaire(
            mode=mode,
            config=config or valid_config(),
        ),
    )
    service = RunService(
        repository=round_repository,
        research=research,
        engine=engine
        or MockEngine(CATALOG, random.Random(3), delay_scale=0),
        analytics=AnalyticsService(CATALOG),
    )
    return RoundHarness(
        owner_id=owner_id,
        questionnaire_id=questionnaire.id,
        repository=round_repository,
        research_repository=research_repository,
        research=research,
        service=service,
    )
