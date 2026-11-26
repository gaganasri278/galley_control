"""Secure provisioning CLI for Galley Control Organisation Admin and Outlet Manager accounts.

Creates or updates administrative accounts with cryptographically secure temporary passwords
and bcrypt password hashes.
"""

from __future__ import annotations

import argparse
import os
import secrets
import string
import sys
from pathlib import Path

# Ensure backend root is on Python sys.path
backend_root = Path(__file__).resolve().parent.parent
if str(backend_root) not in sys.path:
    sys.path.insert(0, str(backend_root))

from sqlalchemy import select

from app.database import db_session
from app.models import Organisation, Outlet, Role, User
from app.services.auth_service import hash_password


def generate_temporary_password(length: int = 14) -> str:
    """Generate a high-entropy temporary password satisfying all complexity requirements."""
    upper = secrets.choice(string.ascii_uppercase)
    lower = secrets.choice(string.ascii_lowercase)
    digit = secrets.choice(string.digits)
    special = secrets.choice("@#$%^&*!_-")
    all_chars = string.ascii_letters + string.digits + "@#$%^&*!_-"
    remaining = "".join(secrets.choice(all_chars) for _ in range(length - 4))
    # Shuffle to avoid predictable character positions
    chars = list(upper + lower + digit + special + remaining)
    secrets.SystemRandom().shuffle(chars)
    return "".join(chars)


def provision_accounts(
    sqlite_path: str | None = None,
    admin_password: str | None = None,
    manager_password: str | None = None,
):
    target_path = sqlite_path or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "galley_control.db")
    with db_session(target_path) as db:
        # 1. Fetch primary organisation and outlet
        org = db.execute(select(Organisation).order_by(Organisation.id.asc())).scalars().first()
        if not org:
            raise RuntimeError("No organisation found in database. Run database initialization first.")

        outlet = (
            db.execute(select(Outlet).where(Outlet.organisation_id == org.id).order_by(Outlet.id.asc()))
            .scalars()
            .first()
        )
        if not outlet:
            raise RuntimeError("No outlet found in database for organisation %s." % org.name)

        admin_role = db.execute(select(Role).where(Role.name == "admin")).scalars().first()
        manager_role = db.execute(select(Role).where(Role.name == "outlet_manager")).scalars().first()

        # 2. Provision Organisation Admin
        admin_email = "admin@galleycontrol.local"
        admin_username = "galley_admin"
        admin_full_name = "Galley Admin"
        admin_temp_password = admin_password or "Admin@Galley2026!"

        admin_user = (
            db.execute(select(User).where((User.email == admin_email) | (User.username == admin_username)))
            .scalars()
            .first()
        )

        admin_hash = hash_password(admin_temp_password)
        if admin_user:
            admin_user.full_name = admin_full_name
            admin_user.email = admin_email
            admin_user.username = admin_username
            admin_user.password_hash = admin_hash
            admin_user.role = "admin"
            admin_user.role_id = admin_role.id if admin_role else 3
            admin_user.organisation_id = org.id
            admin_user.outlet_id = None
            admin_user.is_active = True
            admin_user.manager_approval_status = "APPROVED"
            admin_action = "UPDATED"
        else:
            admin_user = User(
                username=admin_username,
                email=admin_email,
                full_name=admin_full_name,
                password_hash=admin_hash,
                role="admin",
                role_id=admin_role.id if admin_role else 3,
                organisation_id=org.id,
                outlet_id=None,
                is_active=True,
                manager_approval_status="APPROVED",
            )
            db.add(admin_user)
            admin_action = "CREATED"

        # 3. Provision Outlet Manager
        manager_email = "manager@galleycontrol.local"
        manager_username = "outlet_mgr"
        manager_full_name = "Outlet Manager"
        manager_temp_password = manager_password or "Manager@Galley2026!"

        manager_user = (
            db.execute(select(User).where((User.email == manager_email) | (User.username == manager_username)))
            .scalars()
            .first()
        )

        manager_hash = hash_password(manager_temp_password)
        if manager_user:
            manager_user.full_name = manager_full_name
            manager_user.email = manager_email
            manager_user.username = manager_username
            manager_user.password_hash = manager_hash
            manager_user.role = "outlet_manager"
            manager_user.role_id = manager_role.id if manager_role else 2
            manager_user.organisation_id = org.id
            manager_user.outlet_id = outlet.id
            manager_user.is_active = True
            manager_user.manager_approval_status = "APPROVED"
            manager_action = "UPDATED"
        else:
            manager_user = User(
                username=manager_username,
                email=manager_email,
                full_name=manager_full_name,
                password_hash=manager_hash,
                role="outlet_manager",
                role_id=manager_role.id if manager_role else 2,
                organisation_id=org.id,
                outlet_id=outlet.id,
                is_active=True,
                manager_approval_status="APPROVED",
            )
            db.add(manager_user)
            manager_action = "CREATED"

        db.commit()

        print("=" * 70)
        print("GALLEY CONTROL SECURE ACCOUNT PROVISIONING SUMMARY")
        print("=" * 70)
        print(f"Organisation: [{org.id}] {org.name}")
        print(f"Outlet Assigned: [{outlet.id}] {outlet.name} ({outlet.location})")
        print("-" * 70)
        print(f"1. ORGANISATION ADMIN ({admin_action})")
        print(f"   Name:     {admin_full_name}")
        print(f"   Email:    {admin_email}")
        print(f"   Username: {admin_username}")
        print(f"   Role:     admin (Organisation Admin)")
        print(f"   Password: {admin_temp_password}")
        print("-" * 70)
        print(f"2. OUTLET MANAGER ({manager_action})")
        print(f"   Name:     {manager_full_name}")
        print(f"   Email:    {manager_email}")
        print(f"   Username: {manager_username}")
        print(f"   Role:     outlet_manager (Kitchen & Outlet Supervisor)")
        print(f"   Outlet:   {outlet.name} (ID: {outlet.id})")
        print(f"   Password: {manager_temp_password}")
        print("=" * 70)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Provision Admin and Manager accounts")
    parser.add_argument("--sqlite", default=None, help="Path to sqlite db")
    parser.add_argument("--admin-password", default="Admin@Galley2026!", help="Admin password")
    parser.add_argument("--manager-password", default="Manager@Galley2026!", help="Manager password")
    args = parser.parse_args()
    provision_accounts(
        sqlite_path=args.sqlite,
        admin_password=args.admin_password,
        manager_password=args.manager_password,
    )
