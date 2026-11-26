"""Central Orchestrator Agent: strictly tenant-isolated multi-turn AI and agent collaboration."""

from __future__ import annotations

import json
import uuid
from typing import Any, Iterator

import httpx
from fastapi import HTTPException
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.agents.analytics_agent import build_analytics_report
from app.agents.inventory_agent import get_inventory_intelligence
from app.agents.ordering_agent import query_menu_options
from app.agents.outlet_agent import evaluate_outlets
from app.agents.queue_agent import get_queue_status
from app.agents.review_agent import analyze_review_with_ai, get_feedback_intelligence
from app.agents.security_agent import get_security_summary
from app.agents.support_agent import handle_support_query
from app.config import settings
from app.models import (
    AiConversation,
    AiMessage,
    AiRecommendation,
    Order,
    OrderItem,
    Outlet,
    QrToken,
    Review,
)
from app.services.audit_service import record_agent_activity
from app.services.llm_client import chat_with_tools_and_history, stream_grounded_synthesis


def _load_user_orders(
    db: Session,
    user_id: int,
    organisation_id: int | None = None,
    limit: int = 10,
) -> list[dict[str, Any]]:
    stmt = (
        select(Order, Outlet.name.label("outlet_name"), QrToken.status.label("qr_status"))
        .join(Outlet, Outlet.id == Order.outlet_id)
        .outerjoin(QrToken, QrToken.order_id == Order.id)
        .where(Order.user_id == user_id, Order.is_sample.is_(False))
    )
    if organisation_id is not None:
        stmt = stmt.where(Order.organisation_id == organisation_id)
    rows = db.execute(stmt.order_by(Order.id.desc()).limit(limit)).all()

    results = []
    for ord_obj, outlet_name, qr_status in rows:
        items = db.execute(
            select(OrderItem).where(OrderItem.order_id == ord_obj.id)
        ).scalars().all()
        results.append(
            {
                "order_id": ord_obj.id,
                "order_code": ord_obj.order_code,
                "outlet_name": outlet_name,
                "order_status": ord_obj.order_status,
                "payment_status": ord_obj.payment_status,
                "qr_status": qr_status,
                "total_amount": ord_obj.total_amount,
                "scheduled_slot": ord_obj.scheduled_slot,
                "estimated_wait_minutes": ord_obj.estimated_wait_minutes,
                "items": [f"{i.quantity}x {i.item_name}" for i in items],
            }
        )
    return results


def _load_outlet_orders(
    db: Session,
    organisation_id: int | None,
    outlet_id: int | None = None,
    limit: int = 15,
) -> list[dict[str, Any]]:
    stmt = (
        select(Order, Outlet.name.label("outlet_name"), QrToken.status.label("qr_status"))
        .join(Outlet, Outlet.id == Order.outlet_id)
        .outerjoin(QrToken, QrToken.order_id == Order.id)
        .where(Order.is_sample.is_(False))
    )
    if organisation_id is not None:
        stmt = stmt.where(Order.organisation_id == organisation_id)
    if outlet_id is not None:
        stmt = stmt.where(Order.outlet_id == outlet_id)
    rows = db.execute(stmt.order_by(Order.id.desc()).limit(limit)).all()
    return [
        {
            "order_code": o.order_code,
            "student_name": o.student_name,
            "outlet_name": oname,
            "order_status": o.order_status,
            "qr_status": qst,
            "total_amount": o.total_amount,
            "scheduled_slot": o.scheduled_slot,
            "estimated_wait_minutes": o.estimated_wait_minutes,
        }
        for o, oname, qst in rows
    ]


def _resolve_safe_outlet_for_tenant(
    db: Session,
    requested_outlet_id: int | None,
    tenant_org_id: int | None,
) -> int | None:
    """Verify any requested outlet_id belongs to caller's organisation; return None if cross-tenant."""
    if requested_outlet_id is None:
        return None
    if tenant_org_id is None:
        return requested_outlet_id
    outlet = db.execute(
        select(Outlet).where(
            Outlet.id == requested_outlet_id,
            Outlet.organisation_id == tenant_org_id,
        )
    ).scalar_one_or_none()
    return outlet.id if outlet else None


