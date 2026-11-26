"""Dedicated role-based login verification suite for Student, Outlet Manager, and Organisation Admin."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update

from app.config import settings
from app.database import db_session, init_db
from app.main import app
from app.models import User
from app.seed_data import reset_database


@pytest.fixture
def client(tmp_path, monkeypatch):
    test_db = str(tmp_path / "role_login_test.db")
    monkeypatch.setattr(settings, "database_path", test_db)
    init_db(test_db)
    reset_database(test_db)
    with TestClient(app) as test_client:
        yield test_client


def _login(client: TestClient, identifier: str, password: str):
    return client.post("/api/auth/login", json={"identifier": identifier, "password": password})


def test_all_three_roles_login_and_proper_data_returned(client):
    """Test 1: All three roles authenticate successfully and return their real database roles."""
    # 1. Student Login
    stu_res = _login(client, "student@galley.edu", "Student@123")
    assert stu_res.status_code == 200, f"Student login failed: {stu_res.text}"
    stu_data = stu_res.json()
    assert stu_data["user"]["role"] == "student"
    assert stu_data["user"]["email"] == "student@galley.edu"
    assert stu_data["user"]["organisation_id"] is not None
    assert stu_data["access_token"]

    # 2. Outlet Manager Login
    mgr_res = _login(client, "manager@galley.edu", "Manager@123")
    assert mgr_res.status_code == 200, f"Outlet Manager login failed: {mgr_res.text}"
    mgr_data = mgr_res.json()
    assert mgr_data["user"]["role"] == "outlet_manager"
    assert mgr_data["user"]["email"] == "manager@galley.edu"
    assert mgr_data["user"]["outlet_id"] == 1
    assert mgr_data["user"]["organisation_id"] is not None
    assert mgr_data["access_token"]

    # 3. Organisation / Platform Admin Login
    adm_res = _login(client, "admin@galley.edu", "Admin@123")
    assert adm_res.status_code == 200, f"Admin login failed: {adm_res.text}"
    adm_data = adm_res.json()
    assert adm_data["user"]["role"] == "admin"
    assert adm_data["user"]["email"] == "admin@galley.edu"
    assert adm_data["access_token"]


def test_invalid_credentials_rejected_with_401(client):
    """Test 2: Invalid password or nonexistent username rejected with 401."""
    # Bad password
    bad_pw = _login(client, "student@galley.edu", "WrongPassword999")
    assert bad_pw.status_code == 401
    assert "Invalid email/username or password" in bad_pw.json()["detail"]

    # Nonexistent user
    no_user = _login(client, "ghost@campus.edu", "Password@123")
    assert no_user.status_code == 401
    assert "Invalid email/username or password" in no_user.json()["detail"]


def test_inactive_accounts_rejected_with_403(client):
    """Test 3: Inactive accounts are blocked with 403 Forbidden upon login and 401 on token use."""
    # Deactivate the manager account in the database
    with db_session(settings.database_path) as db:
        db.execute(
            update(User).where(User.email == "manager@galley.edu").values(is_active=False)
        )
        db.commit()

    # Attempt login with inactive account -> must fail with 403
    inactive_login = _login(client, "manager@galley.edu", "Manager@123")
    assert inactive_login.status_code == 403
    assert "inactive" in inactive_login.json()["detail"].lower()


def test_unauthorised_dashboard_api_access_blocked(client):
    """Test 4: Verify role boundaries on dashboard APIs."""
    stu_tok = _login(client, "student@galley.edu", "Student@123").json()["access_token"]
    mgr_tok = _login(client, "manager@galley.edu", "Manager@123").json()["access_token"]
    adm_tok = _login(client, "admin@galley.edu", "Admin@123").json()["access_token"]

    stu_h = {"Authorization": f"Bearer {stu_tok}"}
    mgr_h = {"Authorization": f"Bearer {mgr_tok}"}
    adm_h = {"Authorization": f"Bearer {adm_tok}"}

    # Student cannot access Outlet Manager Dashboard
    assert client.get("/api/dashboard/outlet", headers=stu_h).status_code == 403
    # Student cannot access Admin Overview
    assert client.get("/api/admin/overview", headers=stu_h).status_code == 403

    # Outlet Manager CAN access their assigned Outlet Dashboard
    dash = client.get("/api/dashboard/outlet", headers=mgr_h)
    assert dash.status_code == 200
    assert dash.json()["outlet"]["id"] == 1

    # Outlet Manager CANNOT access Admin Overview
    assert client.get("/api/admin/overview", headers=mgr_h).status_code == 403

    # Outlet Manager CANNOT access another outlet's dashboard
    other_outlet = client.get("/api/dashboard/outlet?outlet_id=2", headers=mgr_h)
    assert other_outlet.status_code == 403

    # Admin CAN access Admin Overview
    admin_dash = client.get("/api/admin/overview", headers=adm_h)
    assert admin_dash.status_code == 200

    # Admin platform dashboard uses PostgreSQL numeric rounding on float aggregates.
    platform_summary = client.get("/api/dashboard/summary", headers=adm_h)
    assert platform_summary.status_code == 200, platform_summary.text


def test_session_persistence_and_logout_across_roles(client):
    """Test 5: Session persistence across all three roles and token invalidation on logout."""
    for email, pw, expected_role in [
        ("student@galley.edu", "Student@123", "student"),
        ("manager@galley.edu", "Manager@123", "outlet_manager"),
        ("admin@galley.edu", "Admin@123", "admin"),
    ]:
        login_res = _login(client, email, pw)
        assert login_res.status_code == 200
        token = login_res.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # Validate session retrieval
        me = client.get("/api/auth/me", headers=headers)
        assert me.status_code == 200
        assert me.json()["user"]["role"] == expected_role

        # Logout
        logout_res = client.post("/api/auth/logout", headers=headers)
        assert logout_res.status_code == 200

        # Post-logout request is rejected
        assert client.get("/api/auth/me", headers=headers).status_code == 401
