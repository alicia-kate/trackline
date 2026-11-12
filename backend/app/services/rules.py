"""Business rules for inventory items. Mirrors what used to live in frontend/src/lib/rules.ts; the server is now the authority."""
from dataclasses import dataclass


@dataclass(frozen=True)
class ActionDef:
    title: str
    fields: tuple[str, ...]  # form fields the action accepts
    required: tuple[str, ...] = ()
    cats: tuple[str, ...] | None = None
    frm: tuple[str, ...] | None = None  # statuses the action can start from
    to: str | None = None


AL = ("Asset", "License")
ACTIONS: dict[str, ActionDef] = {
    "assign": ActionDef("Assign", ("who", "dept", "loc", "rem"), ("who",), AL, ("Available",), "Assigned"),
    "use": ActionDef("Mark in use", ("rem",), (), AL, ("Assigned",), "In Use"),
    "transfer": ActionDef("Transfer", ("who", "dept", "loc", "rem"), ("who",), AL, ("Assigned", "In Use")),
    "return": ActionDef("Return", ("loc", "rem"), (), AL, ("Assigned", "In Use"), "Available"),
    "repair": ActionDef("Send for repair", ("rem",), (), ("Asset",), ("Available", "Assigned", "In Use"), "Under Repair"),
    "fixed": ActionDef("Repair completed", ("loc", "rem"), (), ("Asset",), ("Under Repair",), "Available"),
    "renew": ActionDef("Record renewal", ("due", "cost", "rem"), ("due",), ("License",), ("Available", "Assigned", "In Use", "Expired")),
    "in": ActionDef("Stock in", ("q", "why", "rem"), ("q", "why"), ("Spare",), ("Available",)),
    "out": ActionDef("Stock out", ("q", "why", "user", "rem"), ("q", "why"), ("Spare",), ("Available",)),
    "dispose": ActionDef("Dispose", ("rem",), ("rem",), AL, ("Available", "Under Repair", "Expired"), "Disposed"),
    "off": ActionDef("Deactivate", ("rem",)),
    "on": ActionDef("Reactivate", ("rem",)),
}

CATEGORIES = ("Asset", "License", "Spare")
PREFIX = {"Asset": "AST", "License": "LIC", "Spare": "SPR"}
BASE = {"Asset": 1000, "License": 200, "Spare": 300}
CREATE_STATUSES = ("Available", "Assigned", "In Use")

# Fields people may send when adding or editing an item (keys are the names the frontend uses).
TEXT_FIELDS = ("desc", "make", "model", "sn", "mg", "project", "vendor", "loc", "oic", "user", "dept", "remarks", "winfo", "use")
NUM_FIELDS = ("qty", "min", "cost")
DATE_FIELDS = ("date", "due", "wdue")

# Required on create, by category.
REQUIRED = {
    "Asset": ("desc", "make", "model", "project", "loc", "oic"),
    "License": ("desc", "qty", "project", "loc", "oic", "due"),
    "Spare": ("desc", "qty", "min", "project", "loc", "oic"),
}
LABEL = {"desc": "Item name", "make": "Make", "model": "Model", "project": "Purchase project", "loc": "Location / site", "oic": "OIC responsible person",
         "qty": "Quantity", "min": "Reorder level", "due": "Expiry"}


def can_do(category: str, status: str, active: bool, action: str) -> bool:
    a = ACTIONS[action]
    if action == "on":
        return not active
    return active and (a.cats is None or category in a.cats) and (a.frm is None or status in a.frm)