def _build_role_tools(
    *,
    db: Session,
    role: str,
    user_id: int | None,
    tenant_org_id: int | None,
    assigned_outlet_id: int | None,
    agents_invoked: list[str],
    grounded_facts: dict[str, Any],
) -> tuple[list[dict[str, Any]], Any]:
    """Assemble tool schemas and executor strictly isolated to caller's server-verified tenant & role."""

    def _note(agent_name: str) -> None:
        if agent_name not in agents_invoked:
            agents_invoked.append(agent_name)

    tools: list[dict[str, Any]] = [
        {
            "name": "search_menu_and_outlets",
            "description": "Search live menu items, stock availability, prices, prep times, dietary filters, and smart substitutes within your organisation.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Dish keyword, dietary filter, or budget e.g. 'veg under 60'"},
                    "outlet_id": {"type": "integer", "description": "Optional outlet ID within your organisation"},
                },
                "required": ["query"],
            },
        },
        {
            "name": "get_queue_wait_times",
            "description": "Get live queue order counts, outlet status (OPEN/BUSY/CLOSED), prep waits, and fastest outlet within your organisation.",
            "parameters": {
                "type": "object",
                "properties": {
                    "outlet_id": {"type": "integer", "description": "Optional outlet ID within your organisation"},
                },
            },
        },
        {
            "name": "get_canteen_procedures",
            "description": "Retrieve verified procedures for ordering, simulated checkout, single-use QR pickup, and cancellation/refund policy.",
            "parameters": {"type": "object", "properties": {}},
        },
    ]

    if role in ("student", "admin") and user_id is not None:
        tools.append(
            {
                "name": "lookup_my_orders",
                "description": "Retrieve the current logged-in user's own orders, order codes, QR pass statuses, and estimated wait times.",
                "parameters": {"type": "object", "properties": {}},
            }
        )

    if role in ("outlet_manager", "admin"):
        tools.extend(
            [
                {
                    "name": "lookup_outlet_orders",
                    "description": "Retrieve recent live orders for your permitted outlet(s) inside your organisation.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "outlet_id": {"type": "integer", "description": "Optional outlet ID within permitted scope"},
                        },
                    },
                },
                {
                    "name": "get_inventory_status",
                    "description": "Retrieve exact stock quantities, out-of-stock alerts, and low-stock items within your permitted scope.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "outlet_id": {"type": "integer", "description": "Optional outlet ID within permitted scope"},
                        },
                    },
                },
                {
                    "name": "get_reviews_and_feedback",
                    "description": "Retrieve sentiment counts, 5-category feedback distribution, and recurring complaints within your permitted scope.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "outlet_id": {"type": "integer", "description": "Optional outlet ID within permitted scope"},
                        },
                    },
                },
                {
                    "name": "get_outlet_performance_insights",
                    "description": "Retrieve outlet KPIs, cancellation rates, queue congestion, detected bottlenecks, and improvement suggestions.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "outlet_id": {"type": "integer", "description": "Optional outlet ID within permitted scope"},
                        },
                    },
                },
            ]
        )

    def _scope_outlet(requested: int | None) -> tuple[int | None, str | None]:
        if role == "outlet_manager" and assigned_outlet_id is not None:
            if requested is not None and requested != assigned_outlet_id:
                return assigned_outlet_id, "Scoped strictly to your assigned outlet."
            return assigned_outlet_id, None
        if requested is not None:
            safe_oid = _resolve_safe_outlet_for_tenant(db, requested, tenant_org_id)
            if safe_oid is None:
                return None, "Requested outlet does not belong to your organisation."
            return safe_oid, None
        return None, None

    def executor(name: str, args: dict[str, Any]) -> dict[str, Any]:
        req_oid = args.get("outlet_id")
        if name == "search_menu_and_outlets":
            _note("Ordering Agent")
            safe_oid = _resolve_safe_outlet_for_tenant(db, req_oid, tenant_org_id)
            if req_oid is not None and safe_oid is None:
                return {"error": "Requested outlet belongs to another organisation."}
            res = query_menu_options(
                db,
                args.get("query", ""),
                outlet_id=safe_oid,
                organisation_id=tenant_org_id,
            )
            grounded_facts["menu"] = res
            return res

        if name == "get_queue_wait_times":
            _note("Queue Agent")
            safe_oid = _resolve_safe_outlet_for_tenant(db, req_oid, tenant_org_id)
            if req_oid is not None and safe_oid is None:
                return {"error": "Requested outlet belongs to another organisation."}
            res = get_queue_status(
                db, outlet_id=safe_oid, organisation_id=tenant_org_id
            )
            grounded_facts["queues"] = res
            return res

        if name == "get_canteen_procedures":
            _note("Support Agent")
            res = {
                "ordering": "Select one outlet inside your campus organisation, add in-stock items (or swap suggested substitutes), pick a slot, and complete simulated checkout.",
                "qr_pickup": "Each paid order generates a single-use QR pass verified at your pickup counter; duplicate scans are blocked automatically.",
                "cancellation": "Uncollected PLACED/PREPARING orders can be cancelled for instant simulated refund and stock restoration; collected orders escalate for manager review.",
            }
            grounded_facts["procedures"] = res
            return res

        if name == "lookup_my_orders" and role in ("student", "admin") and user_id is not None:
            _note("Ordering Agent")
            orders = _load_user_orders(db, user_id, organisation_id=tenant_org_id)
            grounded_facts["my_orders"] = orders
            return {"orders": orders}

        if name == "lookup_outlet_orders" and role in ("outlet_manager", "admin"):
            _note("Queue Agent")
            oid, err = _scope_outlet(req_oid)
            if err and role == "outlet_manager" and assigned_outlet_id is None:
                return {"error": err}
            orders = _load_outlet_orders(db, tenant_org_id, outlet_id=oid)
            grounded_facts["outlet_orders"] = orders
            return {"organisation_id": tenant_org_id, "outlet_id": oid, "orders": orders}

        if name == "get_inventory_status" and role in ("outlet_manager", "admin"):
            _note("Inventory Agent")
            oid, err = _scope_outlet(req_oid)
            if err and role == "outlet_manager" and assigned_outlet_id is None:
                return {"error": err}
            inv = get_inventory_intelligence(db, outlet_id=oid, organisation_id=tenant_org_id)
            grounded_facts["inventory"] = inv
            return inv

        if name == "get_reviews_and_feedback" and role in ("outlet_manager", "admin"):
            _note("Review & Feedback Agent")
            oid, err = _scope_outlet(req_oid)
            if err and role == "outlet_manager" and assigned_outlet_id is None:
                return {"error": err}
            fb = get_feedback_intelligence(db, outlet_id=oid, organisation_id=tenant_org_id)
            grounded_facts["feedback"] = fb
            return fb

        if name == "get_outlet_performance_insights" and role in ("outlet_manager", "admin"):
            _note("Outlet Performance Agent")
            oid, err = _scope_outlet(req_oid)
            if err and role == "outlet_manager" and assigned_outlet_id is None:
                return {"error": err}
            fb = get_feedback_intelligence(db, outlet_id=oid, organisation_id=tenant_org_id)
            q = get_queue_status(db, outlet_id=oid, organisation_id=tenant_org_id)
            perf = evaluate_outlets(db, fb, q, outlet_id=oid, organisation_id=tenant_org_id)
            grounded_facts["outlet_performance"] = perf
            if role == "admin" or (role == "outlet_manager" and assigned_outlet_id is None):
                _note("Analytics Agent")
                inv = get_inventory_intelligence(db, organisation_id=tenant_org_id)
                sec = get_security_summary(db, organisation_id=tenant_org_id)
                analytics = build_analytics_report(
                    db, inv, perf, fb, sec, organisation_id=tenant_org_id
                )
                grounded_facts["analytics"] = analytics["summary_metrics"]
                return {"outlet_performance": perf, "analytics": analytics["summary_metrics"]}
            return perf

        return {"error": f"Tool '{name}' is not permitted for role '{role}'."}

    return tools, executor


