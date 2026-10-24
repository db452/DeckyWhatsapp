#!/usr/bin/env python3
"""Build reproducible, secret-free PC companion ZIPs from explicit allowlists."""

from __future__ import annotations

import argparse
import json
import os
import re
import stat
import tempfile
import zipfile
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parent.parent
COMMON_FILES = (
    ".env.example",
    "LICENSE",
    "README.md",
    "package.json",
    "package-lock.json",
    "scripts/deck-host-prompt.ps1",
    "scripts/read-bridge-port.mjs",
    "scripts/suggest-deck-host.mjs",
    "src/server.ts",
    "src/types.ts",
    "src/whatsapp.ts",
    "src/whatsapp/media.ts",
    "src/whatsapp/runtime.ts",
    "patches/whatsapp-web.js+1.34.7.patch",
    "docs/ARCHITECTURE.md",
    "docs/DEVELOPMENT.md",
    "docs/LINUX.md",
    "docs/SECURITY.md",
    "docs/THIRD-PARTY-NOTICES.md",
    "docs/WINDOWS.md",
)
PLATFORMS = {
    "windows": {
        "archive_prefix": "decky-whatsapp-pc-windows-v",
        "files": COMMON_FILES + (
            "install-decky-whatsapp-windows.ps1",
            "start-decky-whatsapp.bat",
            "assets/decky-whatsapp.ico",
            "keep-ssh-tunnel.ps1",
            "manage-decky-whatsapp.ps1",
            "install-whisper-deck.sh",
        ),
        "executables": set(),
    },
    "linux": {
        "archive_prefix": "decky-whatsapp-pc-linux-v",
        "files": COMMON_FILES + (
            "install-decky-whatsapp-linux.sh",
            "start-decky-whatsapp-linux.sh",
            "assets/decky-whatsapp.svg",
            "keep-ssh-tunnel.sh",
            "scripts/launcher-validation.sh",
            "scripts/linux-bridge-helper.mjs",
            "scripts/linux-deck-host-config.sh",
        ),
        "executables": {
            "install-decky-whatsapp-linux.sh",
            "start-decky-whatsapp-linux.sh",
            "keep-ssh-tunnel.sh",
        },
    },
}
FORBIDDEN_SEGMENT = re.compile(r"^(node_modules|\.wwebjs_auth.*|\.wwebjs_cache.*)$", re.IGNORECASE)
FORBIDDEN_TOKEN = re.compile(r"^(bridge-token.*|.*\.token|.*\.log(?:\..*)?)$", re.IGNORECASE)
VERSION_PATTERN = re.compile(r"^\d+\.\d+\.\d+(?:[.-][A-Za-z0-9.-]+)?$")


def is_forbidden(member_name: str) -> bool:
    for segment in PurePosixPath(member_name).parts:
        if FORBIDDEN_SEGMENT.fullmatch(segment):
            return True
        if segment.startswith(".env") and segment != ".env.example":
            return True
        if FORBIDDEN_TOKEN.fullmatch(segment):
            return True
    return False


def package_one(platform: str, version: str, output_dir: Path) -> Path:
    specification = PLATFORMS[platform]
    archive_name = f"{specification['archive_prefix']}{version}.zip"
    archive_path = output_dir / archive_name
    if archive_path.exists():
        raise FileExistsError(f"Refusing to overwrite existing companion archive: {archive_path}")

    package_root = archive_name.removesuffix(".zip")
    entries: list[tuple[str, Path]] = []
    for relative_path in specification["files"]:
        source = ROOT / relative_path
        if not source.is_file():
            raise FileNotFoundError(f"Required allowlisted package file is missing: {relative_path}")
        member_name = f"{package_root}/{relative_path.replace(os.sep, '/') }"
        if is_forbidden(member_name):
            raise ValueError(f"The package allowlist contains a forbidden path: {relative_path}")
        entries.append((member_name, source))

    output_dir.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{archive_name}.", suffix=".tmp", dir=output_dir)
    os.close(descriptor)
    temporary_path = Path(temporary_name)
    try:
        with zipfile.ZipFile(temporary_path, mode="w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for member_name, source in sorted(entries):
                executable = source.relative_to(ROOT).as_posix() in specification["executables"]
                mode = stat.S_IFREG | (0o755 if executable else 0o644)
                info = zipfile.ZipInfo(member_name, date_time=(1980, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = mode << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, source.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)

        with zipfile.ZipFile(temporary_path, mode="r") as archive:
            bad_member = archive.testzip()
            if bad_member is not None:
                raise ValueError(f"ZIP integrity check failed at {bad_member}")
            members = archive.namelist()
            forbidden = [name for name in members if is_forbidden(name)]
            if forbidden:
                raise ValueError(f"Refusing package containing private/generated files: {forbidden}")
            expected = {name for name, _source in entries}
            if set(members) != expected:
                raise ValueError("ZIP entries differ from the explicit package allowlist")

        # A hard link publishes atomically and fails if another build created the target meanwhile.
        os.link(temporary_path, archive_path)
    finally:
        temporary_path.unlink(missing_ok=True)

    print(f"Created {archive_path}")
    return archive_path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--platform", choices=("linux", "windows", "all"), default="all")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "releases")
    args = parser.parse_args()

    with (ROOT / "package.json").open(encoding="utf-8") as manifest:
        version = json.load(manifest)["version"]
    if not isinstance(version, str) or not VERSION_PATTERN.fullmatch(version):
        parser.error(f"package.json has an invalid version: {version!r}")

    platforms = tuple(PLATFORMS) if args.platform == "all" else (args.platform,)
    outputs = args.output_dir.resolve()
    for platform in platforms:
        package_one(platform, version, outputs)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
