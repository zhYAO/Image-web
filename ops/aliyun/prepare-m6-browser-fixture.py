#!/usr/bin/env python3
"""Prepare pinned no-M7 browser fixture files only; never start a database."""
import argparse
import hashlib
from pathlib import Path
import re
import shutil

NAMES = ["active_business_session_asset_reads","apparel_catalog","chat_usage_settlement","commerce_package_orders","commerce_reference_history","commerce_single_task_limits","commerce_tasks","commerce_xhs_poster","creative_batch_history_access","creative_batch_legacy_insert_schedule","creative_batch_progress_owner_access","creative_batch_review_progress","creative_batch_worker","credits","credits_safe_updates","doubao_edge_relay","durable_generation_rejections","ecommerce_workflows","isolated_provider_diagnostics","openai_chat_edge_relay","openai_models_disabled","phase1_advisor_hardening","phase1_chat","phase1_cleanup","phase1_cleanup_schedule","phase1_enabled_overrides_health","phase1_foundation","phase1_generation_emergency_stop","phase1_generation_queue","phase1_generation_schedule","phase1_modern_secret_key_scheduling","phase1_preview_guards","phase1_public_write_hardening","phase1_safety_audit","phase2_auth_accounts","phase2_auth_runtime_fixes","phase2_generation_reliability","retire_creative_batch_cron","retire_minimax_preserve_history","seedream_5_models","seedream_plan_only_image_admission","session_activity_summary","unknown_generation_health_once"]

LEDGER_SHA = "c6951d2b41ae6f52d7f1b7fd1e5d7c11a4be9c77b9729d86230a353de2724857"
DIAGNOSTICS_SHA = "7fc3d2c1144692d25d52e0f50e57b3ad05bf4b8131c0bc8545b2efee9c830923"
REMAP = {"isolated_provider_diagnostics": "20261106123202", "chat_usage_settlement": "20261106083858"}


def prepare(source, output):
    if not source.is_dir() or source.is_symlink():
        raise ValueError("Invalid migration source")
    if output.exists() or output.is_symlink():
        raise ValueError("Fixture path already exists")
    seen, selected = set(), {}
    m7 = 0
    for src in sorted(source.glob("*.sql")):
        match = re.fullmatch(r"([0-9]{14})_([a-z0-9_]+)\.sql", src.name)
        if not match or not src.is_file() or src.is_symlink():
            raise ValueError("Invalid source migration")
        stamp, name = match.groups()
        if name == "verified_openai_chat_metering":
            m7 += 1
            continue
        if name not in NAMES or name in seen:
            raise ValueError("Unexpected or duplicate source migration")
        seen.add(name)
        body = src.read_bytes()
        if name == "isolated_provider_diagnostics" and hashlib.sha256(body).hexdigest() != DIAGNOSTICS_SHA:
            raise ValueError("Diagnostics migration digest mismatch")
        selected[(REMAP.get(name, stamp), name)] = body
    if seen != set(NAMES) or m7 != 1:
        raise ValueError("Expected exact candidate migrations, including one excluded M7")
    ledger = "".join(f"{stamp}|{name}\n" for stamp, name in sorted(selected)).encode()
    if hashlib.sha256(ledger).hexdigest() != LEDGER_SHA:
        raise ValueError("Migration ledger digest mismatch")
    output.mkdir(mode=0o700)
    try:
        migrations = output / "supabase/migrations"
        migrations.mkdir(parents=True)
        for (stamp, name), body in selected.items():
            (migrations / f"{stamp}_{name}.sql").write_bytes(body)
        (output / "expected-migration-ledger.txt").write_bytes(ledger)
        (output / "expected-migration-names.txt").write_bytes(("\n".join(NAMES) + "\n").encode())
    except BaseException:
        shutil.rmtree(output)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("migration_dir", type=Path)
    parser.add_argument("new_fixture_dir", type=Path)
    args = parser.parse_args()
    prepare(args.migration_dir, args.new_fixture_dir)


if __name__ == "__main__":
    main()
