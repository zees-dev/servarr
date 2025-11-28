#!/usr/local/bin/python3

import json
import logging
import os
import sqlite3
import sys
import requests

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)
console_handler = logging.StreamHandler()
log_format = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
console_handler.setFormatter(log_format)
logger.addHandler(console_handler)

JELLYFIN_HOST = os.getenv("JELLYFIN_HOST", "localhost:8096")
JELLYFIN_USERNAME = os.getenv("JELLYFIN_USERNAME", "admin")
JELLYFIN_PASSWORD = os.getenv("JELLYFIN_PASSWORD", "admin123")
COUNTRY_CODE = os.getenv("COUNTRY_CODE", "US")
PREFERRED_LANGUAGE = os.getenv("PREFERRED_LANGUAGE", "en-US")
TRANSCODER_ENABLED = os.getenv("JELLYFIN_TRANSCODER_ENABLED", "false").lower() in ("1", "true", "yes", "on")
TRANSCODER_BODY_FILE = os.getenv("JELLYFIN_TRANSCODER_BODY_FILE", "/config/jellyfin-transcoder-body.json")

def get(url: str, headers: dict):
    logger.debug(" ".join([
        "GET",
        url,
        ", ".join(f'{key}: {value}' for key,value in headers.items())
    ]))
    response = requests.get(
        url=url,
        headers=headers
    )
    logger.debug(" ".join([
        "Status Code:",
        str(response.status_code),
        "Response body:",
        response.text
    ]))
    return response

class APIError(Exception):
    def __init__(self, status_code: int, body: dict | str):
        super().__init__(status_code, body)
        self.status_code = status_code
        self.body = body

def post(description: str, url: str, headers: dict, body: dict) -> dict:
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

JSON_HEADERS = {"Content-Type": "application/json" }