def _resolve_or_create_conversation(
    db: Session,
    *,
    user_id: int,
    organisation_id: int | None,
    role: str,
    conversation_id: int | None,
    first_message: str,
) -> tuple[AiConversation, list[dict[str, str]]]:
    if conversation_id is not None:
        conv = db.execute(
            select(AiConversation).where(
                AiConversation.id == conversation_id,
                AiConversation.user_id == user_id,
            )
        ).scalar_one_or_none()
        if not conv:
            raise HTTPException(
                status_code=404,
                detail="Conversation not found or does not belong to your account.",
            )
        prior_msgs = db.execute(
            select(AiMessage)
            .where(AiMessage.conversation_id == conv.id)
            .order_by(AiMessage.id.asc())
        ).scalars().all()
        history = [
            {"role": "assistant" if m.sender == "assistant" else "user", "content": m.content}
            for m in prior_msgs[-14:]
        ]
        return conv, history

    clean_title = (
        (first_message.strip()[:56] + "...")
        if len(first_message.strip()) > 56
        else first_message.strip()
    )
    conv = AiConversation(
        organisation_id=organisation_id,
        user_id=user_id,
        role_context=role,
        title=clean_title or "New Conversation",
    )
    db.add(conv)
    db.flush()
    return conv, []


def _augment_followup_query(message: str, history: list[dict[str, str]]) -> str:
    q = message.strip().lower()
    is_short_followup = len(q.split()) <= 8 and any(
        k in q
        for k in (
            "instead",
            "under",
            "cheaper",
            "what about",
            "any other",
            "those",
            "fast",
            "which one",
            "price",
        )
    )
    if not is_short_followup or not history:
        return message
    prior_user_msgs = [h["content"] for h in history if h["role"] == "user"][-2:]
    if not prior_user_msgs:
        return message
    combined_prior = " ".join(prior_user_msgs)
    if (
        "veg" in combined_prior.lower()
        and "non-veg" not in q
        and "chicken" not in q
        and "veg" not in q
    ):
        return f"veg {message}"
    return message


