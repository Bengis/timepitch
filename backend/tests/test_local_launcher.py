from pathlib import Path
import socket
import subprocess

ROOT = Path(__file__).resolve().parents[2]


def test_launcher_diagnoses_occupied_port_without_stopping_its_owner():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0)); listener.listen()
        port = listener.getsockname()[1]
        result = subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
            str(ROOT / 'scripts/start-local.ps1'), '-Port', str(port), '-SkipBuild', '-CheckOnly'],
            capture_output=True, text=True, timeout=20)
        assert result.returncode != 0
        assert 'already in use' in result.stdout + result.stderr
        with socket.create_connection(('127.0.0.1', port), timeout=1): pass


def test_launcher_checks_dependencies_without_starting_a_server():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0)); port = listener.getsockname()[1]
    result = subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        str(ROOT / 'scripts/start-local.ps1'), '-Port', str(port), '-SkipBuild', '-CheckOnly'],
        capture_output=True, text=True, timeout=20)
    assert result.returncode == 0, result.stdout + result.stderr
    assert 'Local preflight passed' in result.stdout
    with socket.socket() as check: assert check.connect_ex(('127.0.0.1', port)) != 0
