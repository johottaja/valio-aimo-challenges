"""Initial sandbox, purchase, authorization reservation and demo ledger schema."""
from alembic import op
from app.db import Base

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    Base.metadata.create_all(op.get_bind())
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_request_idempotency ON purchases(sandbox_id, idempotency_key)")


def downgrade():
    Base.metadata.drop_all(op.get_bind())
