#!/usr/local/bin/python3

import logging
import os
import requests
import sys
import json

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)
handler = logging.StreamHandler()
handler.setFormatter(logging.Formatter("%(asctime)s - %(levelname)s - %(message)s"))
logger.addHandler(handler)

HOMARR_HOST = os.getenv("HOMARR_HOST", "localhost:7575")
USERNAME = os.getenv("HOMARR_USERNAME", "admin")
PASSWORD = os.getenv("HOMARR_PASSWORD", "admin123")

class APIError(Exception):
    def __init__(self, status_code: int, body: any):
        super().__init__(status_code, body)
        self.status_code = status_code
        self.body = body

def post(url: str, headers: dict, body: dict) -> dict:
    logger.debug(" ".join([
        "POST",
        url,
        ", ".join(f'{key}: {value}' for key,value in headers.items()),
        str(body)
    ]))
    response = requests.post(url=url, json=body, headers=headers)
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
        logger.info("Homarr owner account already exists, skipping initialization.")
        sys.exit(0)
logger.info("Homarr owner account created successfully.")
