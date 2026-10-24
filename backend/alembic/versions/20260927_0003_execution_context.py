"""Keep the model source and research context with each round, including old rows."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '20260927_0003'
down_revision = '20260912_0002'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('research_rounds', sa.Column('execution_context', JSONB(), nullable=True))


def downgrade():
    op.drop_column('research_rounds', 'execution_context')
