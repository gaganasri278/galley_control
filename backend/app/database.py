"""SQLAlchemy database engine, pooled PostgreSQL / SQLite session manager, and safe multi-tenant schema sync."""

from __future__ import annotations

import os
import threading
from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import Connection, Engine, create_engine, event, inspect, text
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings
from app.models import Base

_ENGINE_LOCK = threading.Lock()
_ENGINES: dict[str, Engine] = {}
_SESSION_FACTORIES: dict[str, sessionmaker] = {}


def _resolve_url(db_path: str | None = None) -> str:
    if db_path:
        abs_path = os.path.abspath(db_path).replace("\\", "/")
        return f"sqlite:///{abs_path}"
    return settings.get_database_url()


def get_engine(db_path: str | None = None) -> Engine:
    """Create or return cached SQLAlchemy Engine for PostgreSQL or SQLite."""
    url = _resolve_url(db_path)
    with _ENGINE_LOCK:
        engine = _ENGINES.get(url)
        if engine is not None:
            return engine

        if url.startswith("sqlite"):
            engine = create_engine(
                url,
                connect_args={"check_same_thread": False},
                future=True,
            )

            @event.listens_for(engine, "connect")
            def _enable_sqlite_fk(dbapi_conn, _conn_record):
                cursor = dbapi_conn.cursor()
                cursor.execute("PRAGMA foreign_keys = ON;")
                cursor.close()
        else:
            engine = create_engine(
                url,
                pool_pre_ping=True,
                pool_size=10,
                max_overflow=20,
                pool_recycle=1800,
                future=True,
            )

        _ENGINES[url] = engine
        _SESSION_FACTORIES[url] = sessionmaker(
            bind=engine,
            autoflush=False,
            autocommit=False,
            expire_on_commit=False,
        )
        return engine


def get_session_factory(db_path: str | None = None) -> sessionmaker:
    url = _resolve_url(db_path)
    get_engine(db_path)
    return _SESSION_FACTORIES[url]


@contextmanager
def db_session(db_path: str | None = None) -> Iterator[Session]:
    """Transactional SQLAlchemy session context manager."""
    factory = get_session_factory(db_path)
    session: Session = factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_db() -> Iterator[Session]:
    """FastAPI dependency yielding a managed database session."""
    with db_session() as session:
        yield session


DEFAULT_MENU_MEDIA: dict[str, tuple[str, str]] = {
    "Masala Dosa": (
        "Crispy golden fermented crepe stuffed with spiced potato masala, served with coconut chutney & sambar.",
        "https://images.unsplash.com/photo-1668236543090-82eba5ee5976?w=600&auto=format&fit=crop&q=80",
    ),
    "Idli Vada Combo": (
        "Steamed fluffy rice cakes and crispy golden medu vada served with traditional lentil sambar and chutneys.",
        "/static/uploads/menu/idli_vada_combo.jpg",
    ),
    "Paneer Roll": (
        "Char-grilled spiced cottage cheese chunks wrapped in flaky whole wheat paratha with mint relish.",
        "/static/uploads/menu/paneer_roll.jpeg",
    ),
    "Veg Fried Rice": (
        "Wok-tossed long-grain basmati rice with crunchy seasonal vegetables, scallions and aromatic Asian sauces.",
        "https://images.unsplash.com/photo-1603133872878-684f208fb84b?w=600&auto=format&fit=crop&q=80",
    ),
    "Veg Hakka Noodles": (
        "Classic street-style stir-fried wheat noodles with julienne veggies, garlic, soy sauce and white pepper.",
        "/static/uploads/menu/veg_hakka_noodles.jpg",
    ),
    "Cold Coffee": (
        "Thick, creamy chilled espresso blend infused with vanilla cream and chocolate drizzle.",
        "https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?w=600&auto=format&fit=crop&q=80",
    ),
    "Grilled Cheese Sandwich": (
        "Artisanal crusty sourdough filled with melted mozzarella and aged cheddar, toasted in herb butter.",
        "https://images.unsplash.com/photo-1528735602780-2552fd46c7af?w=600&auto=format&fit=crop&q=80",
    ),
    "Chicken Tikka Wrap": (
        "Tender tandoori chicken tikka cubes with pickled onions, crisp lettuce and spicy mayo in soft tortilla.",
        "/static/uploads/menu/chicken_tikka_wrap.jpg",
    ),
    "Fresh Lime Soda": (
        "Zesty fresh lime juice with club soda, rock salt, mint and organic sugar syrup.",
        "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=600&auto=format&fit=crop&q=80",
    ),
    "Egg Fried Rice": (
        "Fragrant wok-fried jasmine rice tossed with scrambled farm-fresh eggs, baby leeks and light soy.",
        "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=600&auto=format&fit=crop&q=80",
    ),
    "Maggi Masala Bowl": (
        "Comforting two-minute noodles loaded with diced vegetables, butter and extra roasted masala.",
        "https://images.unsplash.com/photo-1612927601601-6638404737ce?w=600&auto=format&fit=crop&q=80",
    ),
    "Ginger Chai": (
        "Strong freshly brewed Assam CTC tea simmered with crushed ginger root, cardamom and whole milk.",
        "/static/uploads/menu/ginger_chai.jpg",
    ),
}


