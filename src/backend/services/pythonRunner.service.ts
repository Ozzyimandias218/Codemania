import { spawn } from 'node:child_process';
import os from 'node:os';
import type { PythonTestCase } from './codingLessons.ts';

export interface TestCaseResult {
  id: string;
  description: string;
  passed: boolean;
  expected: string;
  actual: string;
  stdout: string;
  error: string | null;
}

export interface PythonRunResult {
  allPassed: boolean;
  passedCount: number;
  totalCount: number;
  timedOut: boolean;
  syntaxError: string | null;
  runtimeError: string | null;
  results: TestCaseResult[];
}

const EXECUTION_TIMEOUT_MS = 4500;
const MAX_BUFFER_BYTES = 64 * 1024;

const PYTHON_HARNESS = `
import ast
import contextlib
import io
import json
import sys
import traceback

BLOCKED_MODULES = {
    'os', 'sys', 'subprocess', 'socket', 'ctypes', 'shutil', 'pathlib',
    'http', 'urllib', 'importlib', 'builtins', 'pty', 'signal', 'threading',
    'multiprocessing', 'asyncio', 'inspect', 'pickle', 'marshal', 'tempfile',
    'glob', 'webbrowser', 'ftplib', 'poplib', 'imaplib', 'smtplib', 'ssl',
    'fcntl', 'resource', 'posix', 'nt', 'gc', 'code', 'codeop'
}

BLOCKED_CALLS = {'open', '__import__', 'eval', 'exec', 'compile', 'input', 'breakpoint', 'exit', 'quit'}

def check_ast_safety(source):
    tree = ast.parse(source, filename='<lesson>', mode='exec')
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                top = alias.name.split('.')[0]
                if top in BLOCKED_MODULES:
                    return f"Import of '{top}' is restricted in the lesson sandbox."
        elif isinstance(node, ast.ImportFrom):
            top = (node.module or '').split('.')[0]
            if top in BLOCKED_MODULES:
                return f"Import from '{top}' is restricted in the lesson sandbox."
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            if node.func.id in BLOCKED_CALLS:
                return f"Built-in '{node.func.id}()' is disabled in the lesson sandbox."
        elif isinstance(node, ast.Attribute):
            if node.attr.startswith('__') and node.attr.endswith('__') and node.attr not in {'__init__', '__str__', '__repr__', '__len__'}:
                return f"Dunder attribute '{node.attr}' is restricted in the lesson sandbox."
    return None

def format_exc(exc):
    return f"{type(exc).__name__}: {exc}"

def main():
    raw = sys.stdin.read()
    payload = json.loads(raw)
    code = payload.get('code', '')
    tests = payload.get('testCases', [])

    try:
        safety_err = check_ast_safety(code)
    except SyntaxError as se:
        line_info = f"line {se.lineno}: " if se.lineno else ""
        msg = f"SyntaxError ({line_info}{se.msg})"
        print(json.dumps({
            'syntaxError': msg,
            'runtimeError': None,
            'results': [
                {
                    'id': t['id'],
                    'description': t['description'],
                    'passed': False,
                    'expected': t['expectedDisplay'],
                    'actual': 'SyntaxError',
                    'stdout': '',
                    'error': msg,
                }
                for t in tests
            ],
        }))
        return

    if safety_err:
        print(json.dumps({
            'syntaxError': None,
            'runtimeError': safety_err,
            'results': [
                {
                    'id': t['id'],
                    'description': t['description'],
                    'passed': False,
                    'expected': t['expectedDisplay'],
                    'actual': 'Restricted',
                    'stdout': '',
                    'error': safety_err,
                }
                for t in tests
            ],
        }))
        return

    compiled = compile(code, '<lesson>', 'exec')
    safe_builtins = {
        'abs': abs, 'all': all, 'any': any, 'bool': bool, 'callable': callable,
        'chr': chr, 'dict': dict, 'divmod': divmod, 'enumerate': enumerate,
        'filter': filter, 'float': float, 'frozenset': frozenset, 'hasattr': hasattr,
        'hash': hash, 'hex': hex, 'int': int, 'isinstance': isinstance,
        'issubclass': issubclass, 'iter': iter, 'len': len, 'list': list,
        'map': map, 'max': max, 'min': min, 'next': next, 'object': object,
        'ord': ord, 'pow': pow, 'print': print, 'range': range, 'repr': repr,
        'reversed': reversed, 'round': round, 'set': set, 'slice': slice,
        'sorted': sorted, 'str': str, 'sum': sum, 'tuple': tuple, 'type': type,
        'zip': zip, 'Exception': Exception, 'ValueError': ValueError,
        'TypeError': TypeError, 'ZeroDivisionError': ZeroDivisionError,
        'KeyError': KeyError, 'IndexError': IndexError, 'RuntimeError': RuntimeError,
        '__build_class__': __build_class__,
    }

    import math, collections, itertools, functools, re, json as _json, string, random
    allowed_imports = {
        'math': math, 'collections': collections, 'itertools': itertools,
        'functools': functools, 're': re, 'json': _json, 'string': string, 'random': random,
    }
    def safe_import(name, globals=None, locals=None, fromlist=(), level=0):
        top = name.split('.')[0]
        if top in allowed_imports:
            return __import__(name, globals, locals, fromlist, level)
        raise ImportError(f"Module '{name}' is not enabled in this sandbox.")
    safe_builtins['__import__'] = safe_import

    results = []
    top_runtime_error = None

    for t in tests:
        stdout_buf = io.StringIO()
        stderr_buf = io.StringIO()
        ns = {'__builtins__': safe_builtins, '__name__': '__main__'}
        passed = False
        actual_str = ''
        err_str = None

        try:
            with contextlib.redirect_stdout(stdout_buf), contextlib.redirect_stderr(stderr_buf):
                setup_code = t.get('setupCode') or ''
                if setup_code.strip():
                    exec(compile(setup_code, '<setup>', 'exec'), ns, ns)
                exec(compiled, ns, ns)
                passed = bool(eval(t['checkExpr'], {'ns': ns, '__builtins__': safe_builtins}, {}))
                try:
                    actual_str = str(eval(t['actualExpr'], {'ns': ns, '__builtins__': safe_builtins}, {}))
                except Exception as actual_exc:
                    actual_str = format_exc(actual_exc)
        except Exception as exc:
            err_str = format_exc(exc)
            actual_str = err_str
            if top_runtime_error is None:
                top_runtime_error = err_str

        captured = stdout_buf.getvalue()[:4000]
        err_captured = stderr_buf.getvalue()[:1000]
        if err_captured and not err_str:
            err_str = err_captured.strip()

        results.append({
            'id': t['id'],
            'description': t['description'],
            'passed': passed,
            'expected': t['expectedDisplay'],
            'actual': actual_str[:500],
            'stdout': captured,
            'error': err_str,
        })

    print(json.dumps({
        'syntaxError': None,
        'runtimeError': top_runtime_error,
        'results': results,
    }))

if __name__ == '__main__':
    main()
`;

