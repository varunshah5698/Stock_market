"""store dataset and model bytes in the database

The application previously kept validated CSVs and trained artifacts on the
local filesystem. Serverless platforms mount the bundle read-only and discard
/tmp between instances, so the authoritative copy moves into the row. The
existing path columns are kept for local convenience and legacy rows.

Revision ID: 8f2c1a6d9b34
Revises: fae299b94dd9
Create Date: 2026-10-28 03:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8f2c1a6d9b34'
down_revision: Union[str, Sequence[str], None] = 'fae299b94dd9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('datasets', sa.Column('content', sa.LargeBinary(), nullable=True))
    op.add_column('model_versions', sa.Column('artifact', sa.LargeBinary(), nullable=True))


def downgrade() -> None:
    op.drop_column('model_versions', 'artifact')
    op.drop_column('datasets', 'content')
