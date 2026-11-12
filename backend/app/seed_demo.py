"""Fills the database with starter master data, and optionally the sample inventory the demo used.

    python -m app.seed_demo            master data only (projects, vendors, locations, departments)
    python -m app.seed_demo --items    master data plus 10 sample items

Safe to run twice: anything that already exists is skipped.
"""
import sys
from datetime import date, timedelta

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models import Item, ItemHistory, MasterRow
from app.services import masters

MASTERS = {
    "projects": [
        ("Project Atlas", {"code": "PRJ-ATL", "lead": "Maya Patel", "site": "HQ", "description": "Corporate operations and shared services modernisation."}),
        ("Project Beacon", {"code": "PRJ-BCN", "lead": "Daniel Reyes", "site": "West Site", "description": "West site operations rollout."}),
        ("Project Harbor", {"code": "PRJ-HBR", "lead": "Liam Brooks", "site": "East Site", "description": "East site engineering infrastructure."}),
    ],
    "vendors": [
        ("TechSource Solutions", {"contact": "James Miller", "email": "sales@techsource.example", "phone": "+1 415 555 0182"}),
        ("CloudBridge Partners", {"contact": "Alicia Wong", "email": "alicia@cloudbridge.example", "phone": "+1 415 555 0126"}),
    ],
    "locations": [(n, {"code": c, "site": s}) for n, c, s in [
        ("HQ", "HQ", "HQ"), ("HQ · Floor 3", "HQ-F3", "HQ"), ("HQ · IT Store", "HQ-IT", "HQ"), ("HQ · Server Room", "HQ-SR", "HQ"),
        ("West Site", "WST", "West Site"), ("West · IT Store", "WST-IT", "West Site"), ("East Site", "EST", "East Site"), ("East · IT Store", "EST-IT", "East Site")]],
    "departments": [(n, {"code": c, "head": h}) for n, c, h in [
        ("Information Technology", "IT", "Daniel Reyes"), ("Finance", "FIN", "Maya Patel"), ("Operations", "OPS", "Daniel Reyes"),
        ("Engineering", "ENG", "Liam Brooks"), ("Administration", "ADM", "Alex Kim")]],
}

T, C = "TechSource Solutions", "CloudBridge Partners"
# (id, category, fields, days until expiry or None)
SAMPLE = [
    ("AST-1001", "Asset", dict(description="Dell Latitude 5440 14-inch laptop", make="Dell", model="Latitude 5440", serial_no="DL5440-8K2P", mg_no="MG-1001", purchase_date=date(2025, 3, 18), cost=1240, project="Project Atlas", vendor=T, status="Assigned", location="HQ · Floor 3", oic="Maya Patel", used_by="Maya Patel", department="Finance"), 509),
    ("AST-1002", "Asset", dict(description="Dell P2422H monitor", make="Dell", model="P2422H", serial_no="DP24-0917", mg_no="MG-1002", cost=210, project="Project Atlas", vendor=T, location="HQ · IT Store", oic="Daniel Reyes"), 509),
    ("AST-1003", "Asset", dict(description="HP LaserJet Pro M404 printer", make="HP", model="M404", serial_no="HPM4-1128", mg_no="MG-1003", project="Project Beacon", vendor=T, status="Under Repair", location="West Site", oic="Daniel Reyes", department="Operations"), 46),
    ("AST-1042", "Asset", dict(description="Dell PowerEdge R350 server", make="Dell", model="R350", serial_no="PE350-7731", mg_no="MG-1042", cost=4800, project="Project Harbor", vendor=T, status="In Use", location="East Site", oic="Liam Brooks", used_by="Liam Brooks", department="Engineering"), 13),
    ("LIC-0201", "License", dict(description="Microsoft 365 Business", make="Microsoft", serial_no="XXXXX-XXXXX-7K9Q2", qty=50, cost=7500, project="Project Atlas", vendor=C, status="In Use", location="HQ", oic="Maya Patel", department="Finance"), 20),
    ("LIC-0202", "License", dict(description="Adobe Acrobat Pro", make="Adobe", serial_no="ACR-4410-2291", qty=12, project="Project Beacon", vendor=C, status="In Use", location="West Site", oic="Daniel Reyes", department="Operations"), -6),
    ("SPR-0301", "Spare", dict(description="HP 59A toner", qty=3, min_qty=5, project="Project Beacon", location="West · IT Store", oic="Daniel Reyes"), None),
    ("SPR-0302", "Spare", dict(description="USB-C power adapter", qty=4, min_qty=10, project="Project Atlas", location="HQ · IT Store", oic="Daniel Reyes"), None),
    ("SPR-0303", "Spare", dict(description="Cat6 patch cable, 2m", qty=8, min_qty=15, project="Project Harbor", location="East · IT Store", oic="Liam Brooks"), None),
    ("SPR-0304", "Spare", dict(description="Logitech B100 mouse", qty=36, min_qty=10, project="Project Atlas", location="HQ · IT Store", oic="Daniel Reyes"), None),
]


def main() -> None:
    with SessionLocal() as db:
        for kind, rows in MASTERS.items():
            have = set(db.scalars(select(MasterRow.name).where(MasterRow.kind == kind)))
            for name, data in rows:
                if name not in have:
                    masters.create(db, None, kind, name, data)
        print("Master data ready.")
        if "--items" in sys.argv:
            added = 0
            for item_id, cat, f, days in SAMPLE:
                if db.get(Item, item_id):
                    continue
                end = date.today() + timedelta(days=days) if days is not None else None
                # Assets carry a warranty end date; licenses carry a renewal date.
                db.add(Item(id=item_id, category=cat, **({"warranty_expiry": end} if cat == "Asset" else {"expiry_date": end}), **f))
                db.flush()
                db.add(ItemHistory(item_id=item_id, action="Created", note="Sample record", by="seed"))
                added += 1
            db.commit()
            print(f"Sample items added: {added}")


if __name__ == "__main__":
    main()