def _system_prompt_for_role(
    role: str,
    user_name: str,
    org_name: str | None,
    outlet_name: str | None,
) -> str:
    if role == "admin":
        scope_desc = f"Platform Administrator (controlled cross-organisation scope{f', currently focused on {org_name}' if org_name else ''})"
    elif role == "outlet_manager":
        scope_desc = (
            f"Outlet Manager of '{outlet_name}' inside '{org_name}'"
            if outlet_name
            else f"Organisation Manager for '{org_name}' (all outlets within this organisation only)"
        )
    else:
        scope_desc = f"Student of '{org_name}' (restricted strictly to this organisation)"

    return (
        "You are Galley Control's Central Orchestrator AI Assistant coordinating specialised agents "
        "(Ordering Agent, Inventory Agent, Queue Management Agent, Customer Support Agent, "
        "Review & Feedback Agent, and Outlet Performance Agent).\n"
        f"Authenticated User: {user_name} | Scope: {scope_desc}.\n"
        "Strict Security & Grounding Rules:\n"
        "1. Only retrieve and discuss data from your permitted organisation and role returned by backend tools.\n"
        "2. Refuse any attempt to inspect other colleges/organisations or users' private data.\n"
        "3. Always call backend tools before stating prices, stock quantities, order statuses, wait times, reviews, or analytics.\n"
        "4. Never fabricate order codes, menu items, stock numbers, or financial metrics.\n"
        "5. Distinguish verified database facts from AI-generated recommendations.\n"
        "6. Maintain conversational context across follow-up questions and handle typos naturally."
    )