logger.info("Jellyfin initial setup")
try:
    post(
        "setting the location",
        url="http://{}/Startup/Configuration".format(JELLYFIN_HOST),
        headers=JSON_HEADERS,
        body={
            "UICulture": "en-US",
            "PreferredMetadataLanguage": PREFERRED_LANGUAGE,
            "MetadataCountryCode": COUNTRY_CODE,
        },
    )

    # The following GET seems to be required, otherwise Jellyfin cannot setup the user.
    logger.info("Ping GET user endpoint")
    get("http://{}/Startup/User".format(JELLYFIN_HOST), JSON_HEADERS)

    post(
        "setting the user {}".format(JELLYFIN_USERNAME),
        url="http://{}/Startup/User".format(JELLYFIN_HOST),
        headers=JSON_HEADERS,
        body={
            "Name": JELLYFIN_USERNAME,
            "Password": JELLYFIN_PASSWORD
        },
    )

    post(
        "setting the library",
        url="http://{}/Library/VirtualFolders?refreshLibrary=false&name=Library".format(JELLYFIN_HOST),
        headers=JSON_HEADERS,
        body={
            "LibraryOptions": {
                "EnableArchiveMediaFiles": False,
                "EnablePhotos": True,
                "EnableRealtimeMonitor": True,
                "ExtractChapterImagesDuringLibraryScan": True,
                "EnableChapterImageExtraction": True,
                "EnableInternetProviders": True,
                "SaveLocalMetadata": True,
                "EnableAutomaticSeriesGrouping": False,
                "PreferredMetadataLanguage": PREFERRED_LANGUAGE,
                "MetadataCountryCode": COUNTRY_CODE,
                "SeasonZeroDisplayName": "Specials",
                "AutomaticRefreshIntervalDays": 0,
                "EnableEmbeddedTitles": False,
                "EnableEmbeddedEpisodeInfos": False,
                "AllowEmbeddedSubtitles": "AllowAll",
                "SkipSubtitlesIfEmbeddedSubtitlesPresent": False,
                "SkipSubtitlesIfAudioTrackMatches": False,
                "SaveSubtitlesWithMedia": True,
                "RequirePerfectSubtitleMatch": True,
                "AutomaticallyAddToCollection": False,
                "MetadataSavers": [],
                "TypeOptions": [
                    {
                        "Type": "Series",
                        "MetadataFetchers": [
                            "TheMovieDb",
                            "The Open Movie Database"
                        ],
                        "MetadataFetcherOrder": [
                            "TheMovieDb",
                            "The Open Movie Database"
                        ],
                        "ImageFetchers": [
                            "TheMovieDb"
                        ],
                        "ImageFetcherOrder": [
                            "TheMovieDb"
                        ]
                    },
                    {
                        "Type": "Season",
                        "MetadataFetchers": [
                            "TheMovieDb"
                        ],
                        "MetadataFetcherOrder": [
                            "TheMovieDb"
                        ],
                        "ImageFetchers": [
                            "TheMovieDb"
                        ],
                        "ImageFetcherOrder": [
                            "TheMovieDb"
                        ]
                    },
                    {
                        "Type": "Episode",
                        "MetadataFetchers": [
                            "TheMovieDb",
                            "The Open Movie Database"
                        ],
                        "MetadataFetcherOrder": [
                            "TheMovieDb",
                            "The Open Movie Database"
                        ],
                        "ImageFetchers": [
                            "TheMovieDb",
                            "The Open Movie Database",
                            "Embedded Image Extractor",
                            "Screen Grabber"
                        ],
                        "ImageFetcherOrder": [
                            "TheMovieDb",
                            "The Open Movie Database",
                            "Embedded Image Extractor",
                            "Screen Grabber"
                        ]
                    },
                    {
                        "Type": "Movie",
                        "MetadataFetchers": [
                            "TheMovieDb",
                            "The Open Movie Database"
                        ],
                        "MetadataFetcherOrder": [
                            "TheMovieDb",
                            "The Open Movie Database"
                        ],
                        "ImageFetchers": [
                            "TheMovieDb",
                            "The Open Movie Database",
                            "Embedded Image Extractor",
                            "Screen Grabber"
                        ],
                        "ImageFetcherOrder": [
                            "TheMovieDb",
                            "The Open Movie Database",
                            "Embedded Image Extractor",
                            "Screen Grabber"
                        ]
                    }
                ],
                "LocalMetadataReaderOrder": [
                    "Nfo"
                ],
                "SubtitleDownloadLanguages": [],
                "DisabledSubtitleFetchers": [],
                "SubtitleFetcherOrder": [],
                "PathInfos": [ { "Path": "/mnt/media" } ],
            }
        },
    )

    logger.info("Setup the remote access")
    post(
        "setting the remote access",
        url="http://{}/Startup/RemoteAccess".format(JELLYFIN_HOST),
        headers=JSON_HEADERS,
        body={
            "EnableRemoteAccess": True,
            "EnableAutomaticPortMapping": False
        },
    )

    logger.info("finalize the setup")
    post(
        "finalizing the Jellyfin setup",
        url="http://{}/Startup/Complete".format(JELLYFIN_HOST),
        headers={},
        body={},
    )
except APIError as exc:
    if exc.status_code == 401:
        logger.info("Jellyfin setup already completed")
    else:
        logger.error("Received unexpected status code %s while setting the location: %s", exc.status_code, exc.body)
        sys.exit(1)

if TRANSCODER_ENABLED:
    logger.info("Setting hardware accelerated transcoding via Jellyfin API")
    auth = post(
        "authenticate admin",
        url=f"http://{JELLYFIN_HOST}/Users/AuthenticateByName",
        headers={
            **JSON_HEADERS,
            "X-Emby-Authorization": (
                'MediaBrowser Client="servarr-init", '
                'Device="init-job", DeviceId="init-jellyfin", Version="0.1"'
            ),
        },
        body={"Username": JELLYFIN_USERNAME, "Pw": JELLYFIN_PASSWORD},
    )
    api_key = auth["AccessToken"]

    if not os.path.isfile(TRANSCODER_BODY_FILE):
        logger.error("Transcoder configuration file %s not found", TRANSCODER_BODY_FILE)
        sys.exit(1)

    try:
        with open(TRANSCODER_BODY_FILE, encoding="utf-8") as transcoder_file:
            transcoder_body = json.load(transcoder_file)
    except json.JSONDecodeError as exc:
        logger.error("Unable to decode transcoder configuration file %s: %s", TRANSCODER_BODY_FILE, exc)
        sys.exit(1)

    post(
        "setting hardware accelerated transcoding",
        url="http://{}/System/Configuration/encoding".format(JELLYFIN_HOST),
        headers={ **JSON_HEADERS, 'Authorization': f"MediaBrowser Token={api_key}" },
        body=transcoder_body,
    )
else:
    logger.info("Skipping hardware accelerated transcoding configuration because it is disabled")
