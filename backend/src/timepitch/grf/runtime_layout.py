"""Pinned native layout; also imported by the standalone Python 3.10 worker."""
from pathlib import Path
import sys

PLATFORM = sys.platform
LINUX_STATS_SHA256 = '33355119d54b77ec2d1696f5ad83c8409a785039cb2dd459f3e2c2e8457a6ca3'
WINDOWS_DLLS = ('SDL2.dll', 'SDL2_gfx.dll', 'SDL2_image.dll', 'SDL2_ttf.dll',
    'boost_python310-vc141-mt-x64-1_78.dll', 'boost_filesystem-vc141-mt-x64-1_78.dll',
    'boost_thread-vc141-mt-x64-1_78.dll', 'brotlicommon.dll', 'brotlidec.dll', 'bz2.dll',
    'freetype.dll', 'libpng16.dll', 'python310.dll', 'zlib1.dll')


def native_binary(native):
    if PLATFORM not in ('win32', 'linux'):
        raise OSError('Unsupported GRF platform')
    return Path(native)/('_gameplayfootball.pyd' if PLATFORM == 'win32' else '_gameplayfootball.so')


def package_directory(python):
    python = Path(python)
    if PLATFORM == 'win32':
        return python.parent/'Lib/site-packages'
    return python.parent.parent/'lib/python3.10/site-packages'


def required_libraries(native):
    return [Path(native)/name for name in WINDOWS_DLLS] if PLATFORM == 'win32' else []
