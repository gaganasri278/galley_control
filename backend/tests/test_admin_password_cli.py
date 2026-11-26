from contextlib import contextmanager

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app import cli
from app.models import Base, User, UserSession
from app.services.auth_service import verify_password


@pytest.fixture
def cli_database(monkeypatch):
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)

    @contextmanager
    def test_db_session():
        db = factory()
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    monkeypatch.setattr(cli, "init_db", lambda: None)
    monkeypatch.setattr(cli, "db_session", test_db_session)
    with test_db_session() as db:
        admin = User(
            username="platformadmin",
            email="admin@example.com",
            full_name="Platform Admin",
            password_hash=cli.hash_password("Oldpass123"),
            role="admin",
            is_active=True,
        )
        db.add(admin)
        db.flush()
        db.add(
            UserSession(
                token_hash="active-session-hash",
                user_id=admin.id,
                expires_at="2099-01-01T00:00:00",
                revoked=False,
            )
        )
    yield factory
    engine.dispose()


def test_reset_admin_password_updates_hash_and_revokes_sessions(
    cli_database, monkeypatch
):
    monkeypatch.setattr(cli, "getpass", lambda _prompt: "Newpass123")
    monkeypatch.setattr(
        "sys.argv",
        ["galley-control", "reset-admin-password", "--email", "ADMIN@example.com"],
    )

    cli.main()

    with cli_database() as db:
        admin = db.execute(select(User).where(User.email == "admin@example.com")).scalar_one()
        session = db.get(UserSession, "active-session-hash")
        assert verify_password("Newpass123", admin.password_hash)
        assert session.revoked is True


def test_reset_admin_password_rejects_mismatched_confirmation(
    cli_database, monkeypatch
):
    passwords = iter(("Newpass123", "Different123"))
    monkeypatch.setattr(cli, "getpass", lambda _prompt: next(passwords))
    monkeypatch.setattr(
        "sys.argv",
        ["galley-control", "reset-admin-password", "--email", "admin@example.com"],
    )

    with pytest.raises(SystemExit, match="Passwords do not match"):
        cli.main()

    with cli_database() as db:
        admin = db.execute(select(User).where(User.email == "admin@example.com")).scalar_one()
        assert verify_password("Oldpass123", admin.password_hash)