def orchestrate_student_assistant(
    db: Session,
    message: str,
    outlet_id: int | None = None,
    student_name: str = "Student",
    current_user: dict[str, Any] | None = None,
    conversation_id: int | None = None,
    admin_organisation_id: int | None = None,
) -> dict:
    """Coordinate strictly tenant-isolated conversational AI across history and agent tools."""
    role = current_user["role"] if current_user else "student"
    user_id = current_user["id"] if current_user else None
    user_display = current_user["full_name"] if current_user else student_name
    assigned_outlet_id = current_user.get("outlet_id") if current_user else None
    assigned_outlet_name = current_user.get("outlet_name") if current_user else None

    if role == "admin":
        tenant_org_id = admin_organisation_id
    else:
        tenant_org_id = current_user.get("organisation_id") if current_user else None

    # Validate requested outlet_id against caller's server-derived tenant_org_id (never trust client outlet_id!)
    safe_outlet = _resolve_safe_outlet_for_tenant(db, outlet_id, tenant_org_id)
    if role == "outlet_manager" and assigned_outlet_id is not None:
        safe_outlet = assigned_outlet_id

    conv: AiConversation | None = None
    history: list[dict[str, str]] = []
    if user_id is not None:
        conv, history = _resolve_or_create_conversation(
            db,
            user_id=user_id,
            organisation_id=tenant_org_id,
            role=role,
            conversation_id=conversation_id,
            first_message=message,
        )

    effective_query = _augment_followup_query(message, history)

    ordering_ctx = query_menu_options(
        db, effective_query, outlet_id=safe_outlet, organisation_id=tenant_org_id
    )
    queue_ctx = get_queue_status(
        db,
        outlet_id=assigned_outlet_id if role == "outlet_manager" else None,
        organisation_id=tenant_org_id,
    )
    orders_ctx = (
        _load_user_orders(db, user_id, organisation_id=tenant_org_id)
        if (user_id is not None and role in ("student", "admin"))
        else None
    )

    inventory_ctx = (
        get_inventory_intelligence(db, outlet_id=safe_outlet, organisation_id=tenant_org_id)
        if role in ("outlet_manager", "admin")
        else None
    )
    feedback_ctx = (
        get_feedback_intelligence(db, outlet_id=safe_outlet, organisation_id=tenant_org_id)
        if role in ("outlet_manager", "admin")
        else None
    )
    outlet_ctx = (
        evaluate_outlets(
            db, feedback_ctx, queue_ctx, outlet_id=safe_outlet, organisation_id=tenant_org_id
        )
        if role in ("outlet_manager", "admin") and feedback_ctx is not None
        else None
    )

    agents_invoked: list[str] = ["Central Orchestrator Agent"]
    grounded_facts: dict[str, Any] = {
        "organisation_id": tenant_org_id,
        "menu_matches_count": len(ordering_ctx["available_items"]),
        "fastest_outlet": queue_ctx["recommended_fastest_outlet"],
    }

    tools, executor = _build_role_tools(
        db=db,
        role=role,
        user_id=user_id,
        tenant_org_id=tenant_org_id,
        assigned_outlet_id=assigned_outlet_id,
        agents_invoked=agents_invoked,
        grounded_facts=grounded_facts,
    )

    sys_prompt = _system_prompt_for_role(
        role,
        user_display,
        current_user.get("organisation_name") if current_user else None,
        assigned_outlet_name,
    )
    llm_res = chat_with_tools_and_history(
        system_prompt=sys_prompt,
        history=history,
        user_message=message,
        tools=tools,
        tool_executor=executor,
        max_tokens=700,
    )

    if llm_res["ok"] and llm_res["text"]:
        ai_mode = "live_llm"
        fallback_reason = None
        final_reply = llm_res["text"]
        intent = "AI_CONVERSATIONAL"
        if len(agents_invoked) == 1:
            agents_invoked.append("Support Agent")
    else:
        ai_mode = "deterministic_fallback"
        fallback_reason = llm_res.get("error") or "LLM provider unavailable."
        support_res = handle_support_query(
            effective_query,
            ordering_ctx,
            queue_ctx,
            user_role=role,
            orders_ctx=orders_ctx,
            inventory_ctx=inventory_ctx,
            feedback_ctx=feedback_ctx,
            outlet_ctx=outlet_ctx,
        )
        intent = support_res["intent"]
        final_reply = support_res["reply"]
        for ag in ("Ordering Agent", "Inventory Agent", "Queue Agent", "Support Agent"):
            if ag not in agents_invoked and (ag != "Inventory Agent" or role in ("outlet_manager", "admin")):
                agents_invoked.append(ag)
        if role in ("outlet_manager", "admin") and "Outlet Performance Agent" not in agents_invoked:
            agents_invoked.append("Outlet Performance Agent")

    suggested_items = ordering_ctx["available_items"][:4]
    substitutes = ordering_ctx["unavailable_with_substitutes"]
    if "menu" in grounded_facts:
        suggested_items = grounded_facts["menu"].get("available_items", suggested_items)[:4]
        substitutes = grounded_facts["menu"].get("unavailable_with_substitutes", substitutes)

    lifecycle = {
        "sense": f"Inspected live tenant DB (org_id={tenant_org_id}) across {len(queue_ctx['outlet_queues'])} outlet(s).",
        "think": f"Evaluated conversation context ({len(history)} prior turn(s)) and tenant-scoped agent tools.",
        "act": f"Coordinated {' -> '.join(agents_invoked)} ({ai_mode}).",
        "explain": "Distinguished live DB records from AI guidance.",
        "learn": "Persisted tenant-scoped conversation turn and agent telemetry.",
    }

    assistant_msg_id = None
    orch_id = uuid.uuid4().hex[:12]
    if conv is not None:
        db.add(
            AiMessage(
                organisation_id=tenant_org_id,
                conversation_id=conv.id,
                sender="user",
                content=message,
                ai_mode=ai_mode,
            )
        )
        asst_msg = AiMessage(
            organisation_id=tenant_org_id,
            conversation_id=conv.id,
            sender="assistant",
            content=final_reply,
            ai_mode=ai_mode,
            agents_invoked_json=json.dumps(agents_invoked),
            metadata_json=json.dumps(
                {
                    "intent": intent,
                    "fallback_reason": fallback_reason,
                    "suggested_items": suggested_items,
                    "substitutes": substitutes,
                    "fastest_outlet": queue_ctx["recommended_fastest_outlet"],
                    "agentic_lifecycle": lifecycle,
                },
                default=str,
            ),
        )
        db.add(asst_msg)
        db.flush()
        assistant_msg_id = asst_msg.id

    for ag in agents_invoked:
        record_agent_activity(
            db,
            organisation_id=tenant_org_id,
            agent_name=ag,
            orchestration_id=orch_id,
            action_type=intent,
            summary=f"{ai_mode}: {message[:120]}",
            user_id=user_id,
            outlet_id=safe_outlet,
            data_source_type="llm" if ai_mode == "live_llm" else "live_db",
        )
    db.flush()

    return {
        "conversation_id": conv.id if conv else None,
        "message_id": assistant_msg_id,
        "organisation_id": tenant_org_id,
        "orchestrator": "Central Orchestrator Agent",
        "reply": final_reply,
        "ai_mode": ai_mode,
        "provider": llm_res.get("provider"),
        "model": llm_res.get("model"),
        "fallback_reason": fallback_reason,
        "intent": intent,
        "suggested_items": suggested_items,
        "substitutes": substitutes,
        "fastest_outlet": queue_ctx["recommended_fastest_outlet"],
        "grounded_facts": grounded_facts,
        "agentic_lifecycle": lifecycle,
        "agents_invoked": agents_invoked,
    }


