"""Public CLI probes with isolated dotenv fixtures and fake children only."""
import hashlib
import json
import os
import pty
import select
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

SOURCE = Path(__file__).parent


class LauncherTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=SOURCE)
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.tool = self.root / 'tools' / 'local-identity-bootstrap'
        self.tool.mkdir(parents=True)
        for name in ('launcher.py', 'load-env.cjs'):
            shutil.copyfile(SOURCE / name, self.tool / name)
        self.backend = self.root / 'backend'
        self.backend.mkdir()
        self.frontend = self.root / 'frontend'
        self.frontend.mkdir()
        self.goenv = self.backend / '.env'
        self.goenv.write_text('DATABASE_URL=postgres://fake:fixture@127.0.0.1:5432/disposable\nIDENTITY_JWT_ISSUER=https://identity.example.invalid/pool\nIDENTITY_JWT_CLIENT_ID=fixture-client\n')
        self.feenv = self.frontend / '.env'
        self.feenv.write_text('NEXTAUTH_URL=http://127.0.0.1:3000\nNEXTAUTH_SECRET=FAKE_AUTH_SECRET\nCOGNITO_CLIENT_ID=fixture-client\nCOGNITO_CLIENT_SECRET=FAKE_CLIENT_SECRET\nCOGNITO_ISSUER=https://identity.example.invalid/pool\nCOGNITO_DOMAIN=https://login.example.invalid\nDATABASE_URL=DO_NOT_FORWARD\nNODE_OPTIONS=DO_NOT_FORWARD\n')
        # This dependency fixture tests protocol wiring, not Next dotenv semantics.
        package = self.frontend / 'node_modules' / 'next'
        package.mkdir(parents=True)
        (package / 'package.json').write_text('{"name":"next","main":"index.js"}')
        (package / 'index.js').write_text('')
        module = package / 'node_modules' / '@next' / 'env'
        module.mkdir(parents=True)
        (module / 'index.js').write_text("exports.processEnv=(files,root,logger,force)=>{const env={...process.env};for(const f of files)for(const line of f.contents.split('\\n')){const i=line.indexOf('=');if(i>0){const k=line.slice(0,i);if(!(k in env))env[k]=line.slice(i+1);}}return [env,{}];};")
        cli = package / 'dist' / 'bin'
        cli.mkdir(parents=True)
        (cli / 'next.js').write_text("const fs=require('fs'),crypto=require('crypto'); console.log('FAKE_CLIENT_SECRET');console.error('FAKE_AUTH_SECRET');const key=process.env.PEOPLEFLOW_LOCAL_BOOTSTRAP_KEY;fs.writeFileSync('frontend-result.json',JSON.stringify({keyHash:crypto.createHash('sha256').update(key).digest('hex'),isolated:!process.env.DATABASE_URL&&!process.env.NODE_OPTIONS&&!process.env.IDENTITY_LOCAL_BOOTSTRAP_KEY,enabled:process.env.PEOPLEFLOW_LOCAL_BOOTSTRAP_ENABLED==='true',dev:process.env.NODE_ENV==='development'}));setInterval(()=>{},1000);")
        self.binary = self.backend / 'fake-bootstrap'
        self.binary.write_text(f'#!{sys.executable}\n' + "import os,json,hashlib,time\nfrom pathlib import Path\nprint('FAKE_CLIENT_SECRET');print('FAKE_AUTH_SECRET',file=__import__('sys').stderr)\nfor _ in range(100):\n if Path('../frontend/frontend-result.json').exists():break\n time.sleep(.01)\ne=os.environ\nwith open('/dev/tty','w') as tty: tty.write('FAKE_PRIVATE_PROMPT\\n'); interactive=tty.isatty()\nPath('backend-result.json').write_text(json.dumps({'keyHash':hashlib.sha256(e['IDENTITY_LOCAL_BOOTSTRAP_KEY'].encode()).hexdigest(),'databaseUrl':e.get('DATABASE_URL'),'isolated':not any(k in e for k in ('NEXTAUTH_SECRET','COGNITO_CLIENT_SECRET','NODE_OPTIONS')),'enabled':e['IDENTITY_LOCAL_BOOTSTRAP_ENABLED']=='true','tty':interactive}))\n")
        self.binary.chmod(0o700)
        self.original = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in (self.goenv, self.feenv)}

    def emergency_fixture_cleanup(self):
        # Only fixture-owned PID files, never project services.
        for directory, group in ((self.frontend, True), (self.backend, False)):
            marker = directory / 'fixture-pid'
            if marker.exists():
                try:
                    pid = int(marker.read_text())
                    (os.killpg if group else os.kill)(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass

    def command(self, *extra):
        return [sys.executable, str(self.tool / 'launcher.py'), '--launch', '--frontend-root', str(self.frontend), '--backend-binary', str(self.binary), *extra]

    def assert_unchanged(self):
        for path, digest in self.original.items():
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), digest)

    def run_tty(self, command, interrupt=False):
        pid, fd = pty.fork()
        if pid == 0:
            # Fixture-only absolute Python executable and argv; never a shell.
            os.execv(command[0], command)  # noqa: S606
        output = bytearray()
        status = None
        try:
            end = time.monotonic() + 8
            while time.monotonic() < end:
                if interrupt and (self.backend / 'backend-result.json').exists():
                    os.kill(pid, signal.SIGTERM)
                    interrupt = False
                if select.select([fd], [], [], .05)[0]:
                    try:
                        chunk = os.read(fd, 65536)
                    except OSError:
                        break
                    if not chunk:
                        break
                    output.extend(chunk)
            else:
                os.kill(pid, signal.SIGKILL)
                self.fail('fixture CLI timeout')
        finally:
            _, status = os.waitpid(pid, 0)
            os.close(fd)
        return os.waitstatus_to_exitcode(status), output.decode().replace('\r\n', '\n')

    def test_help_and_default_do_not_read_or_launch(self):
        for args in ([], ['--help']):
            result = subprocess.run([sys.executable, str(self.tool / 'launcher.py'), *args], capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, 0)
            self.assertIn('No dotenv reads or services without --launch', result.stdout)
            self.assertEqual(result.stderr, '')
        self.assertFalse((self.frontend / 'frontend-result.json').exists())
        self.assertFalse((self.backend / 'backend-result.json').exists())
        self.assert_unchanged()

    def test_noninteractive_rejected_before_private_loading(self):
        self.goenv.unlink()
        result = subprocess.run(self.command(), capture_output=True, text=True, timeout=5)
        self.assertEqual((result.returncode, result.stdout, result.stderr), (2, '', 'PRIVATE_INTERACTIVE_TERMINAL_REQUIRED\n'))
        self.assertFalse((self.frontend / 'frontend-result.json').exists())
        self.assertFalse((self.backend / 'backend-result.json').exists())

    def test_fake_launch_shared_key_isolation_tty_and_suppressed_logs(self):
        code, output = self.run_tty(self.command())
        self.assertEqual(code, 0)
        self.assertEqual(output, 'FAKE_PRIVATE_PROMPT\nPRIVATE_LAUNCH_ENDED; account outcome requires separate confirmation\n')
        back = json.loads((self.backend / 'backend-result.json').read_text())
        front = json.loads((self.frontend / 'frontend-result.json').read_text())
        self.assertEqual(back['keyHash'], front['keyHash'])
        self.assertTrue(all(back[k] for k in ('isolated', 'enabled', 'tty')))
        self.assertTrue(all(front[k] for k in ('isolated', 'enabled', 'dev')))
        self.assert_unchanged()

    def test_mismatched_identity_rejects_without_children(self):
        self.goenv.write_text(self.goenv.read_text().replace('fixture-client', 'wrong-client'))
        self.original[self.goenv] = hashlib.sha256(self.goenv.read_bytes()).hexdigest()
        code, output = self.run_tty(self.command())
        self.assertEqual((code, output), (2, 'PRIVATE_CONFIGURATION_REJECTED\n'))
        self.assertFalse((self.frontend / 'frontend-result.json').exists())
        self.assertFalse((self.backend / 'backend-result.json').exists())
        self.assert_unchanged()

    def test_remote_database_rejects_without_children(self):
        self.goenv.write_text(self.goenv.read_text().replace('127.0.0.1', 'remote.example.invalid'))
        self.original[self.goenv] = hashlib.sha256(self.goenv.read_bytes()).hexdigest()
        code, output = self.run_tty(self.command())
        self.assertEqual((code, output), (2, 'PRIVATE_CONFIGURATION_REJECTED\n'))
        self.assertFalse((self.frontend / 'frontend-result.json').exists())
        self.assertFalse((self.backend / 'backend-result.json').exists())
        self.assert_unchanged()

    def set_database(self, dsn):
        self.goenv.write_text(
            'DATABASE_URL=' + dsn + '\n'
            'IDENTITY_JWT_ISSUER=https://identity.example.invalid/pool\n'
            'IDENTITY_JWT_CLIENT_ID=fixture-client\n')
        self.original[self.goenv] = hashlib.sha256(self.goenv.read_bytes()).hexdigest()

    def launch_accepted_database(self, dsn):
        self.set_database(dsn)
        code, output = self.run_tty(self.command())
        self.assertEqual((code, output), (0, 'FAKE_PRIVATE_PROMPT\nPRIVATE_LAUNCH_ENDED; account outcome requires separate confirmation\n'))
        back = json.loads((self.backend / 'backend-result.json').read_text())
        self.assertTrue(all(back[k] for k in ('isolated', 'enabled', 'tty')))
        self.assertEqual(back['databaseUrl'], dsn)
        self.assert_unchanged()

    def assert_database_rejected_without_children(self):
        self.assertFalse((self.frontend / 'frontend-result.json').exists())
        self.assertFalse((self.backend / 'backend-result.json').exists())
        self.assert_unchanged()

    def test_database_explicit_loopback_ipv4_still_accepted(self):
        self.launch_accepted_database('postgres://fake:fixture@127.0.0.1:5432/disposable')

    def test_database_localhost_alias_accepts_like_backend(self):
        self.launch_accepted_database('postgres://fake:fixture@localhost:5432/disposable')

    def test_database_localhost_alias_is_case_insensitive(self):
        self.launch_accepted_database('postgres://fake:fixture@LOCALHOST:5432/disposable')

    def test_database_literal_loopback_forms_accept_like_backend(self):
        for host in ('[::1]', '[::ffff:127.0.0.1]'):
            with self.subTest(host=host):
                self.launch_accepted_database(f'postgres://fake:fixture@{host}:5432/disposable')

    def test_database_indirection_query_parameters_are_rejected(self):
        keys = ('host', 'hostaddr', 'service', 'servicefile', 'passfile', 'target_session_attrs')
        for key in keys:
            for value in ('evil.example.invalid', ''):
                with self.subTest(key=key, value=value):
                    self.set_database(f'postgres://fake:fixture@127.0.0.1:5432/disposable?{key}={value}')
                    code, output = self.run_tty(self.command())
                    self.assertEqual((code, output), (2, 'PRIVATE_CONFIGURATION_REJECTED\n'))
                    self.assert_database_rejected_without_children()

    def test_sigterm_stops_both_fake_children_without_retry(self):
        self.addCleanup(self.emergency_fixture_cleanup)
        self.binary.write_text(self.binary.read_text() + "Path('fixture-pid').write_text(str(os.getpid()))\ntime.sleep(60)\n")
        cli = self.frontend / 'node_modules' / 'next' / 'dist' / 'bin' / 'next.js'
        cli.write_text("require('fs').writeFileSync('fixture-pid',String(process.pid));" + cli.read_text())
        code, output = self.run_tty(self.command(), interrupt=True)
        self.assertEqual((code, output), (130, 'FAKE_PRIVATE_PROMPT\nPRIVATE_LAUNCH_INTERRUPTED_NO_RETRY\n'))
        for directory in (self.frontend, self.backend):
            pid = int((directory / 'fixture-pid').read_text())
            status = Path(f'/proc/{pid}/stat')
            self.assertTrue(not status.exists() or status.read_text().split()[2] == 'Z')
        self.assert_unchanged()

    def test_loader_failure_is_sanitized_without_children(self):
        module = self.frontend / 'node_modules' / 'next' / 'node_modules' / '@next' / 'env' / 'index.js'
        module.write_text("exports.processEnv=()=>{throw Error('FAKE_CLIENT_SECRET');};")
        code, output = self.run_tty(self.command())
        self.assertEqual((code, output), (2, 'PRIVATE_CONFIGURATION_LOAD_FAILED\n'))
        self.assertFalse((self.frontend / 'frontend-result.json').exists())
        self.assertFalse((self.backend / 'backend-result.json').exists())
        self.assert_unchanged()


if __name__ == '__main__':
    unittest.main()
