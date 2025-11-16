#!/usr/local/bin/python3

from json import JSONDecodeError, load, dumps
import logging
import os
import requests
import sys
import xml.etree.ElementTree as ET


logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)
console_handler = logging.StreamHandler()
log_format = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
console_handler.setFormatter(log_format)
logger.addHandler(console_handler)

JELLYSEERR_SETTINGS_PATH = os.getenv("JELLYSEERR_SETTINGS_PATH", "/app/config/settings.json")
JELLYSEERR_HOST = os.getenv("JELLYSEERR_HOST")
JELLYFIN_USERNAME = os.getenv("JELLYFIN_USERNAME")
JELLYFIN_PASSWORD = os.getenv("JELLYFIN_PASSWORD")
JELLYFIN_EMAIL = os.getenv("JELLYFIN_EMAIL")
JELLYFIN_HOST = os.getenv("JELLYFIN_HOST")
RADARR_HOST = os.getenv("RADARR_HOST")
RADARR_CONFIG_PATH = os.getenv("RADARR_CONFIG_PATH", "/radarr-config/config.xml")
SONARR_HOST = os.getenv("SONARR_HOST")
SONARR_CONFIG_PATH = os.getenv("SONARR_CONFIG_PATH", "/sonarr-config/config.xml")

logger.info("Initializing Variables")

JELLYSEERR_HOST, JELLYSEERR_PORT = JELLYSEERR_HOST.split(":", 1)
logger.debug("JELLYSEERR_HOST: %s, JELLYSEERR_PORT: %s", JELLYSEERR_HOST, JELLYSEERR_PORT)

JELLYFIN_HOST, JELLYFIN_PORT = JELLYFIN_HOST.split(":", 1)
logger.debug("JELLYFIN_HOST: %s, JELLYFIN_PORT: %s", JELLYFIN_HOST, JELLYFIN_PORT)

RADARR_HOST, RADARR_PORT = RADARR_HOST.split(":", 1)
logger.debug("RADARR_HOST: %s, RADARR_PORT: %s", RADARR_HOST, RADARR_PORT)

SONARR_HOST, SONARR_PORT = SONARR_HOST.split(":", 1)
logger.debug("SONARR_HOST: %s, SONARR_PORT: %s", SONARR_HOST, SONARR_PORT)

session = requests.Session()

def load_api_key(path: str, label: str) -> str:
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

logger.info("Loading Sonarr API Key from %s", SONARR_CONFIG_PATH)
SONARR_API_KEY = load_api_key(SONARR_CONFIG_PATH, "Sonarr")
logger.debug("Loaded Sonarr API Key: %s", SONARR_API_KEY)

logger.info("Loading Radarr API Key from %s", RADARR_CONFIG_PATH)
RADARR_API_KEY = load_api_key(RADARR_CONFIG_PATH, "Radarr")
logger.debug("Loaded Radarr API Key: %s", RADARR_API_KEY)

def load_jellyseerr_api_key(path: str) -> str:
    try:
        with open(path, encoding="utf-8") as settings_file:
            settings = load(settings_file)
    except FileNotFoundError:
        logger.error("Jellyseerr settings file %s not found", path)
        sys.exit(1)
    except JSONDecodeError as exc:
        logger.error("Unable to parse Jellyseerr settings file %s: %s", path, exc)
        sys.exit(1)

    main_settings = settings.get("main")
    if not isinstance(main_settings, dict):
        logger.error("Jellyseerr settings file %s missing 'main' configuration", path)
        sys.exit(1)

    api_key = main_settings.get("apiKey", "").strip()
    if not api_key:
        logger.error("Jellyseerr settings file %s missing 'main.apiKey' value", path)
        sys.exit(1)
    return api_key

# Load Jellyseerr API Key for auth in all requests
logger.info("Loading Jellyseerr API Key from %s", JELLYSEERR_SETTINGS_PATH)
JELLYSEERR_API_KEY = load_jellyseerr_api_key(JELLYSEERR_SETTINGS_PATH)
logger.debug("Loaded Jellyseerr API Key: %s", JELLYSEERR_API_KEY)
session.headers.update({"X-Api-Key": JELLYSEERR_API_KEY})

jellyseer_url = "http://{0}:{1}".format(JELLYSEERR_HOST, JELLYSEERR_PORT)
def make_get(endpoint=""):
    url = "{0}{1}".format(jellyseer_url, endpoint)
    logger.debug(" ".join([
        url,
        "GET",
        ", ".join([f'{key}: {value}' for key,value in session.headers.items()]),
        ", ".join([f'{key}: {value}' for key,value in session.cookies.items()])
    ]))
    response = session.get(
        url=url,
        verify=False,
    )
    logger.debug(" ".join([
        "Status Code:",
        str(response.status_code),
        "Response body:",
        response.text
    ]))
    response.raise_for_status()
    try:
        return response.json()
    except JSONDecodeError:
        return response.text
