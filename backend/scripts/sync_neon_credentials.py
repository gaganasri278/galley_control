"""Sync default admin and manager credentials directly into Neon PostgreSQL."""

import os
import sys
from pathlib import Path

backend_root = Path(__file__).resolve().parent.parent
if str(backend_root) not in sys.path:
    sys.path.insert(0, str(backend_root))

from app.config import settings
from app.services.auth_service import hash_password, verify_password
from sqlalchemy import create_engine, text

def sync_credentials():
    url = settings.database_url_unpooled or settings.database_url
    engine = create_engine(url)

    admin_pass = "Admin@Galley2026!"
    manager_pass = "Manager@Galley2026!"
    admin_hash = hash_password(admin_pass)
    manager_hash = hash_password(manager_pass)

    with engine.begin() as conn:
        # 1. Update existing 'admin' (id 4) and 'manager' (id 2) so they also work with these passwords
        conn.execute(
            text("UPDATE users SET password_hash = :h, organisation_id = 1 WHERE username = 'admin' OR email = 'admin@galley.edu'"),
            {"h": admin_hash},
        )
        conn.execute(
            text("UPDATE users SET password_hash = :h, organisation_id = 1, outlet_id = 1 WHERE username = 'manager' OR email = 'manager@galley.edu'"),
            {"h": manager_hash},
        )

        # 2. Upsert galley_admin
        existing_admin = conn.execute(
            text("SELECT id FROM users WHERE username = 'galley_admin' OR email = 'admin@galleycontrol.local'")
        ).fetchone()
        if existing_admin:
            conn.execute(
                text("UPDATE users SET password_hash = :h, organisation_id = 1, is_active = true WHERE id = :id"),
                {"h": admin_hash, "id": existing_admin[0]},
            )
            print("Updated existing galley_admin on Neon")
        else:
            conn.execute(
                text("""
                    INSERT INTO users (organisation_id, username, email, full_name, password_hash, role, role_id, is_active, manager_approval_status)
                    VALUES (1, 'galley_admin', 'admin@galleycontrol.local', 'Galley Admin', :h, 'admin', 3, true, 'APPROVED')
                """),
                {"h": admin_hash},
            )
            print("Created galley_admin on Neon")

        # 3. Upsert outlet_mgr
        existing_mgr = conn.execute(
            text("SELECT id FROM users WHERE username = 'outlet_mgr' OR email = 'manager@galleycontrol.local'")
        ).fetchone()
        if existing_mgr:
            conn.execute(
                text("UPDATE users SET password_hash = :h, organisation_id = 1, outlet_id = 1, is_active = true WHERE id = :id"),
                {"h": manager_hash, "id": existing_mgr[0]},
            )
            print("Updated existing outlet_mgr on Neon")
        else:
            conn.execute(
                text("""
                    INSERT INTO users (organisation_id, username, email, full_name, password_hash, role, role_id, outlet_id, is_active, manager_approval_status)
                    VALUES (1, 'outlet_mgr', 'manager@galleycontrol.local', 'Outlet Manager', :h, 'outlet_manager', 2, 1, true, 'APPROVED')
                """),
                {"h": manager_hash},
            )
            print("Created outlet_mgr on Neon")

        # 4. Synchronize sequence counter
        conn.execute(
            text("SELECT setval(pg_get_serial_sequence('users', 'id'), (SELECT MAX(id) FROM users))")
        )

        # 5. List all users currently on Neon
        users = conn.execute(
            text("SELECT id, username, email, role, organisation_id, outlet_id, is_active FROM users ORDER BY id")
        ).fetchall()
        print("\nAll Users in Neon PostgreSQL:")
        for u in users:
            print(f"  ID {u[0]}: {u[1]} | {u[2]} | Role: {u[3]} | Org: {u[4]} | Outlet: {u[5]} | Active: {u[6]}")

    print("\nCredentials sync completed successfully on Neon.")

if __name__ == "__main__":
    sync_credentials()
