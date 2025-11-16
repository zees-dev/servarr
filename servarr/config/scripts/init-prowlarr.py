#!/usr/local/bin/python3

import json
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

PROWLARR_HOST = os.getenv("PROWLARR_HOST")
PROWLARR_CONFIG_PATH = os.getenv("PROWLARR_CONFIG_PATH")
RADARR_CONFIG_PATH = os.getenv("RADARR_CONFIG_PATH")
SONARR_CONFIG_PATH = os.getenv("SONARR_CONFIG_PATH")
TORRENT_USERNAME = os.getenv("TORRENT_ADMIN")
TORRENT_PASSWORD = os.getenv("TORRENT_PASSWORD")
TORRENT_SERVICE = os.getenv("TORRENT_SERVICE")
PROWLARR_SERVICE = os.getenv("PROWLARR_SERVICE")
RADARR_SERVICE = os.getenv("RADARR_SERVICE")
FLARESOLVERR_SERVICE = os.getenv("FLARESOLVERR_SERVICE")
SONARR_SERVICE = os.getenv("SONARR_SERVICE")

def load_api_key(path: str, label: str) -> str:
    """Read the ApiKey from the specified config file."""

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

def _request(method: str, url: str, headers: dict, **kwargs):
    logger.debug(" ".join([
        method.upper(),
        url,
        ", ".join(f"{key}: {value}" for key, value in headers.items()),
        str(kwargs.get("json") or ""),
    ]))
    response = requests.request(method=method, url=url, headers=headers, **kwargs)
    logger.debug(" ".join([
        "Status Code:",
        str(response.status_code),
        "Response body:",
        response.text,
    ]))
    try:
        payload = response.json()
    except json.JSONDecodeError:
        payload = response.text
    return response.status_code, payload, response

def post(url: str, headers: dict, body: dict):
    status, payload, _ = _request("post", url, headers, json=body)
    return {"code": status, "response": payload}

def get(url: str, headers: dict):
    status, payload, response = _request("get", url, headers)
    if status >= 400:
        response.raise_for_status()
    return payload

indexers_endpoint = "http://{}/api/v1/indexer".format(PROWLARR_HOST)
def indexer_exists(name: str) -> bool:
    indexers = get(indexers_endpoint, headers=headers)
    return any(indexer.get("name", "").lower() == name.lower() for indexer in indexers)

indexer_proxy_endpoint = "http://{}/api/v1/indexerProxy".format(PROWLARR_HOST)
def indexer_proxy_exists(name: str) -> bool:
    indexer_proxies = get(indexer_proxy_endpoint, headers=headers)
    return any(indexer_proxy.get("name", "").lower() == name.lower() for indexer_proxy in indexer_proxies)

applications_endpoint = "http://{}/api/v1/applications".format(PROWLARR_HOST)
def application_exists(name: str) -> bool:
    applications = get(applications_endpoint, headers=headers)
    return any(app.get("name", "").lower() == name.lower() for app in applications)

download_clients_endpoint = "http://{}/api/v1/downloadclient".format(PROWLARR_HOST)
def download_client_exists(name: str) -> bool:
    clients = get(download_clients_endpoint, headers=headers)
    return any(client.get("name", "").lower() == name.lower() for client in clients)


# Load API Keys
logger.info("Loading Prowlarr API Key from %s", PROWLARR_CONFIG_PATH)
API_KEY = load_api_key(PROWLARR_CONFIG_PATH, "Prowlarr")
logger.debug("Loaded Prowlarr API Key: %s", API_KEY)

logger.info("Loading Radarr API Key from %s", RADARR_CONFIG_PATH)
RADARR_API_KEY = load_api_key(RADARR_CONFIG_PATH, "Radarr")
logger.debug("Loaded Radarr API Key: %s", RADARR_API_KEY)

logger.info("Loading Sonarr API Key from %s", SONARR_CONFIG_PATH)
SONARR_API_KEY = load_api_key(SONARR_CONFIG_PATH, "Sonarr")
logger.debug("Loaded Sonarr API Key: %s", SONARR_API_KEY)

# common headers for all requests
headers = {
    "content-type": "application/json",
    "x-api-key": API_KEY,
    "x-requested-with": "XMLHttpRequest"
}

logger.info("Registering Flaresolverr tags in Prowlarr")
res = post(
    url="http://{}/api/v1/tag".format(PROWLARR_HOST),
    headers=headers,
    body={ "label":"flare" }
)
if res["code"] != 201:
    logger.error("There was an error while setting the Flaresolverr tags!")
    sys.exit(1)

if application_exists("Radarr"):
    logger.info("Radarr already registered in Prowlarr; skipping")
else:
    logger.info("Registering Radarr in Prowlarr")
    res = post(
        url=applications_endpoint,
        headers={ **headers, "X-Prowlarr-Client": "true" },
        body={
            "syncLevel": "fullSync",
            "fields": [
                {
                    "name": "prowlarrUrl",
                    "value": "http://{}".format(PROWLARR_SERVICE)
                },
                {
                    "name": "baseUrl",
                    "value": "http://{}".format(RADARR_SERVICE)
                },
                {
                    "name": "apiKey",
                    "value": RADARR_API_KEY
                },
                {
                    "name": "syncCategories",
                    "value": [
                        2000,
                        2010,
                        2020,
                        2030,
                        2040,
                        2045,
                        2050,
                        2060,
                        2070,
                        2080,
                        2090
                    ]
                },
                {
                    "name": "syncRejectBlocklistedTorrentHashesWhileGrabbing",
                    "value": False
                }
            ],
            "implementationName": "Radarr",
            "implementation": "Radarr",
            "configContract": "RadarrSettings",
            "infoLink": "https://wiki.servarr.com/prowlarr/supported#radarr",
            "tags": [],
            "name": "Radarr"
        }
    )
    if res["code"] != 201:
        logger.error("There was an error while setting Radarr in Prowlarr!")
        sys.exit(1)

