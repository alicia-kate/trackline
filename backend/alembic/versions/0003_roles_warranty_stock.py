"""four roles, warranty fields, stock movement log

- users.role: member becomes manager (Inventory Manager); new role oic (OIC/User); users.full_name added
- items: warranty_expiry and warranty_info added; an asset's old expiry_date moves to warranty_expiry
  (expiry_date now means license renewal only)
- stock_movements: one row per stock in / out; existing history is copied across where it can be read

Revision ID: 0003
Revises: 0002
"""
import re

from alembic import op
import sqlalchemy as sa

revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None

_QTY = re.compile(r'^([+\u2212-])(\d+)')
_BAL = re.compile(r'Balance (\d+)')
_WHY = re.compile(r'Reason: ([^\u00b7]+)')
_TO = re.compile(r'To ([^\u00b7]+)')


def upgrade() -> None:
    # --- roles ---
    op.drop_constraint('ck_users_role', 'users', type_='check')
    op.execute("UPDATE users SET role = 'manager' WHERE role = 'member'")
    op.create_check_constraint('ck_users_role', 'users', "role IN ('admin','manager','oic','viewer')")
    op.add_column('users', sa.Column('full_name', sa.String(length=100), nullable=True))

    # --- warranty ---
    op.add_column('items', sa.Column('warranty_expiry', sa.Date(), nullable=True))
    op.add_column('items', sa.Column('warranty_info', sa.String(length=300), nullable=True))
    op.execute("UPDATE items SET warranty_expiry = expiry_date, expiry_date = NULL WHERE category = 'Asset'")

    # --- stock movements ---
    op.create_table(
        'stock_movements',
        sa.Column('id', sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column('item_id', sa.String(length=20), nullable=False),
        sa.Column('at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('direction', sa.String(length=3), nullable=False),
        sa.Column('qty', sa.Integer(), nullable=False),
        sa.Column('balance_after', sa.Integer(), nullable=False),
        sa.Column('reason', sa.String(length=200), nullable=True),
        sa.Column('issued_to', sa.String(length=100), nullable=True),
        sa.Column('remarks', sa.String(length=500), nullable=True),
        sa.Column('by', sa.String(length=120), nullable=True),
        sa.CheckConstraint("direction IN ('in','out')", name='ck_stock_direction'),
        sa.CheckConstraint('qty > 0', name='ck_stock_qty'),
        sa.ForeignKeyConstraint(['item_id'], ['items.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_stock_movements_item_id'), 'stock_movements', ['item_id'], unique=False)

    # Copy what the history already says ("+5 · Balance 12 · Reason: restock"). Lines that cannot be read are skipped.
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT item_id, at, action, note, by FROM item_history WHERE action IN ('Stock in','Stock out') ORDER BY at, id")).fetchall()
    ins = sa.text("INSERT INTO stock_movements (item_id, at, direction, qty, balance_after, reason, issued_to, by) "
                  "VALUES (:item_id, :at, :d, :q, :b, :why, :to, :by)")
    for item_id, at, action, note, by in rows:
        q, b = _QTY.match(note or ''), _BAL.search(note or '')
        if not q or not b:
            continue
        why, to = _WHY.search(note), _TO.search(note)
        conn.execute(ins, {'item_id': item_id, 'at': at, 'd': 'in' if action == 'Stock in' else 'out', 'q': int(q.group(2)), 'b': int(b.group(1)),
                           'why': why.group(1).strip()[:200] if why else None, 'to': to.group(1).strip()[:100] if to else None, 'by': by})


def downgrade() -> None:
    op.drop_index(op.f('ix_stock_movements_item_id'), table_name='stock_movements')
    op.drop_table('stock_movements')
    op.execute("UPDATE items SET expiry_date = warranty_expiry WHERE category = 'Asset' AND expiry_date IS NULL")
    op.drop_column('items', 'warranty_info')
    op.drop_column('items', 'warranty_expiry')
    op.drop_column('users', 'full_name')
    op.drop_constraint('ck_users_role', 'users', type_='check')
    op.execute("UPDATE users SET role = 'member' WHERE role = 'manager'")
    op.execute("UPDATE users SET role = 'viewer' WHERE role = 'oic'")
    op.create_check_constraint('ck_users_role', 'users', "role IN ('admin','member','viewer')")
