#!/usr/local/bin/python3

from json import JSONDecodeError, dumps
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

SONARR_HOST = os.getenv("SONARR_HOST")
CONFIG_PATH = os.getenv("SONARR_CONFIG_PATH", "/config/config.xml")
TORRENT_USERNAME = os.getenv("TORRENT_ADMIN")
TORRENT_PASSWORD = os.getenv("TORRENT_PASSWORD")
TORRENT_SERVICE = os.getenv("TORRENT_SERVICE")

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

def _request(method: str, url: str, body: dict, acceptable_response=None, skip_message=None):
    logger.debug(" ".join([
        method.upper(),
        url,
        ", ".join(f'{key}: {value}' for key,value in headers.items()),
        str(body)
    ]))

    response = requests.request(
        method=method.lower(),
        url=url,
        json=body,
        headers=headers
    )

    logger.debug(" ".join([
        "Status Code:",
        str(response.status_code),
        "Response body:",
        response.text
    ]))

    try:
        payload = response.json()
    except JSONDecodeError:
        payload = response.text

    def normalize(value):
        if value is None:
            return None
        if isinstance(value, (dict, list)):
            value = dumps(value, sort_keys=True)
        return "".join(str(value).split()).lower()

    if response.status_code >= 300:
        matched_expected = False
        if acceptable_response:
            expected_status, expected_body = acceptable_response
            if response.status_code == expected_status:
                normalized_expected = normalize(expected_body)
                normalized_actual = normalize(payload)
                if normalized_expected is None or (
                    normalized_actual is not None
                    and normalized_expected in normalized_actual
                ):
                    matched_expected = True
                    if skip_message:
                        logger.info(skip_message)
                    else:
                        logger.info(
                            "Received expected %s response from %s; continuing initialization.",
                            response.status_code,
                            url,
                        )
        if not matched_expected:
            response.raise_for_status()

    return payload


def configure_or_exit(description: str, url: str, body: dict, acceptable_response=None, skip_message=None, method: str = "post"):
    try:
        return _request(
            method=method,
            url=url,
            body=body,
            acceptable_response=acceptable_response,
            skip_message=skip_message,
        )
    except requests.HTTPError:
        logger.error("There was an error while %s!", description)
        sys.exit(1)


# Load API Keys
logger.info("Loading Sonarr API Key from %s", CONFIG_PATH)
API_KEY = load_api_key(CONFIG_PATH, "Sonarr")
logger.info("Loaded Sonarr API Key: %s", API_KEY)

# common headers for all requests
headers = {
    "content-type": "application/json",
    "x-api-key": API_KEY,
    "x-requested-with": "XMLHttpRequest"
}

logger.info("Setup Sonarr and qBitTorrent interworking")
configure_or_exit(
    "setting qBitTorrent in Sonarr",
    url="http://{}/api/v3/downloadclient".format(SONARR_HOST),
    body={
        "enable": True,
        "protocol": "torrent",
        "priority": 1,
        "removeCompletedDownloads": True,
        "removeFailedDownloads": True,
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
                "name": "movieCategory",
                "value": "radarr"
            },
            {
                "name": "movieImportedCategory"
            },
            {
                "name": "recentMoviePriority",
                "value": 0
            },
            {
                "name": "olderMoviePriority",
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
        "infoLink": "https://wiki.servarr.com/radarr/supported#qbittorrent",
        "tags": []
    },
    acceptable_response=(400, "Should be unique"),
    skip_message="qBitTorrent already configured in Sonarr; skipping",
)

logger.info("Setup qBitTorrent Remote Path Mapping in Sonarr")
configure_or_exit(
    "setting the Remote Path Mapping",
    url="http://{}/api/v3/remotepathmapping".format(SONARR_HOST),
    body={
        "host": TORRENT_SERVICE,
        "remotePath": "/downloads",
        "localPath": "/mnt/downloads/"
    },
    acceptable_response=(500, "RemotePath already configured."),
    skip_message="Remote Path Mapping already configured in Sonarr; skipping",
)

logger.info("Setup Root Folder in Sonarr")
configure_or_exit(
    "setting the Root Folder",
    url="http://{}/api/v3/rootFolder".format(SONARR_HOST),
    body={ "path":"/mnt/media/" },
    acceptable_response=(400, "already configured as a root folder"),
    skip_message="Root folder already configured in Sonarr; skipping",
)

logger.info("Configuring Sonarr media management defaults")
configure_or_exit(
    "configuring Sonarr media management settings",
    method="put",
    url="http://{}/api/v3/config/mediamanagement".format(SONARR_HOST),
    body={
        "autoUnmonitorPreviouslyDownloadedEpisodes": True,
        "recycleBin": "",
        "recycleBinCleanupDays": 7,
        "downloadPropersAndRepacks": "preferAndUpgrade",
        "createEmptySeriesFolders": False,
        "deleteEmptyFolders": False,
        "fileDate": "none",
        "rescanAfterRefresh": "always",
        "setPermissionsLinux": False,
        "chmodFolder": "755",
        "chownGroup": "",
        "episodeTitleRequired": "always",
        "skipFreeSpaceCheckWhenImporting": False,
        "minimumFreeSpaceWhenImporting": 100,
        "copyUsingHardlinks": True,
        "useScriptImport": False,
        "scriptImportPath": "",
        "importExtraFiles": False,
        "extraFileExtensions": "srt",
        "enableMediaInfo": True,
        "id": 1,
    },
)