if application_exists("Sonarr"):
    logger.info("Sonarr already registered in Prowlarr; skipping")
else:
    logger.info("Registering Sonarr in Prowlarr")
    res = post(
        url=applications_endpoint,
        headers={ **headers, "X-Prowlarr-Client": "true" },
        body={
            "syncLevel": "fullSync",
            "fields": [
                {
                    "name": "prowlarrUrl",
                    "value": "http://{}".format(PROWLARR_SERVICE)
                },
                {
                    "name": "baseUrl",
                    "value": "http://{}".format(SONARR_SERVICE)
                },
                {
                    "name": "apiKey",
                    "value": SONARR_API_KEY
                },
                {
                    "name": "syncCategories",
                    "value": [
                        5000,
                        5010,
                        5020,
                        5030,
                        5040,
                        5045,
                        5050,
                        5090
                    ]
                },
                {
                    "name": "animeSyncCategories",
                    "value": [5070]
                },
                {
                    "name": "syncAnimeStandardFormatSearch",
                    "value": False
                }
            ],
            "implementationName": "Sonarr",
            "implementation": "Sonarr",
            "configContract": "SonarrSettings",
            "infoLink": "https://wiki.servarr.com/prowlarr/supported#sonarr",
            "tags": [],
            "name": "Sonarr"
        }
    )
    if res["code"] != 201:
        logger.error("There was an error while setting Sonarr in Prowlarr!")
        sys.exit(1)

if download_client_exists("qBittorrent"):
    logger.info("qBittorrent download client already configured; skipping")
else:
    logger.info("Registering qBittorrent download client")
    res = post(
        url=download_clients_endpoint,
        headers=headers,
        body={
            "enable": True,
            "protocol": "torrent",
            "priority": 1,
            "categories": [],
            "supportsCategories": True,
            "name": "qBittorrent",
            "fields": [
                {
                    "name": "host",
                    "value": TORRENT_SERVICE
                },
                {
                    "name": "port",
                    "value": "10095"
                },
                {
                    "name": "useSsl",
                    "value": False
                },
                {
                    "name": "urlBase"
                },
                {
                    "name": "username",
                    "value": TORRENT_USERNAME
                },
                {
                    "name": "password",
                    "value": TORRENT_PASSWORD
                },
                {
                    "name": "category",
                    "value": "prowlarr"
                },
                {
                    "name": "priority",
                    "value": 0
                },
                {
                    "name": "initialState",
                    "value": 0
                },
                {
                    "name": "sequentialOrder",
                    "value": False
                },
                {
                    "name": "firstAndLast",
                    "value": False
                },
                {
                    "name": "contentLayout",
                    "value": 0
                }
            ],
            "implementationName": "qBittorrent",
            "implementation": "QBittorrent",
            "configContract": "QBittorrentSettings",
            "infoLink": "https://wiki.servarr.com/prowlarr/supported#qbittorrent",
            "tags": []
        }
    )
    if res["code"] != 201:
        logger.error("There was an error while setting qBittorrent in Prowlarr!")
        sys.exit(1)

if indexer_proxy_exists("FlareSolverr"):
    logger.info("FlareSolverr indexer proxy already configured; skipping")
else:
    logger.info("Registering Flaresolverr indexer proxy")
    res = post(
        url=indexer_proxy_endpoint,
        headers=headers,
        body={
            "onHealthIssue": False,
            "supportsOnHealthIssue": False,
            "includeHealthWarnings": False,
            "name": "FlareSolverr",
            "fields": [
                {
                    "name": "host",
                    "value": "http://{}/".format(FLARESOLVERR_SERVICE)
                },
                {
                    "name": "requestTimeout",
                    "value": 60
                }
            ],
            "implementationName": "FlareSolverr",
            "implementation": "FlareSolverr",
            "configContract": "FlareSolverrSettings",
            "infoLink": "https://wiki.servarr.com/prowlarr/supported#flaresolverr",
            "tags": [ 1 ]
        }
    )
    if res["code"] != 201:
        logger.error("There was an error while setting Flaresolverr indexer proxy!")
        sys.exit(1)

logger.info("Setting Prowlarr indexers")
indexersFile = "/mnt/indexers.json"
if os.path.isfile(indexersFile):
    logger.info("Setting Prowlarr indexers")
    with open(indexersFile) as file:
        indexers = json.load(file)
    for index in indexers:
        index_name = index.get("name", "")
        if indexer_exists(index_name):
            logger.info("%s indexer already configured; skipping", index_name)
            continue
        logger.debug("Setup {} index".format(index_name))
        res = post(
            url="http://{}/api/v1/indexer".format(PROWLARR_HOST),
            body=index["body"],
            headers={ **headers, "X-Prowlarr-Client": "true" }
        )
        if res["code"] != 201:
            logger.error("There was an error while setting the indexer {}!".format(index_name))
            sys.exit(1)
        else:
            logger.info("{} indexer setup successfully".format(index_name))