export async function runPythonTestCases(
  code: string,
  testCases: PythonTestCase[],
  timeoutMs = EXECUTION_TIMEOUT_MS,
): Promise<PythonRunResult> {
  return new Promise((resolve) => {
    const child = spawn('python3', ['-I', '-c', PYTHON_HARNESS], {
      cwd: os.tmpdir(),
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        PYTHONIOENCODING: 'utf-8',
        PYTHONDONTWRITEBYTECODE: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const failSafeResult = (runtimeError: string, isTimeout = false): PythonRunResult => ({
      allPassed: false,
      passedCount: 0,
      totalCount: testCases.length,
      timedOut: isTimeout,
      syntaxError: null,
      runtimeError,
      results: testCases.map((t) => ({
        id: t.id,
        description: t.description,
        passed: false,
        expected: t.expectedDisplay,
        actual: isTimeout ? 'Timed Out' : 'Sandbox Error',
        stdout: '',
        error: runtimeError,
      })),
    });

    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore if already exited
      }
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_BUFFER_BYTES) {
        stdout += chunk.toString('utf8');
      } else {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_BUFFER_BYTES) {
        stderr += chunk.toString('utf8');
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve(failSafeResult(`Python runner unavailable: ${err.message}`));
    });

    child.on('close', () => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;

      if (timedOut) {
        resolve(
          failSafeResult(
            `Execution timed out after ${(timeoutMs / 1000).toFixed(1)}s. Check for an infinite loop.`,
            true,
          ),
        );
        return;
      }

      try {
        const parsed = JSON.parse(stdout.trim()) as {
          syntaxError: string | null;
          runtimeError: string | null;
          results: TestCaseResult[];
        };
        const results = Array.isArray(parsed.results) ? parsed.results : [];
        const passedCount = results.filter((r) => r.passed).length;
        resolve({
          allPassed: results.length > 0 && passedCount === results.length,
          passedCount,
          totalCount: results.length,
          timedOut: false,
          syntaxError: parsed.syntaxError ?? null,
          runtimeError: parsed.runtimeError ?? null,
          results,
        });
      } catch {
        const msg = stderr.trim() || 'Python execution failed to return structured test output.';
        resolve(failSafeResult(msg.slice(0, 400)));
      }
    });

    const payload = JSON.stringify({ code, testCases });
    child.stdin.write(payload);
    child.stdin.end();
  });
}