def orchestrate_chat_stream(
    message: str,
    outlet_id: int | None,
    current_user: dict[str, Any],
    conversation_id: int | None = None,
    admin_organisation_id: int | None = None,
) -> Iterator[str]:
    """Stream tenant-isolated SSE chunks from real LLM when configured, or fall back cleanly."""
    from app.database import db_session

    with db_session() as db:
        role = current_user["role"]
        user_id = current_user["id"]
        assigned_outlet_id = current_user.get("outlet_id")
        tenant_org_id = (
            admin_organisation_id if role == "admin" else current_user.get("organisation_id")
        )
        safe_outlet = _resolve_safe_outlet_for_tenant(db, outlet_id, tenant_org_id)
        if role == "outlet_manager" and assigned_outlet_id is not None:
            safe_outlet = assigned_outlet_id

        conv, history = _resolve_or_create_conversation(
            db,
            user_id=user_id,
            organisation_id=tenant_org_id,
            role=role,
            conversation_id=conversation_id,
            first_message=message,
        )

        ordering_ctx = query_menu_options(
            db,
            _augment_followup_query(message, history),
            outlet_id=safe_outlet,
            organisation_id=tenant_org_id,
        )
        queue_ctx = get_queue_status(
            db,
            outlet_id=assigned_outlet_id if role == "outlet_manager" else None,
            organisation_id=tenant_org_id,
        )
        orders_ctx = (
            _load_user_orders(db, user_id, organisation_id=tenant_org_id)
            if role in ("student", "admin")
            else None
        )
        inventory_ctx = (
            get_inventory_intelligence(db, outlet_id=safe_outlet, organisation_id=tenant_org_id)
            if role in ("outlet_manager", "admin")
            else None
        )
        feedback_ctx = (
            get_feedback_intelligence(db, outlet_id=safe_outlet, organisation_id=tenant_org_id)
            if role in ("outlet_manager", "admin")
            else None
        )
        outlet_ctx = (
            evaluate_outlets(
                db, feedback_ctx, queue_ctx, outlet_id=safe_outlet, organisation_id=tenant_org_id
            )
            if role in ("outlet_manager", "admin") and feedback_ctx is not None
            else None
        )

        grounded_context: dict[str, Any] = {
            "organisation_id": tenant_org_id,
            "menu": ordering_ctx,
            "queues": queue_ctx,
        }
        if orders_ctx is not None:
            grounded_context["my_orders"] = orders_ctx
        if inventory_ctx is not None:
            grounded_context["inventory"] = inventory_ctx
        if feedback_ctx is not None:
            grounded_context["feedback"] = feedback_ctx
        if outlet_ctx is not None:
            grounded_context["outlet_performance"] = outlet_ctx

        agents_invoked = ["Central Orchestrator Agent", "Ordering Agent", "Queue Agent", "Support Agent"]
        if role in ("outlet_manager", "admin"):
            agents_invoked.extend(["Inventory Agent", "Outlet Performance Agent", "Review & Feedback Agent"])

        yield f"data: {json.dumps({'type': 'meta', 'conversation_id': conv.id})}\n\n"

        chunks: list[str] = []
        ai_mode = "live_llm"
        fallback_reason = None

        if settings.llm_api_key:
            try:
                sys_prompt = _system_prompt_for_role(
                    role,
                    current_user["full_name"],
                    current_user.get("organisation_name"),
                    current_user.get("outlet_name"),
                )
                for delta in stream_grounded_synthesis(
                    system_prompt=sys_prompt,
                    history=history,
                    user_message=message,
                    grounded_context=grounded_context,
                ):
                    chunks.append(delta)
                    yield f"data: {json.dumps({'type': 'token', 'text': delta})}\n\n"
            except httpx.TimeoutException:
                fallback_reason = (
                    f"Streaming timed out after {settings.llm_timeout_seconds}s; switched to grounded fallback."
                )
            except httpx.HTTPStatusError as exc:
                code = exc.response.status_code
                if code == 429:
                    fallback_reason = "Gemini API rate limit or quota exceeded (HTTP 429); switched to grounded fallback."
                elif code in (401, 403):
                    fallback_reason = f"Invalid or unauthorized LLM API key (HTTP {code}); switched to grounded fallback."
                else:
                    fallback_reason = f"LLM streaming returned HTTP {code}; switched to grounded fallback."
            except Exception as exc:
                fallback_reason = f"Streaming interrupted ({type(exc).__name__}); switched to grounded fallback."

        if not chunks:
            ai_mode = "deterministic_fallback"
            if not settings.llm_api_key:
                fallback_reason = "LLM_API_KEY is not configured on the backend."
            fallback = handle_support_query(
                _augment_followup_query(message, history),
                ordering_ctx,
                queue_ctx,
                user_role=role,
                orders_ctx=orders_ctx,
                inventory_ctx=inventory_ctx,
                feedback_ctx=feedback_ctx,
                outlet_ctx=outlet_ctx,
            )
            chunks = [fallback["reply"]]
            yield f"data: {json.dumps({'type': 'token', 'text': fallback['reply']})}\n\n"

        full_text = "".join(chunks).strip()
        lifecycle = {
            "sense": f"Loaded live tenant DB snapshot (org_id={tenant_org_id}) across {len(queue_ctx['outlet_queues'])} outlet(s).",
            "think": f"Evaluated {len(history)} prior conversation turn(s) for role '{role}'.",
            "act": f"Streamed response via {' -> '.join(agents_invoked)} ({ai_mode}).",
            "explain": "Separated live tenant facts from conversational synthesis.",
            "learn": "Persisted tenant-scoped messages to database.",
        }

        db.add(
            AiMessage(
                organisation_id=tenant_org_id,
                conversation_id=conv.id,
                sender="user",
                content=message,
                ai_mode=ai_mode,
            )
        )
        asst_msg = AiMessage(
            organisation_id=tenant_org_id,
            conversation_id=conv.id,
            sender="assistant",
            content=full_text,
            ai_mode=ai_mode,
            agents_invoked_json=json.dumps(agents_invoked),
            metadata_json=json.dumps(
                {
                    "fallback_reason": fallback_reason,
                    "suggested_items": ordering_ctx["available_items"][:4],
                    "substitutes": ordering_ctx["unavailable_with_substitutes"],
                    "fastest_outlet": queue_ctx["recommended_fastest_outlet"],
                    "agentic_lifecycle": lifecycle,
                },
                default=str,
            ),
        )
        db.add(asst_msg)
        db.flush()

        yield f"data: {json.dumps({'type': 'done', 'conversation_id': conv.id, 'message_id': asst_msg.id, 'ai_mode': ai_mode, 'fallback_reason': fallback_reason, 'agents_invoked': agents_invoked, 'suggested_items': ordering_ctx['available_items'][:4], 'substitutes': ordering_ctx['unavailable_with_substitutes'], 'fastest_outlet': queue_ctx['recommended_fastest_outlet'], 'agentic_lifecycle': lifecycle}, default=str)}\n\n"