def make_post(endpoint="", body=None, acceptable_response=None):
    url = "{0}{1}".format(jellyseer_url, endpoint)
    logger.debug(" ".join([
        url,
        "POST",
        "Body:",
        str(body),
        ", ".join([f'{key}: {value}' for key,value in session.headers.items()]),
        ", ".join([f'{key}: {value}' for key,value in session.cookies.items()])
    ]))
    response = session.post(
        url=url,
        json=body,
        verify=False,
    )
    response_text = response.text
    logger.debug(" ".join([
        "Status Code:",
        str(response.status_code),
        "Response body:",
        response_text
    ]))
    try:
        response_json = response.json()
    except JSONDecodeError:
        response_json = None
    
    if response.status_code < 300:
        return response_json if response_json is not None else response_text

    # process acceptable responses - for idempotent runs
    def normalize(value):
        if value is None:
            return None
        if isinstance(value, dict):
            value = dumps(value, sort_keys=True)
        return "".join(str(value).split()).lower()

    normalized_response_body = normalize(response_json if isinstance(response_json, dict) else response_text)
    matched_expected = False
    if acceptable_response:
        expected_status, expected_body = acceptable_response
        if response.status_code == expected_status:
            normalized_expected = normalize(expected_body if expected_body is not None else None)
            if normalized_expected is None or normalized_expected == normalized_response_body:
                matched_expected = True
                logger.debug(
                    "Received expected %s response from %s; continuing initialization.",
                    response.status_code,
                    url,
                )
    if not matched_expected:
        logger.error("Unexpected response from %s: %s %s", url, response.status_code, response_text)
        response.raise_for_status()
    return response_json if response_json is not None else response_text


logger.info("Initizalizing JellySeer")

# ########## JELLYFIN INTEGRATION

logger.info("Integrating Jellyfin")
jellyfin_endpoint = "/api/v1/auth/jellyfin"
make_post(
    jellyfin_endpoint,
    body={
        "username": JELLYFIN_USERNAME,
        "password": JELLYFIN_PASSWORD,
        "email": JELLYFIN_EMAIL,
        "hostname": JELLYFIN_HOST,
        "port": int(JELLYFIN_PORT),
        "useSsl": False,
        "urlBase": "",
        "serverType": 2,
    },
    acceptable_response=(500, {"error": "Jellyfin hostname already configured"}),
)

############ RADARR

logger.info("Integrating Radarr")
radarr_endpoint = "/api/v1/settings/radarr"
existing_radarr = make_get(radarr_endpoint)
if existing_radarr == []:
    logger.info("No Radarr integration found; registering Radarr")
    radarr_response = make_post(
        radarr_endpoint,
        body={
            "name": "Radarr",
            "hostname": RADARR_HOST,
            "port": int(RADARR_PORT),
            "apiKey": RADARR_API_KEY,
            "useSsl": False,
            "activeProfileId": 1,
            "activeProfileName": "HD - 720p/1080p",
            "activeDirectory": "/mnt/media",
            "is4k": False,
            "minimumAvailability": "released",
            "tags": [],
            "isDefault": True,
            "syncEnabled": True,
            "preventSearch": False,
            "tagRequests": False,
        }
    )
else:
    logger.info("Radarr already registered; skipping Radarr configuration")
    radarr_response = existing_radarr

############ SONARR

logger.info("Integrating Sonarr")
sonarr_endpoint = "/api/v1/settings/sonarr"
existing_sonarr = make_get(sonarr_endpoint)
if existing_sonarr == []:
    logger.info("No Sonarr integration found; registering Sonarr")
    sonarr_response = make_post(
        sonarr_endpoint,
        body={
            "name": "Sonarr",
            "hostname": SONARR_HOST,
            "port": int(SONARR_PORT),
            "apiKey": SONARR_API_KEY,
            "useSsl": False,
            "baseUrl": "",
            "activeProfileId": 1,
            "activeProfileName": "HD - 720p/1080p",
            "activeLanguageProfileId": 1,
            "activeDirectory": "/mnt/media",
            "activeAnimeProfileId": 1,
            "activeAnimeLanguageProfileId": 1,
            "activeAnimeProfileName": "Any",
            "activeAnimeDirectory": "/mnt/media",
            "tags": [],
            "animeTags": [],
            "is4k": False,
            "isDefault": True,
            "enableSeasonFolders": True,
            "syncEnabled": True,
            "preventSearch": False,
            "tagRequests": False,
        }
    )
else:
    logger.info("Sonarr already registered; skipping Sonarr configuration")
    sonarr_response = existing_sonarr

############ FINALIZE

logger.info("Finalization phase")
response = make_post("/api/v1/settings/initialize", body={})
response = make_post("/api/v1/settings/main", body={"locale":"en"})

########## TELEGRAM NOTIFICATIONS
enable_telegram = os.getenv("TELEGRAM_NOTIFICATION_ENABLED", 'False').lower() in ('true', '1', 't')
telegram_chat_id = os.getenv("TELEGRAM_CHAT_ID")
telegram_apitoken = os.getenv("TELEGRAM_BOT_APITOKEN")
if enable_telegram:
    telegram_endpoint = "/api/v1/settings/notifications/telegram"
    telegram_body = {"enabled":True,"types":4062,"options":{}}
    telegram_body['options']= {"botAPI":telegram_apitoken,"chatId":telegram_chat_id,"sendSilently":False}
    telegram_response = make_post(telegram_endpoint, body=telegram_body)
