#!/usr/bin/env python3
"""Create or update a shared multi-use promo code in Firestore.

Self-contained variant: uses only the Python stdlib + openssl (for the RS256
JWT signing) + curl, so it works even without firebase-admin / node installed.
Equivalent to backend/scripts/create-promo-code.js — pick whichever you
prefer.

Usage:
    FIREBASE_SERVICE_ACCOUNT_JSON_FILE=/tmp/svc.json \\
        python3 backend/scripts/create-promo-code.py
"""

import base64
import datetime
import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.parse

# --- CONFIG (mirror of the JS sibling) ---------------------------------------
CONFIG = {
    # POZOR: musí sedět s kódem na /pro-skoly/ a v docs/email-skoly.md.
    "code": "UCITELE8892",
    # 100 pro kampaň na školy 2026/27. Musí sedět s hodnotou ve Firestore —
    # když dojde, učitel uvidí „Kód byl vyčerpán", tak hlídej usedCount.
    "maxUses": 100,
    "durationDays": 365,
    # Redemption deadline — new redemptions blocked after this date. Already
    # redeemed teachers keep their full durationDays regardless. Matches the
    # `expiresAt` check in backend/server.js /redeem-code.
    # 31. 8. 2027 23:59:59 CEST (= 21:59:59 UTC). Počítáme, ať to nemůže ujet —
    # napevno tu dřív byla konstanta o rok mimo (1788292799000 = 1. 9. 2026).
    "expiresAt": int(datetime.datetime(
        2027, 8, 31, 21, 59, 59, tzinfo=datetime.timezone.utc
    ).timestamp() * 1000),
    "active": True,
    "plan": "annual_teacher",
    "note": "ucseslovesa.cz/pro-skoly — kampaň na školy 2026/27",
}
# -----------------------------------------------------------------------------


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def load_service_account() -> dict:
    path = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON_FILE")
    if path and os.path.exists(path):
        with open(path, "r") as f:
            return json.load(f)
    raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
    if raw:
        return json.loads(raw)
    sys.exit(
        "Set FIREBASE_SERVICE_ACCOUNT_JSON_FILE (path to JSON file) "
        "or FIREBASE_SERVICE_ACCOUNT_JSON (raw JSON)."
    )


def sign_rs256(private_key_pem: str, message: bytes) -> bytes:
    """Sign `message` with the given RSA private key, returning raw signature."""
    proc = subprocess.run(
        ["openssl", "dgst", "-sha256", "-sign", "/dev/stdin", "-binary"],
        input=private_key_pem.encode("utf-8") + b"\n--SEP--\n" + message,
        capture_output=True,
    )
    # The trick above doesn't actually work because openssl reads the key from
    # stdin and then closes — we need a separate channel. Use a temp file.
    raise RuntimeError("unused")


def sign_rs256_via_tempfile(private_key_pem: str, message: bytes) -> bytes:
    import tempfile

    with tempfile.NamedTemporaryFile(
        "w", suffix=".pem", delete=False
    ) as key_file:
        key_file.write(private_key_pem)
        key_path = key_file.name
    try:
        proc = subprocess.run(
            ["openssl", "dgst", "-sha256", "-sign", key_path, "-binary"],
            input=message,
            capture_output=True,
            check=True,
        )
        return proc.stdout
    finally:
        os.unlink(key_path)


def get_access_token(svc: dict) -> str:
    now = int(time.time())
    header = {"alg": "RS256", "typ": "JWT", "kid": svc["private_key_id"]}
    claims = {
        "iss": svc["client_email"],
        "scope": "https://www.googleapis.com/auth/datastore",
        "aud": "https://oauth2.googleapis.com/token",
        "exp": now + 3600,
        "iat": now,
    }
    h_b64 = b64url(json.dumps(header, separators=(",", ":")).encode())
    c_b64 = b64url(json.dumps(claims, separators=(",", ":")).encode())
    signing_input = f"{h_b64}.{c_b64}".encode()
    sig = sign_rs256_via_tempfile(svc["private_key"], signing_input)
    jwt = f"{h_b64}.{c_b64}.{b64url(sig)}"

    body = urllib.parse.urlencode(
        {
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": jwt,
        }
    ).encode()
    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read())
    return data["access_token"]


def to_firestore_value(v):
    """Convert a Python value into Firestore REST API representation."""
    if isinstance(v, bool):
        return {"booleanValue": v}
    if isinstance(v, int):
        return {"integerValue": str(v)}
    if isinstance(v, float):
        return {"doubleValue": v}
    if isinstance(v, str):
        return {"stringValue": v}
    if isinstance(v, list):
        return {"arrayValue": {"values": [to_firestore_value(x) for x in v]}}
    if isinstance(v, dict):
        return {
            "mapValue": {
                "fields": {k: to_firestore_value(val) for k, val in v.items()}
            }
        }
    if v is None:
        return {"nullValue": None}
    raise TypeError(f"Cannot convert {type(v)} to Firestore value")


def firestore_get(project_id: str, path: str, token: str):
    url = (
        f"https://firestore.googleapis.com/v1/projects/{project_id}"
        f"/databases/(default)/documents/{path}"
    )
    req = urllib.request.Request(
        url, headers={"Authorization": f"Bearer {token}"}
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def firestore_patch(
    project_id: str, path: str, token: str, fields: dict, update_mask: list
):
    """PATCH a document with field-level update mask (= merge semantics)."""
    mask = "&".join(f"updateMask.fieldPaths={f}" for f in update_mask)
    url = (
        f"https://firestore.googleapis.com/v1/projects/{project_id}"
        f"/databases/(default)/documents/{path}?{mask}"
    )
    body = json.dumps(
        {"fields": {k: to_firestore_value(v) for k, v in fields.items()}}
    ).encode()
    req = urllib.request.Request(
        url,
        data=body,
        method="PATCH",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def main():
    svc = load_service_account()
    project_id = svc["project_id"]
    print(f"Project: {project_id}", file=sys.stderr)

    token = get_access_token(svc)
    code_id = CONFIG["code"].strip().upper()
    path = f"promoCodes/{code_id}"

    existing = firestore_get(project_id, path, token)

    now_ms = int(time.time() * 1000)
    fields = {
        "active": CONFIG["active"],
        "maxUses": CONFIG["maxUses"],
        "durationDays": CONFIG["durationDays"],
        "expiresAt": CONFIG["expiresAt"],
        "plan": CONFIG["plan"],
        "note": CONFIG["note"],
        "updatedAt": now_ms,
    }
    update_mask = list(fields.keys())

    if existing is None:
        # Brand-new document: also seed usedCount/redeemers/createdAt.
        fields["usedCount"] = 0
        fields["redeemers"] = []
        fields["createdAt"] = now_ms
        update_mask = list(fields.keys())
        print(f"Creating new code: {code_id}", file=sys.stderr)
    else:
        print(f"Updating existing code: {code_id} (preserving usedCount/redeemers)", file=sys.stderr)

    result = firestore_patch(project_id, path, token, fields, update_mask)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