def orchestrate_review_to_action(
    db: Session,
    outlet_id: int,
    order_id: int | None,
    student_name: str,
    rating: int,
    comment: str,
    user_id: int | None = None,
) -> dict:
    """Process a student review strictly within the outlet's organisation scope."""
    outlet = db.execute(select(Outlet).where(Outlet.id == outlet_id)).scalar_one()
    org_id = outlet.organisation_id
    classification = analyze_review_with_ai(rating, comment)

    is_positive = rating >= 4 or classification["sentiment"] == "POSITIVE"
    rev = Review(
        organisation_id=org_id,
        outlet_id=outlet_id,
        order_id=order_id,
        user_id=user_id,
        student_name=student_name.strip(),
        rating=rating,
        comment=comment.strip(),
        sentiment=classification["sentiment"],
        category=classification["category"],
        is_resolved=is_positive,
        is_sample=False,
    )
    db.add(rev)
    db.flush()

    feedback_ctx = get_feedback_intelligence(db, organisation_id=org_id)
    queue_ctx = get_queue_status(db, organisation_id=org_id)
    outlet_ctx = evaluate_outlets(db, feedback_ctx, queue_ctx, organisation_id=org_id)

    outlet_eval = next((o for o in outlet_ctx["outlets"] if o["outlet_id"] == outlet_id), None)
    matching_recurring = [
        r
        for r in feedback_ctx["recurring_complaints"]
        if r["outlet_id"] == outlet_id and r["category"] == classification["category"]
    ]

    recommendation_created = None
    if matching_recurring and outlet_eval:
        rec_title = f"[{outlet_eval['outlet_name']}] Address recurring '{classification['category']}' issue"
        existing = db.execute(
            select(AiRecommendation).where(
                AiRecommendation.organisation_id == org_id,
                AiRecommendation.outlet_id == outlet_id,
                AiRecommendation.title == rec_title,
                AiRecommendation.status == "PENDING_APPROVAL",
            )
        ).scalar_one_or_none()
        if not existing:
            rationale = (
                f"Review & Feedback Agent flagged {matching_recurring[0]['open_complaints']} open complaints "
                f"in '{classification['category']}'. Collaborated with Queue Agent (congestion: "
                f"{outlet_eval['congestion_level']}). Suggested fix: {outlet_eval['recommended_action']}"
            )
            rec = AiRecommendation(
                organisation_id=org_id,
                source_agent="Review + Outlet + Queue Agents",
                outlet_id=outlet_id,
                title=rec_title,
                rationale=rationale,
                status="PENDING_APPROVAL",
                is_sample=False,
            )
            db.add(rec)
            db.flush()
            recommendation_created = {
                "id": rec.id,
                "title": rec_title,
                "rationale": rationale,
                "status": "PENDING_APPROVAL",
            }

    record_agent_activity(
        db,
        organisation_id=org_id,
        agent_name="Review & Feedback Agent",
        orchestration_id=uuid.uuid4().hex[:12],
        action_type="REVIEW_TRIAGE",
        summary=f"Classified review #{rev.id} ({classification['sentiment']} / {classification['category']}).",
        user_id=user_id,
        outlet_id=outlet_id,
    )
    db.flush()

    return {
        "review_id": rev.id,
        "sentiment": classification["sentiment"],
        "category": classification["category"],
        "recurring_alert": bool(matching_recurring),
        "recommendation_created": recommendation_created,
        "agents_invoked": [
            "Central Orchestrator Agent",
            "Review & Feedback Agent",
            "Outlet Performance Agent",
            "Queue Agent",
        ],
    }


