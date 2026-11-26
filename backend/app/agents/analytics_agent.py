"""Analytics Agent: consolidates daily business reports and campus demand heatmaps."""

from __future__ import annotations

from sqlalchemy import Numeric, case, cast, func, select
from sqlalchemy.orm import Session

from app.models import Order, Outlet

SLOTS = ("09:00", "11:00", "13:00", "17:00", "19:00", "ASAP")


def build_analytics_report(
    db: Session,
    inventory_ctx: dict,
    outlet_ctx: dict,
    feedback_ctx: dict,
    security_ctx: dict,
    organisation_id: int | None = None,
) -> dict:
    """Create consolidated management report and time-slot x outlet demand heatmap."""
    outlet_stmt = select(Outlet).order_by(Outlet.id)
    if organisation_id is not None:
        outlet_stmt = outlet_stmt.where(Outlet.organisation_id == organisation_id)
    outlets = db.execute(outlet_stmt).scalars().all()

    slot_expr = func.coalesce(Order.scheduled_slot, "ASAP")
    stmt = (
        select(
            Order.outlet_id,
            slot_expr.label("slot"),
            func.count(Order.id).label("order_cnt"),
            func.coalesce(func.sum(case((Order.is_sample.is_(True), 1), else_=0)), 0).label("sample_cnt"),
            func.coalesce(func.sum(case((Order.is_sample.is_(False), 1), else_=0)), 0).label("live_cnt"),
            func.round(
                cast(func.coalesce(func.sum(Order.total_amount), 0.0), Numeric), 2
            ).label("sales"),
        )
        .where(Order.order_status != "CANCELLED")
    )
    if organisation_id is not None:
        stmt = stmt.where(Order.organisation_id == organisation_id)
    rows = db.execute(stmt.group_by(Order.outlet_id, slot_expr)).all()

    cell_lookup: dict[tuple[int, str], dict] = {}
    for r in rows:
        raw_slot = r.slot or "ASAP"
        slot_key = (
            "11:00"
            if "11:00" in raw_slot
            else "13:00"
            if "13:00" in raw_slot
            else "17:00"
            if "17:00" in raw_slot
            else raw_slot
        )
        if slot_key not in SLOTS:
            slot_key = "ASAP"
        k = (r.outlet_id, slot_key)
        prev = cell_lookup.get(k, {"orders": 0, "sample": 0, "live": 0, "sales": 0.0})
        cell_lookup[k] = {
            "orders": prev["orders"] + int(r.order_cnt),
            "sample": prev["sample"] + int(r.sample_cnt or 0),
            "live": prev["live"] + int(r.live_cnt or 0),
            "sales": round(prev["sales"] + float(r.sales or 0.0), 2),
        }

    heatmap = []
    for o in outlets:
        slot_cells = []
        for s in SLOTS:
            val = cell_lookup.get((o.id, s), {"orders": 0, "sample": 0, "live": 0, "sales": 0.0})
            slot_cells.append({"slot": s, **val})
        heatmap.append({"outlet_id": o.id, "outlet_name": o.name, "slots": slot_cells})

    total_live_orders = sum(o["live_orders"] for o in outlet_ctx.get("outlets", []))
    total_all_orders = sum(o["total_orders"] for o in outlet_ctx.get("outlets", []))
    total_sales = round(sum(o["total_sales"] for o in outlet_ctx.get("outlets", [])), 2)

    return {
        "agent": "Analytics Agent",
        "data_transparency": "Combined live orders + sample baseline orders (sample rows explicitly tagged).",
        "summary_metrics": {
            "total_orders_including_sample": total_all_orders,
            "live_orders": total_live_orders,
            "combined_revenue": total_sales,
            "avg_rating": feedback_ctx.get("avg_rating", 0),
            "out_of_stock_items": inventory_ctx.get("out_of_stock_count", 0),
            "open_security_reviews": security_ctx.get("pending_human_reviews", 0),
        },
        "demand_heatmap": heatmap,
    }