def _backfill_menu_media(conn: Connection) -> None:
    if "menu_items" in set(inspect(conn).get_table_names()):
        for name, (desc, img) in DEFAULT_MENU_MEDIA.items():
            conn.execute(
                text(
                    "UPDATE menu_items SET description = COALESCE(description, :desc), "
                    "image_url = COALESCE(image_url, :img) WHERE name = :name"
                ),
                {"desc": desc, "img": img, "name": name},
            )


def _sync_missing_columns(target: Engine | Connection) -> None:
    """Add new relational & multi-tenant columns non-destructively and backfill legacy rows safely."""
    inspector = inspect(target)
    existing_tables = set(inspector.get_table_names())
    is_pg = target.dialect.name == "postgresql"
    ts_default = "TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP" if is_pg else "TEXT"
    ts_nullable = "TIMESTAMPTZ" if is_pg else "TEXT"
    bool_type = "BOOLEAN" if is_pg else "INTEGER"
    bool_true = "TRUE" if is_pg else "1"

    additive_columns: dict[str, list[tuple[str, str]]] = {
        "outlets": [
            ("organisation_id", "INTEGER"),
            ("created_at", ts_default),
        ],
        "users": [
            ("organisation_id", "INTEGER"),
            ("role_id", "INTEGER"),
            ("manager_approval_status", "VARCHAR(20) NOT NULL DEFAULT 'APPROVED'"),
            ("updated_at", ts_default),
        ],
        "user_sessions": [
            ("ip_address", "VARCHAR(64)"),
            ("user_agent", "VARCHAR(255)"),
        ],
        "menu_items": [
            ("organisation_id", "INTEGER"),
            ("is_available", f"{bool_type} NOT NULL DEFAULT {bool_true}"),
            ("description", "TEXT"),
            ("image_url", "VARCHAR(500)"),
            ("updated_at", ts_default),
        ],
        "inventory_movements": [
            ("organisation_id", "INTEGER"),
        ],
        "orders": [
            ("organisation_id", "INTEGER"),
            ("user_id", "INTEGER"),
            ("updated_at", ts_default),
        ],
        "order_items": [
            ("organisation_id", "INTEGER"),
        ],
        "qr_tokens": [
            ("organisation_id", "INTEGER"),
            ("verified_by_user_id", "INTEGER"),
            ("created_at", ts_default),
        ],
        "security_events": [
            ("organisation_id", "INTEGER"),
            ("resolved_by_user_id", "INTEGER"),
        ],
        "reviews": [
            ("organisation_id", "INTEGER"),
            ("user_id", "INTEGER"),
            ("resolved_by_user_id", "INTEGER"),
            ("resolved_at", ts_nullable),
        ],
        "ai_conversations": [
            ("organisation_id", "INTEGER"),
        ],
        "ai_messages": [
            ("organisation_id", "INTEGER"),
        ],
        "agent_activity_logs": [
            ("organisation_id", "INTEGER"),
        ],
        "ai_recommendations": [
            ("organisation_id", "INTEGER"),
            ("reviewed_by_user_id", "INTEGER"),
            ("reviewed_at", ts_nullable),
        ],
        "outlet_performance_snapshots": [
            ("organisation_id", "INTEGER"),
        ],
        "audit_logs": [
            ("organisation_id", "INTEGER"),
        ],
    }

    ts_backfill_cols = {
        "outlets": ["created_at"],
        "users": ["updated_at"],
        "menu_items": ["updated_at"],
        "orders": ["updated_at"],
        "qr_tokens": ["created_at"],
    }

    def _backfill_legacy_organisation(conn: Connection) -> None:
        """Preserve any pre-existing single-tenant data by assigning it to Default Campus Organisation."""
        if "organisations" not in existing_tables and not inspect(conn).has_table("organisations"):
            return

        has_unassigned_outlets = (
            "outlets" in existing_tables
            and conn.execute(text("SELECT COUNT(*) FROM outlets WHERE organisation_id IS NULL")).scalar_one() > 0
        )
        has_unassigned_users = (
            "users" in existing_tables
            and conn.execute(text("SELECT COUNT(*) FROM users WHERE role != 'admin' AND organisation_id IS NULL")).scalar_one() > 0
        )
        if not has_unassigned_outlets and not has_unassigned_users:
            return

        org_row = conn.execute(text("SELECT id FROM organisations ORDER BY id LIMIT 1")).first()
        if org_row:
            default_org_id = org_row[0]
        else:
            conn.execute(
                text(
                    "INSERT INTO organisations (name, slug, campus_location, contact_email, status) "
                    "VALUES (:n, :s, :loc, :em, 'ACTIVE')"
                ),
                {
                    "n": "Main Campus Canteen Network",
                    "s": "main-campus",
                    "loc": "Central University Campus",
                    "em": "campus-ops@galley.edu",
                },
            )
            default_org_id = conn.execute(
                text("SELECT id FROM organisations WHERE slug = 'main-campus'")
            ).scalar_one()

        for tbl in (
            "outlets",
            "menu_items",
            "inventory_movements",
            "orders",
            "order_items",
            "qr_tokens",
            "security_events",
            "reviews",
            "ai_conversations",
            "ai_messages",
            "agent_activity_logs",
            "ai_recommendations",
            "outlet_performance_snapshots",
            "audit_logs",
        ):
            if tbl in set(inspect(conn).get_table_names()):
                conn.execute(
                    text(f"UPDATE {tbl} SET organisation_id = :oid WHERE organisation_id IS NULL"),
                    {"oid": default_org_id},
                )

        if "users" in existing_tables:
            conn.execute(
                text(
                    "UPDATE users SET organisation_id = :oid WHERE role != 'admin' AND organisation_id IS NULL"
                ),
                {"oid": default_org_id},
            )

    def _apply(conn: Connection) -> None:
        for table_name, cols in additive_columns.items():
            if table_name not in existing_tables:
                continue
            present = {c["name"] for c in inspector.get_columns(table_name)}
            for col_name, ddl in cols:
                if col_name not in present:
                    conn.execute(
                        text(f"ALTER TABLE {table_name} ADD COLUMN {col_name} {ddl}")
                    )
                    if col_name in ts_backfill_cols.get(table_name, ()):
                        conn.execute(
                            text(
                                f"UPDATE {table_name} SET {col_name} = CURRENT_TIMESTAMP WHERE {col_name} IS NULL"
                            )
                        )
        _backfill_legacy_organisation(conn)
        _backfill_menu_media(conn)

    if isinstance(target, Connection):
        _apply(target)
    else:
        with target.begin() as conn:
            _apply(conn)


def init_db(db_path: str | None = None) -> None:
    """Create missing tables and apply non-destructive additive & multi-tenant schema upgrades."""
    engine = get_engine(db_path)
    Base.metadata.create_all(bind=engine)
    _sync_missing_columns(engine)


def get_database_dialect(db_path: str | None = None) -> str:
    return get_engine(db_path).dialect.name
