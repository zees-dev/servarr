#!/usr/local/bin/python3

import json
import logging
import os
import requests
import sys


logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)
handler = logging.StreamHandler()
handler.setFormatter(logging.Formatter("%(asctime)s - %(levelname)s - %(message)s"))
logger.addHandler(handler)

HOMARR_HOST = os.getenv("HOMARR_HOST", "localhost:7575")
USERNAME = os.getenv("HOMARR_USERNAME", "admin")
PASSWORD = os.getenv("HOMARR_PASSWORD", "admin123")
HOMARR_CONFIG_PATH = os.getenv("HOMARR_CONFIG_PATH", "/mnt/homarr-config.json")


class APIError(Exception):
    def __init__(self, status_code: int, body: any):
        super().__init__(status_code, body)
        self.status_code = status_code
        self.body = body

SESSION = requests.Session()
def post(url: str, headers: dict, body: dict, use_json: bool = True) -> dict:
    logger.debug(" ".join([
        "POST",
        url,
        ", ".join(f'{key}: {value}' for key,value in headers.items()),
        str(body)
    ]))
    kwargs = {"json": body} if use_json else {"data": body}
    response = SESSION.post(url=url, headers=headers, **kwargs)
    logger.debug(" ".join([
        "Status Code:",
        str(response.status_code),
        "Response body:",
        response.text
    ]))
    try:
        payload = response.json()
    except json.JSONDecodeError:
        payload = response.text
    if response.status_code >= 300:
        raise APIError(response.status_code, payload)
    return payload

logger.info("Creating Homarr owner account")
try:
    post(
        url=f"http://{HOMARR_HOST}/api/trpc/user.createOwnerAccount?batch=1",
        headers={ "Content-Type": "application/json" },
        body={
            "0": {
                "json": {
                    "username": USERNAME,
                    "password": PASSWORD,
                    "passwordConfirmation": PASSWORD,
                }
            }
        }
    )
except APIError as e:
    status_code, body = e.status_code, e.body
    if status_code != 403:
        logger.error(f"Failed to create Homarr owner account: {status_code} {body}")
        sys.exit(1)
    else:
        logger.info("Homarr owner account already exists, continuing initialization.")
else:
    logger.info("Homarr owner account created successfully.")

# Determine dashboard payload
if os.path.exists(HOMARR_CONFIG_PATH):
    logger.info("Loading Homarr dashboard payload from %s", HOMARR_CONFIG_PATH)
    try:
        with open(HOMARR_CONFIG_PATH, "r", encoding="utf-8") as payload_file:
            dashboard_payload = json.load(payload_file)
    except json.JSONDecodeError:
        logger.error("Failed to parse Homarr dashboard payload at %s", HOMARR_CONFIG_PATH)
        sys.exit(1)
    except OSError as exc:
        logger.error("Unable to read Homarr dashboard payload at %s: %s", HOMARR_CONFIG_PATH, exc)
        sys.exit(1)
else:
    logger.error("No dashboard payload supplied via HOMARR_CONFIG_PATH, using inline payload.")
    sys.exit(1)

try:
    logger.info("Requesting Homarr CSRF token")
    csrf_response = SESSION.get(
        url=f"http://{HOMARR_HOST}/api/auth/csrf",
        headers={"Content-Type": "application/json"}
    )
    logger.debug(" ".join([
        "Status Code:",
        str(csrf_response.status_code),
        "Response body:",
        csrf_response.text
    ]))
    try:
        csrf_payload = csrf_response.json()
    except json.JSONDecodeError:
        csrf_payload = csrf_response.text
    if csrf_response.status_code >= 300:
        raise APIError(csrf_response.status_code, csrf_payload)
    csrf_token = csrf_payload.get("csrfToken") if isinstance(csrf_payload, dict) else None
    if not csrf_token:
        raise APIError(csrf_response.status_code, csrf_payload)

    logger.info("Authenticating to Homarr as %s", USERNAME)
    post(
        url=f"http://{HOMARR_HOST}/api/auth/callback/credentials",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        body={
            "redirect": "false",
            "name": USERNAME,
            "password": PASSWORD,
            "callbackUrl": "/",
            "csrfToken": csrf_token,
            "json": "true"
        },
        use_json=False
    )
except APIError as e:
    logger.error(f"Failed to authenticate to Homarr: {e.status_code} {e.body}")
    sys.exit(1)

try:
    logger.info("Saving Homarr dashboard configuration")
    post(
        url=f"http://{HOMARR_HOST}/api/trpc/config.save?batch=1",
        headers={ "Content-Type": "application/json" },
        body=dashboard_payload
    )
    logger.info("Homarr dashboard configuration saved")
except APIError as e:
    logger.error(f"Failed to save Homarr dashboard: {e.status_code} {e.body}")
    sys.exit(1)
