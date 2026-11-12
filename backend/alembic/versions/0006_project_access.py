"""project access for OIC/Users, and access requests

- user_projects: which projects an OIC/User may work in (names match Master data)
- change_requests.kind allows 'access' (an OIC/User asking for another project)
- existing OIC/Users keep the projects of the items they were already named on

Revision ID: 0006
Revises: 0005
"""
from alembic import op
import sqlalchemy as sa

revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'user_projects',
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('project', sa.String(length=100), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id', 'project'),
    )
    op.drop_constraint('ck_requests_kind', 'change_requests', type_='check')
    op.create_check_constraint('ck_requests_kind', 'change_requests', "kind IN ('create','update','action','attachment','import','access')")
    op.execute("""
        INSERT INTO user_projects (user_id, project)
        SELECT DISTINCT u.id, m.name
        FROM users u
        JOIN items i ON (lower(btrim(i.oic)) IN (lower(u.username), lower(nullif(btrim(coalesce(u.full_name, '')), '')))
                      OR lower(btrim(i.used_by)) IN (lower(u.username), lower(nullif(btrim(coalesce(u.full_name, '')), ''))))
        JOIN master_data m ON m.kind = 'projects' AND lower(m.name) = lower(btrim(i.project))
        WHERE u.role = 'oic'
    """)


def downgrade() -> None:
    op.execute("DELETE FROM change_requests WHERE kind = 'access'")
    op.drop_constraint('ck_requests_kind', 'change_requests', type_='check')
    op.create_check_constraint('ck_requests_kind', 'change_requests', "kind IN ('create','update','action','attachment','import')")
    op.drop_table('user_projects')
