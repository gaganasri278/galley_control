"""Production operations CLI for Galley Control (create-admin, seed-catalog)."""

from __future__ import annotations

import argparse
from getpass import getpass

from fastapi import HTTPException
from sqlalchemy import select, update

from app.database import db_session, init_db
from app.models import Organisation, User, UserSession
from app.seed_data import (
    ensure_roles_and_permissions,
    seed_catalog_base,
)
from app.services.auth_service import hash_password, validate_password_strength


def main() -> None:
    parser = argparse.ArgumentParser(description="Galley Control Operations CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    admin_cmd = sub.add_parser("create-admin", help="Create a Platform Admin account")
    admin_cmd.add_argument("--email", required=True)
    admin_cmd.add_argument("--username", required=True)
    admin_cmd.add_argument("--full-name", default="Platform Administrator")

    reset_admin_cmd = sub.add_parser(
        "reset-admin-password",
        help="Reset a Platform Admin password (prompts securely)",
    )
    reset_admin_cmd.add_argument("--email", required=True)

    cat_cmd = sub.add_parser("seed-catalog", help="Create/seed an active organisation catalog")
    cat_cmd.add_argument("--org-name", default="Main Campus Canteen Network")
    cat_cmd.add_argument("--org-slug", default="main-campus")
    cat_cmd.add_argument("--org-email", default="campus-ops@galley.edu")

    args = parser.parse_args()

    if args.command == "create-admin":
        password = getpass("New admin password: ")
        confirm_password = getpass("Confirm new admin password: ")
        if password != confirm_password:
            raise SystemExit("Passwords do not match.")
        try:
            validate_password_strength(password)
        except HTTPException as exc:
            raise SystemExit(str(exc.detail)) from exc

        init_db()
        with db_session() as db:
            role_map = ensure_roles_and_permissions(db)
            existing = db.execute(
                select(User).where(
                    (User.email == args.email.strip().lower())
                    | (User.username == args.username.strip().lower())
                )
            ).scalar_one_or_none()
            if existing:
                raise SystemExit(f"User already exists: {existing.email}")
            db.add(
                User(
                    organisation_id=None,
                    username=args.username.strip().lower(),
                    email=args.email.strip().lower(),
                    full_name=args.full_name.strip(),
                    password_hash=hash_password(password),
                    role="admin",
                    role_id=role_map.get("admin"),
                    outlet_id=None,
                    is_active=True,
                    manager_approval_status="APPROVED",
                )
            )
        print(f"Platform Admin created: {args.email.strip().lower()}")

    elif args.command == "reset-admin-password":
        password = getpass("New admin password: ")
        confirm_password = getpass("Confirm new admin password: ")
        if password != confirm_password:
            raise SystemExit("Passwords do not match.")
        try:
            validate_password_strength(password)
        except HTTPException as exc:
            raise SystemExit(str(exc.detail)) from exc

        email = args.email.strip().lower()
        with db_session() as db:
            admin = db.execute(
                select(User).where(User.email == email, User.role == "admin")
            ).scalar_one_or_none()
            if admin is None:
                raise SystemExit(f"No platform admin found with email: {email}")

            admin.password_hash = hash_password(password)
            db.execute(
                update(UserSession)
                .where(UserSession.user_id == admin.id, UserSession.revoked.is_(False))
                .values(revoked=True)
            )
        print(f"Password reset for platform admin: {email}. Existing sessions were revoked.")

    elif args.command == "seed-catalog":
        init_db()
        with db_session() as db:
            ensure_roles_and_permissions(db)
            org = db.execute(
                select(Organisation).where(Organisation.slug == args.org_slug.strip().lower())
            ).scalar_one_or_none()
            if not org:
                org = Organisation(
                    name=args.org_name.strip(),
                    slug=args.org_slug.strip().lower(),
                    campus_location="Campus",
                    contact_email=args.org_email.strip().lower(),
                    status="ACTIVE",
                )
                db.add(org)
                db.flush()
            org_id, outlet_ids = seed_catalog_base(db, organisation_id=org.id)
        print(f"Catalog ready for org_id={org_id} with outlets: {outlet_ids}")


if __name__ == "__main__":
    main()
