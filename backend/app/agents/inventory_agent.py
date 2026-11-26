"""Inventory Agent: monitors live stock alerts and historical/sample demand signals."""

from __future__ import annotations

from sqlalchemy import Numeric, cast, func, select
from sqlalchemy.orm import Session

from app.models import MenuItem, Order, Outlet


def get_inventory_intelligence(
    db: Session,
    outlet_id: int | None = None,
    organisation_id: int | None = None,
) -> dict:
    """Inspect live stock levels (scoped by organisation/outlet) and demand/waste signals."""
    stmt = (
        select(MenuItem, Outlet.name.label("outlet_name"))
        .join(Outlet, Outlet.id == MenuItem.outlet_id)
        .order_by(MenuItem.stock_qty.asc())
    )
    if organisation_id is not None:
        stmt = stmt.where(MenuItem.organisation_id == organisation_id)
    if outlet_id is not None:
        stmt = stmt.where(MenuItem.outlet_id == outlet_id)

    rows = db.execute(stmt).all()
    sub_ids = {mi.substitute_item_id for mi, _ in rows if mi.substitute_item_id}
    subs_by_id: dict[int, str] = {}
    if sub_ids:
        for s in db.execute(select(MenuItem).where(MenuItem.id.in_(sub_ids))).scalars().all():
            subs_by_id[s.id] = s.name

    items = [
        {
            "id": mi.id,
            "outlet_id": mi.outlet_id,
            "outlet_name": outlet_name,
            "name": mi.name,
            "category": mi.category,
            "price": mi.price,
            "stock_qty": mi.stock_qty,
            "substitute_name": subs_by_id.get(mi.substitute_item_id) if mi.substitute_item_id else None,
        }
        for mi, outlet_name in rows
    ]

    out_of_stock = [i for i in items if i["stock_qty"] <= 0]
    low_stock = [i for i in items if 0 < i["stock_qty"] <= 12]
    high_stock_perishables = [i for i in items if i["stock_qty"] >= 28]

    slot_expr = func.coalesce(Order.scheduled_slot, "ASAP")
    slot_stmt = (
        select(
            slot_expr.label("slot"),
            func.count(Order.id).label("order_count"),
            func.round(
                cast(func.coalesce(func.sum(Order.total_amount), 0.0), Numeric), 2
            ).label("revenue"),
        )
        .where(Order.is_sample.is_(True))
        .group_by(slot_expr)
        .order_by(func.count(Order.id).desc())
    )
    if organisation_id is not None:
        slot_stmt = slot_stmt.where(Order.organisation_id == organisation_id)
    if outlet_id is not None:
        slot_stmt = slot_stmt.where(Order.outlet_id == outlet_id)
    sample_slots = [
        {"slot": r.slot, "order_count": r.order_count, "revenue": float(r.revenue or 0.0)}
        for r in db.execute(slot_stmt).all()
    ]

    stock_recommendations = []
    for oos in out_of_stock:
        stock_recommendations.append(
            {
                "type": "SHORTAGE_ALERT",
                "outlet": oos["outlet_name"],
                "item": oos["name"],
                "message": f"{oos['name']} is out of stock. Ordering Agent is routing students to {oos['substitute_name'] or 'alternatives'}.",
                "is_sample": False,
            }
        )
    for hs in high_stock_perishables[:3]:
        stock_recommendations.append(
            {
                "type": "WASTE_WATCH_SAMPLE",
                "outlet": hs["outlet_name"],
                "item": hs["name"],
                "message": f"{hs['name']} carries {hs['stock_qty']} units—monitor evening turnover to prevent perishable waste (heuristic).",
                "is_sample": True,
            }
        )

    return {
        "agent": "Inventory Agent",
        "outlet_scope_id": outlet_id,
        "out_of_stock_count": len(out_of_stock),
        "low_stock_count": len(low_stock),
        "out_of_stock_items": [i["name"] for i in out_of_stock],
        "low_stock_items": [
            {"name": i["name"], "qty": i["stock_qty"], "outlet": i["outlet_name"]}
            for i in low_stock
        ],
        "all_items": [{"id": i["id"], "name": i["name"], "qty": i["stock_qty"], "outlet": i["outlet_name"], "price": i["price"]} for i in items],
        "sample_demand_by_slot": sample_slots,
        "recommendations": stock_recommendations,
    }
