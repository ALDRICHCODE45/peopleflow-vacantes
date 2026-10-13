"""Human-only local bootstrap supervisor. Import/help never loads dotenv."""
import ipaddress
import json
import os
import secrets
import shutil
import signal
import stat
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[2]
FRONT_KEYS = ('NEXTAUTH_URL', 'NEXTAUTH_SECRET', 'COGNITO_CLIENT_ID',
              'COGNITO_CLIENT_SECRET', 'COGNITO_ISSUER', 'COGNITO_DOMAIN')
BACK_KEYS = ('DATABASE_URL', 'IDENTITY_JWT_ISSUER', 'IDENTITY_JWT_CLIENT_ID',
             'IDENTITY_JWT_AUDIENCE', 'IDENTITY_JWT_CACHE_TTL', 'IDENTITY_JWT_FETCH_TIMEOUT')
FRONT_FILES = ('.env.development.local', '.env.local', '.env.development', '.env')
HELP = '''TMP-IDENTITY-001 private launcher (Linux/POSIX)
No dotenv reads or services without --launch. Default and --help only show help.
Future human invocation, AFTER separate private-file/service authorization:
  python3 tools/local-identity-bootstrap/launcher.py --launch \\
    --frontend-root <absolute frontend directory> --backend-binary <prebuilt executable>
Private-file scope: backend/.env and frontend/{.env.development.local,.env.local,
.env.development,.env}, including development reloads. Never run from agent tools.
Requires a foreground controlling terminal; approve only through Go's private TTY.
No secrets in arguments/history/files/output. Child logs suppressed, no automatic retry.
Next dev can write .next/tooling and access Cognito; launch is NOT read-only.
Processes stop after Go exit, child failure, interrupt or ten-minute timeout.
A zero exit is NOT proof an account was created; rejection also ends cleanly.
'''


class PrivateFailure(Exception):
    """Only fixed safe codes cross the public output boundary."""


def safe_env():
    # Do not inherit credentials, proxy settings, NODE_OPTIONS or loader injection.
    return {'PATH': os.defpath, 'LANG': 'C.UTF-8', 'PYTHONDONTWRITEBYTECODE': '1'}


