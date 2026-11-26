"""Outlet Performance Agent: evaluates outlets, detects bottlenecks with Queue & Review Agents, and drafts recommendations."""

from __future__ import annotations

from sqlalchemy import Numeric, case, cast, func, select
from sqlalchemy.orm import Session

from app.models import Order, Outlet, OutletPerformanceSnapshot, Review


def evaluate_outlets(
    db: Session,
    feedback_ctx: dict,
    queue_ctx: dict,
    outlet_id: int | None = None,
    organisation_id: int | None = None,
    persist_snapshot: bool = False,
) -> dict:
    """Compute per-outlet operational KPIs and identify bottlenecks within tenant scope."""
    stmt = select(Outlet).order_by(Outlet.id)
    if organisation_id is not None:
        stmt = stmt.where(Outlet.organisation_id == organisation_id)
    if outlet_id is not None:
        stmt = stmt.where(Outlet.id == outlet_id)
    outlets = db.execute(stmt).scalars().all()

    queue_by_id = {q["outlet_id"]: q for q in queue_ctx.get("outlet_queues", [])}
    recurring_by_outlet: dict[int, list[dict]] = {}
    for rec in feedback_ctx.get("recurring_complaints", []):
        recurring_by_outlet.setdefault(rec["outlet_id"], []).append(rec)

    evaluations = []
    for o in outlets:
        oid = o.id
        stats = db.execute(
            select(
                func.count(Order.id).label("total_orders"),
                func.coalesce(
                    func.sum(case((Order.is_sample.is_(False), 1), else_=0)), 0
                ).label("live_orders"),
                func.coalesce(
                    func.sum(case((Order.order_status == "CANCELLED", 1), else_=0)), 0
                ).label("cancelled_orders"),
                func.round(
                    cast(
                        func.coalesce(
                            func.sum(
                                case((Order.order_status != "CANCELLED", Order.total_amount), else_=0.0)
                            ),
                            0.0,
                        ),
                        Numeric,
                    ),
                    2,
                ).label("total_sales"),
                func.round(
                    cast(
                        func.coalesce(func.avg(Order.estimated_wait_minutes), o.avg_prep_minutes),
                        Numeric,
                    ),
                    1,
                ).label("avg_completion_minutes"),
            ).where(Order.outlet_id == oid)
        ).one()

        rev_stats = db.execute(
            select(
                func.count(Review.id).label("review_cnt"),
                func.coalesce(
                    func.sum(case((Review.sentiment == "NEGATIVE", 1), else_=0)), 0
                ).label("neg_cnt"),
                func.round(
                    cast(func.coalesce(func.avg(Review.rating), 0.0), Numeric), 2
                ).label("avg_rating"),
            ).where(Review.outlet_id == oid)
        ).one()

        total_orders = int(stats.total_orders or 0)
        cancels = int(stats.cancelled_orders or 0)
        cancel_rate = round((cancels / total_orders) * 100, 1) if total_orders > 0 else 0.0
        rev_cnt = int(rev_stats.review_cnt or 0)
        neg_cnt = int(rev_stats.neg_cnt or 0)
        complaint_rate = round((neg_cnt / rev_cnt) * 100, 1) if rev_cnt > 0 else 0.0

        q_info = queue_by_id.get(oid, {})
        rec_issues = recurring_by_outlet.get(oid, [])

        bottleneck = "None detected"
        recommendation = "Maintain current prep staffing and batching cadence."
        if rec_issues:
            top_cat = rec_issues[0]["category"]
            bottleneck = f"Recurring '{top_cat}' complaints ({rec_issues[0]['open_complaints']} open)"
            if top_cat == "Waiting Time":
                recommendation = f"Enable prep batching & pre-prep top items before rush at {o.name}."
            elif top_cat == "Hygiene":
                recommendation = f"Schedule mid-break counter sanitization check at {o.name}."
            else:
                recommendation = f"Review {top_cat.lower()} workflow with {o.name} supervisor."
        elif q_info.get("congestion_level") == "HIGH":
            bottleneck = f"Active queue congestion ({q_info.get('active_queue_orders', 0)} queued)"
            recommendation = q_info.get("batching_advice", "Re-balance orders to quieter outlets.")
        elif cancel_rate >= 25.0:
            bottleneck = f"Elevated cancellation rate ({cancel_rate}%)"
            recommendation = f"Audit prep bottlenecks and stockouts causing cancellations at {o.name}."

        entry = {
            "outlet_id": oid,
            "outlet_name": o.name,
            "location": o.location,
            "status": o.status,
            "total_orders": total_orders,
            "live_orders": int(stats.live_orders or 0),
            "total_sales": float(stats.total_sales or 0.0),
            "avg_completion_minutes": float(stats.avg_completion_minutes or o.avg_prep_minutes),
            "cancel_rate_pct": cancel_rate,
            "complaint_rate_pct": complaint_rate,
            "avg_rating": float(rev_stats.avg_rating or 0.0),
            "congestion_level": q_info.get("congestion_level", "LOW"),
            "bottleneck": bottleneck,
            "recommended_action": recommendation,
        }
        evaluations.append(entry)

        if persist_snapshot:
            db.add(
                OutletPerformanceSnapshot(
                    organisation_id=o.organisation_id,
                    outlet_id=oid,
                    total_orders=entry["total_orders"],
                    live_orders=entry["live_orders"],
                    total_sales=entry["total_sales"],
                    avg_completion_minutes=entry["avg_completion_minutes"],
                    cancel_rate_pct=entry["cancel_rate_pct"],
                    complaint_rate_pct=entry["complaint_rate_pct"],
                    avg_rating=entry["avg_rating"],
                    congestion_level=entry["congestion_level"],
                    bottleneck=entry["bottleneck"],
                )
            )

    return {
        "agent": "Outlet Performance Agent",
        "outlets": evaluations,
    }
