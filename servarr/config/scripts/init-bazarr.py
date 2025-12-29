#!/usr/local/bin/python3

"""Configure Bazarr integrations with Radarr and Sonarr."""

from __future__ import annotations

import json
import logging
import os
import sys
import xml.etree.ElementTree as ET

import requests
import yaml


logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)
console_handler = logging.StreamHandler()
log_format = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
console_handler.setFormatter(log_format)
logger.addHandler(console_handler)

BAZARR_HOST = os.getenv("BAZARR_HOST")
BAZARR_CONFIG_PATH = os.getenv("BAZARR_CONFIG_PATH")
RADARR_CONFIG_PATH = os.getenv("RADARR_CONFIG_PATH")
SONARR_CONFIG_PATH = os.getenv("SONARR_CONFIG_PATH")
RADARR_SERVICE = os.getenv("RADARR_SERVICE")
SONARR_SERVICE = os.getenv("SONARR_SERVICE")
BAZARR_SETTINGS_PATH = "/mnt/bazarr-settings.json"


def load_json_file(path: str) -> list:
    """Load JSON file, return empty list if not found."""
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        logger.warning("Settings file %s not found", path)
        return []
    except json.JSONDecodeError as exc:
        logger.error("Unable to parse %s: %s", path, exc)
        return []


def load_bazarr_api_key(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            config = yaml.safe_load(handle) or {}
        auth = config.get("auth") or {}
        api_key = auth.get("apikey")
        if not api_key:
            raise ValueError("Bazarr auth.apikey is missing or empty")
        return str(api_key).strip()
    except FileNotFoundError:
        logger.error("Bazarr config file %s not found", path)
    except yaml.YAMLError as exc:
        logger.error("Unable to parse Bazarr configuration (%s): %s", path, exc)
    except ValueError as exc:
        logger.error("%s", exc)
    sys.exit(1)


def load_arr_api_key(path: str, label: str) -> str:
    try:
        tree = ET.parse(path)
        api_key = tree.getroot().findtext("ApiKey")
        if not api_key:
            raise ValueError(f"{label} ApiKey node missing or empty")
        return api_key.strip()
    except FileNotFoundError:
        logger.error("%s config file %s not found", label, path)
    except ET.ParseError as exc:
        logger.error("Unable to parse %s (%s): %s", label, path, exc)
    except ValueError as exc:
        logger.error("%s", exc)
    sys.exit(1)


# Load API Keys
logger.info("Loading Bazarr API Key from %s", BAZARR_CONFIG_PATH)
API_KEY = load_bazarr_api_key(BAZARR_CONFIG_PATH)
logger.debug("Loaded Bazarr API Key: %s", API_KEY)

logger.info("Loading Radarr API Key from %s", RADARR_CONFIG_PATH)
RADARR_API_KEY = load_arr_api_key(RADARR_CONFIG_PATH, "Radarr")
logger.debug("Loaded Radarr API Key: %s", RADARR_API_KEY)

logger.info("Loading Sonarr API Key from %s", SONARR_CONFIG_PATH)
SONARR_API_KEY = load_arr_api_key(SONARR_CONFIG_PATH, "Sonarr")
logger.debug("Loaded Sonarr API Key: %s", SONARR_API_KEY)

# Load settings from mounted JSON file (list of [key, value] pairs)
logger.info("Loading Bazarr settings from %s", BAZARR_SETTINGS_PATH)
settings = load_json_file(BAZARR_SETTINGS_PATH)

# Convert to form entries and append Radarr/Sonarr integration
form_entries = [tuple(entry) for entry in settings]
form_entries.extend([
    ("settings-general-use_radarr", "true"),
    ("settings-radarr-ip", RADARR_SERVICE),
    ("settings-radarr-apikey", RADARR_API_KEY),
    ("settings-general-use_sonarr", "true"),
    ("settings-sonarr-ip", SONARR_SERVICE),
    ("settings-sonarr-apikey", SONARR_API_KEY),
])

logger.info("Configuring Bazarr with %d settings", len(form_entries))
headers = {"x-api-key": API_KEY}
SETTINGS_ENDPOINT = f"http://{BAZARR_HOST}/api/system/settings"

try:
    response = requests.post(SETTINGS_ENDPOINT, headers=headers, data=form_entries)
    logger.debug("Status Code: %s Response body: %s", response.status_code, response.text)
    response.raise_for_status()
except requests.HTTPError as exc:
    logger.error("There was an error while configuring Bazarr: %s", exc)
    sys.exit(1)
except requests.RequestException as exc:
    logger.error("Unable to reach Bazarr settings endpoint: %s", exc)
    sys.exit(1)

logger.info("Bazarr settings updated successfully")