def private_file(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as handle:
        if not stat.S_ISREG(os.fstat(handle.fileno()).st_mode):
            raise PrivateFailure('PRIVATE_CONFIGURATION_LOAD_FAILED')
        data = handle.read(131073)
        if len(data) > 131072:
            raise PrivateFailure('PRIVATE_CONFIGURATION_LOAD_FAILED')
        return data.decode('utf-8')


def load_config(frontend, directory, names, keys, node):
    try:
        files = []
        for name in names:
            path = directory / name
            try:
                contents = private_file(path)
            except FileNotFoundError:
                continue
            files.append({'path': name, 'contents': contents})
        payload = {'nextRoot': str(frontend), 'files': files, 'keys': keys}
        result = subprocess.run(
            [node, str(Path(__file__).with_name('load-env.cjs'))],
            input=json.dumps(payload), env=safe_env(), capture_output=True,
            text=True, timeout=5, check=False,
        )
        if result.returncode or result.stderr:
            raise PrivateFailure('PRIVATE_CONFIGURATION_LOAD_FAILED')
        response = json.loads(result.stdout)
        env = response['env']
        if not isinstance(env, dict) or any(k not in keys or not isinstance(v, str) for k, v in env.items()):
            raise PrivateFailure('PRIVATE_CONFIGURATION_LOAD_FAILED')
        return env, response['nextCLI']
    except Exception:
        # Never print child stdout/stderr, parser exceptions, file paths or values.
        raise PrivateFailure('PRIVATE_CONFIGURATION_LOAD_FAILED') from None


def origin(value, scheme, local=False):
    parsed = urlsplit(value)
    if (parsed.scheme != scheme or not parsed.hostname or parsed.username is not None
            or parsed.password is not None or parsed.path or parsed.query
            or parsed.fragment or '?' in value or '#' in value):
        raise ValueError('origin')
    if local and parsed.hostname not in ('localhost', '127.0.0.1', '::1'):
        raise ValueError('loopback')
    if parsed.port is not None and not 1 <= parsed.port <= 65535:
        raise ValueError('port')
    return parsed


def is_loopback_host(host):
    """Mirror backend isLoopbackHost: localhost alias or Go-style loopback IP."""
    if not host:
        return False
    if host.lower() == 'localhost':
        return True
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return False
    # Go's net.IP.IsLoopback treats IPv4-mapped IPv6 (::ffff:a.b.c.d) as IPv4.
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        address = address.ipv4_mapped
    return address.is_loopback


def prepare(back, front):
    """Static checks only; applications still own final config/identity validation."""
    try:
        if any(not front.get(k, '').strip() for k in FRONT_KEYS):
            raise ValueError('required')
        front = {k: v.strip() for k, v in front.items()}
        site = origin(front['NEXTAUTH_URL'], 'http', local=True)
        origin(front['COGNITO_DOMAIN'], 'https')
        issuer = urlsplit(front['COGNITO_ISSUER'])
        if (issuer.scheme != 'https' or not issuer.hostname or issuer.username is not None
                or issuer.query or issuer.fragment or len(issuer.path.strip('/').split('/')) != 1
                or not issuer.path.strip('/')):
            raise ValueError('issuer')
        if (back.get('IDENTITY_JWT_ISSUER', '').strip().rstrip('/') != front['COGNITO_ISSUER'].rstrip('/')
                or back.get('IDENTITY_JWT_CLIENT_ID', '').strip() != front['COGNITO_CLIENT_ID']):
            raise ValueError('identity mismatch')
        db = urlsplit(back.get('DATABASE_URL', ''))
        if (db.scheme not in ('postgres', 'postgresql') or not is_loopback_host(db.hostname)
                or not db.path.strip('/') or any(k in parse_qs(db.query, keep_blank_values=True)
                                                 for k in ('host', 'hostaddr', 'service', 'servicefile',
                                                           'passfile', 'target_session_attrs'))):
            raise ValueError('database')
        key = secrets.token_hex(32)
        backend = {**safe_env(), **back, 'APP_ENV': 'local',
                   'IDENTITY_JWT_MODE': 'jwks', 'IDENTITY_JWT_TOKEN_USE': 'access',
                   'IDENTITY_JWT_CACHE_TTL': back.get('IDENTITY_JWT_CACHE_TTL') or '5m',
                   'IDENTITY_JWT_FETCH_TIMEOUT': back.get('IDENTITY_JWT_FETCH_TIMEOUT') or '5s',
                   'IDENTITY_LOCAL_BOOTSTRAP_ENABLED': 'true',
                   'IDENTITY_LOCAL_BOOTSTRAP_ADDR': '127.0.0.1:8081',
                   'IDENTITY_LOCAL_BOOTSTRAP_USER_TYPE': 'recruiter',
                   'IDENTITY_LOCAL_BOOTSTRAP_COGNITO_DOMAIN': front['COGNITO_DOMAIN'],
                   'IDENTITY_LOCAL_BOOTSTRAP_KEY': key}
        frontend = {**safe_env(), **front, 'NODE_ENV': 'development',
                    'NEXT_TELEMETRY_DISABLED': '1',
                    'PEOPLEFLOW_LOCAL_BOOTSTRAP_ENABLED': 'true',
                    'PEOPLEFLOW_LOCAL_BOOTSTRAP_BASE_URL': 'http://127.0.0.1:8081',
                    'PEOPLEFLOW_LOCAL_BOOTSTRAP_KEY': key}
        return backend, frontend, site
    except Exception:
        raise PrivateFailure('PRIVATE_CONFIGURATION_REJECTED') from None


def stop_child(child, group=False):
    if child is None:
        return
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            if group:
                os.killpg(child.pid, sig)
            elif child.poll() is None:
                child.send_signal(sig)
        except ProcessLookupError:
            pass
        try:
            child.wait(timeout=2)
        except subprocess.TimeoutExpired:
            continue
        # A dead group leader can leave workers behind; still send group SIGKILL.
        if not group:
            break


def supervise(node, cli, binary, frontend, back_env, front_env, site):
    next_child = go_child = None
    try:
        next_child = subprocess.Popen(
            [node, cli, 'dev', '--hostname', site.hostname, '--port', str(site.port or 80)],
            cwd=frontend, env=front_env, stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True,
        )
        # Direct prebuilt binary, same foreground session/group: /dev/tty remains human-owned.
        go_child = subprocess.Popen(
            [str(binary)], cwd=ROOT / 'backend', env=back_env,
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        deadline = time.monotonic() + 600
        while time.monotonic() < deadline:
            if go_child.poll() is not None:
                if go_child.returncode:
                    raise PrivateFailure('PRIVATE_BACKEND_EXIT_FAILED_NO_RETRY')
                return
            if next_child.poll() is not None:
                raise PrivateFailure('PRIVATE_FRONTEND_EXIT_NO_RETRY')
            time.sleep(.05)
        raise PrivateFailure('PRIVATE_LAUNCH_TIMEOUT_NO_RETRY')
    except PrivateFailure:
        raise
    except KeyboardInterrupt:
        raise
    except Exception:
        raise PrivateFailure('PRIVATE_CHILD_START_FAILED_NO_RETRY') from None
    finally:
        # Nested finally ensures both are stopped even if one teardown fails.
        try:
            stop_child(go_child)
        finally:
            stop_child(next_child, group=True)


def interrupt(_signum, _frame):
    raise KeyboardInterrupt


def main(args):
    if args in ([], ['--help'], ['-h']):
        print(HELP, end='')
        return 0
    if (len(args) != 5 or args[0] != '--launch'
            or args[1] != '--frontend-root' or args[3] != '--backend-binary'):
        print('PRIVATE_ARGUMENTS_REJECTED', file=sys.stderr)
        return 2
    previous = signal.signal(signal.SIGTERM, interrupt)
    try:
        # Gate before any dotenv read, entropy generation or child spawn.
        try:
            with open('/dev/tty', 'rb', buffering=0) as tty:
                if not tty.isatty() or os.tcgetpgrp(tty.fileno()) != os.getpgrp():
                    raise OSError('not foreground')
        except OSError:
            raise PrivateFailure('PRIVATE_INTERACTIVE_TERMINAL_REQUIRED') from None
        frontend, binary = Path(args[2]), Path(args[4])
        if not frontend.is_absolute() or not binary.is_absolute() or not frontend.is_dir() or not binary.is_file() or not os.access(binary, os.X_OK):
            raise PrivateFailure('PRIVATE_PATHS_REJECTED')
        node = shutil.which('node')
        if node is None:
            raise PrivateFailure('PRIVATE_NODE_UNAVAILABLE')
        back, _ = load_config(frontend, ROOT / 'backend', ('.env',), BACK_KEYS, node)
        front, cli = load_config(frontend, frontend, FRONT_FILES, FRONT_KEYS, node)
        back_env, front_env, site = prepare(back, front)
        supervise(node, cli, binary, frontend, back_env, front_env, site)
        print('PRIVATE_LAUNCH_ENDED; account outcome requires separate confirmation')
        return 0
    except KeyboardInterrupt:
        print('PRIVATE_LAUNCH_INTERRUPTED_NO_RETRY', file=sys.stderr)
        return 130
    except PrivateFailure as failure:
        print(str(failure), file=sys.stderr)
        return 2
    except Exception:
        print('PRIVATE_LAUNCH_UNAVAILABLE_NO_RETRY', file=sys.stderr)
        return 2
    finally:
        signal.signal(signal.SIGTERM, previous)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