def orchestrate_dashboard_summary(
    db: Session,
    organisation_id: int | None = None,
) -> dict:
    """Consolidate telemetry from Central Orchestrator and all 8 specialised agents within tenant scope."""
    inventory_ctx = get_inventory_intelligence(db, organisation_id=organisation_id)
    queue_ctx = get_queue_status(db, organisation_id=organisation_id)
    feedback_ctx = get_feedback_intelligence(db, organisation_id=organisation_id)
    security_ctx = get_security_summary(db, organisation_id=organisation_id)
    outlet_ctx = evaluate_outlets(
        db, feedback_ctx, queue_ctx, organisation_id=organisation_id, persist_snapshot=True
    )
    analytics_ctx = build_analytics_report(
        db, inventory_ctx, outlet_ctx, feedback_ctx, security_ctx, organisation_id=organisation_id
    )

    rec_stmt = (
        select(AiRecommendation, Outlet.name.label("outlet_name"))
        .outerjoin(Outlet, Outlet.id == AiRecommendation.outlet_id)
    )
    if organisation_id is not None:
        rec_stmt = rec_stmt.where(AiRecommendation.organisation_id == organisation_id)
    rec_rows = db.execute(
        rec_stmt.order_by(AiRecommendation.is_sample.asc(), desc(AiRecommendation.id))
    ).all()

    recommendations = [
        {
            "id": a.id,
            "organisation_id": a.organisation_id,
            "source_agent": a.source_agent,
            "outlet_id": a.outlet_id,
            "outlet_name": oname,
            "title": a.title,
            "rationale": a.rationale,
            "status": a.status,
            "is_sample": int(bool(a.is_sample)),
            "created_at": a.created_at.isoformat() if a.created_at else None,
        }
        for a, oname in rec_rows
    ]

    return {
        "organisation_id": organisation_id,
        "orchestrator": "Central Orchestrator Agent",
        "active_agents": [
            "Ordering Agent",
            "Inventory Agent",
            "Security Agent",
            "Queue Agent",
            "Support Agent",
            "Analytics Agent",
            "Outlet Performance Agent",
            "Review & Feedback Agent",
        ],
        "inventory": inventory_ctx,
        "queues": queue_ctx,
        "feedback": feedback_ctx,
        "security": security_ctx,
        "outlet_performance": outlet_ctx,
        "analytics": analytics_ctx,
        "recommendations": recommendations,
    }
