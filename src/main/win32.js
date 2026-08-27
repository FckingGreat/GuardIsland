'use strict';

const { execFile } = require('child_process');

let koffi = null;
let LockWorkStation = null;
let ExitWindowsEx = null;
let OpenProcess = null;
let TerminateProcess = null;
let CloseHandle = null;
let QueryFullProcessImageNameW = null;
let CreateToolhelp32Snapshot = null;
let PROCESSENTRY32W = null;
let Process32FirstW = null;
let Process32NextW = null;
let OpenProcessToken = null;
let LookupPrivilegeValueW = null;
let AdjustTokenPrivileges = null;
let GetCurrentProcess = null;
let RegCreateKeyExW = null;
let RegSetValueExW = null;
let RegDeleteValueW = null;
let RegOpenKeyExW = null;
let RegQueryValueExW = null;
let RegCloseKey = null;
let NtSuspendProcess = null;
let NtResumeProcess = null;
let koffiReady = false;

const TH32CS_SNAPPROCESS = 0x00000002;
const PROCESS_TERMINATE = 0x0001;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const PROCESS_SUSPEND_RESUME = 0x0800;
const PROCESS_VM_READ = 0x0010;
const PROCESS_ACCESS = PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SUSPEND_RESUME | PROCESS_VM_READ | 0x0400;
const EWX_SHUTDOWN = 0x00000001;
const EWX_FORCE = 0x00000004;
const EWX_POWEROFF = 0x00000008;
const TOKEN_ADJUST_PRIVILEGES = 0x0020;
const TOKEN_QUERY = 0x0008;
const SE_PRIVILEGE_ENABLED = 0x00000002;
const HKEY_CURRENT_USER = 0x80000001n;
const KEY_SET_VALUE = 0x0002;
const KEY_QUERY_VALUE = 0x0001;
const REG_SZ = 1;
const INVALID_HANDLE_VALUE = -1;

try {
  koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  const advapi32 = koffi.load('advapi32.dll');
  LockWorkStation = user32.func('bool __stdcall LockWorkStation()');
  ExitWindowsEx = user32.func('bool __stdcall ExitWindowsEx(uint32 uFlags, uint32 dwReason)');
  OpenProcess = kernel32.func('void* __stdcall OpenProcess(uint32 dwDesiredAccess, bool bInheritHandle, uint32 dwProcessId)');
  TerminateProcess = kernel32.func('bool __stdcall TerminateProcess(void* hProcess, uint32 uExitCode)');
  CloseHandle = kernel32.func('bool __stdcall CloseHandle(void* hObject)');
  QueryFullProcessImageNameW = kernel32.func(
    'bool __stdcall QueryFullProcessImageNameW(void* hProcess, uint32 dwFlags, _Out_ uint16* lpExeName, _Inout_ uint32* lpdwSize)'
  );
  CreateToolhelp32Snapshot = kernel32.func('void* __stdcall CreateToolhelp32Snapshot(uint32 dwFlags, uint32 th32ProcessID)');
  PROCESSENTRY32W = koffi.struct('PROCESSENTRY32W', {
    dwSize: 'uint32',
    cntUsage: 'uint32',
    th32ProcessID: 'uint32',
    th32DefaultHeapID: 'uintptr',
    th32ModuleID: 'uint32',
    cntThreads: 'uint32',
    th32ParentProcessID: 'uint32',
    pcPriClassBase: 'int32',
    dwFlags: 'uint32',
    szExeFile: koffi.array('uint16', 260)
  });
  Process32FirstW = kernel32.func('bool __stdcall Process32FirstW(void* hSnapshot, _Inout_ PROCESSENTRY32W *lppe)');
  Process32NextW = kernel32.func('bool __stdcall Process32NextW(void* hSnapshot, _Inout_ PROCESSENTRY32W *lppe)');
  try {
    const ntdll = koffi.load('ntdll.dll');
    NtSuspendProcess = ntdll.func('long NtSuspendProcess(void* ProcessHandle)');
    NtResumeProcess = ntdll.func('long NtResumeProcess(void* ProcessHandle)');
  } catch {}
  OpenProcessToken = advapi32.func('bool __stdcall OpenProcessToken(void* ProcessHandle, uint32 DesiredAccess, _Out_ void** TokenHandle)');
  LookupPrivilegeValueW = advapi32.func('bool __stdcall LookupPrivilegeValueW(void* lpSystemName, const uint16* lpName, _Out_ uint8* lpLuid)');
  AdjustTokenPrivileges = advapi32.func(
    'bool __stdcall AdjustTokenPrivileges(void* TokenHandle, bool DisableAllPrivileges, void* NewState, uint32 BufferLength, void* PreviousState, void* ReturnLength)'
  );
  GetCurrentProcess = kernel32.func('void* __stdcall GetCurrentProcess()');
  RegCreateKeyExW = advapi32.func(
    'int32 __stdcall RegCreateKeyExW(void* hKey, const uint16* lpSubKey, uint32 Reserved, void* lpClass, uint32 dwOptions, uint32 samDesired, void* lpSecurityAttributes, _Out_ void** phkResult, void* lpdwDisposition)'
  );
  RegSetValueExW = advapi32.func(
    'int32 __stdcall RegSetValueExW(void* hKey, const uint16* lpValueName, uint32 Reserved, uint32 dwType, const void* lpData, uint32 cbData)'
  );
  RegDeleteValueW = advapi32.func('int32 __stdcall RegDeleteValueW(void* hKey, const uint16* lpValueName)');
  RegOpenKeyExW = advapi32.func(
    'int32 __stdcall RegOpenKeyExW(void* hKey, const uint16* lpSubKey, uint32 ulOptions, uint32 samDesired, _Out_ void** phkResult)'
  );
  RegQueryValueExW = advapi32.func(
    'int32 __stdcall RegQueryValueExW(void* hKey, const uint16* lpValueName, void* lpReserved, void* lpType, void* lpData, void* lpcbData)'
  );
  RegCloseKey = advapi32.func('int32 __stdcall RegCloseKey(void* hKey)');
  koffiReady = true;
} catch (e) {
  console.warn('koffi unavailable', e && e.message);
}

function toWide(str) {
  const buf = Buffer.alloc((str.length + 1) * 2);
  buf.write(str, 'utf16le');
  return buf;
}

function wideToString(arr) {
  const parts = [];
  for (const c of arr) {
    if (c === 0) break;
    parts.push(String.fromCharCode(c));
  }
  return parts.join('');
}

function run(cmd, args) {
  try {
    execFile(cmd, args, { windowsHide: true }, () => {});
    return true;
  } catch {
    return false;
  }
}

function enableShutdownPrivilege() {
  if (!koffiReady) return false;
  try {
    const tokenPtr = [null];
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, tokenPtr)) return false;
    const luid = Buffer.alloc(8);
    LookupPrivilegeValueW(null, toWide('SeShutdownPrivilege'), luid);
    const tp = Buffer.alloc(16);
    tp.writeUInt32LE(1, 0);
    luid.copy(tp, 4);
    tp.writeUInt32LE(SE_PRIVILEGE_ENABLED, 12);
    AdjustTokenPrivileges(tokenPtr[0], false, tp, 0, null, null);
    CloseHandle(tokenPtr[0]);
    return true;
  } catch {
    return false;
  }
}

function lockWorkstation() {
  try {
    if (koffiReady && LockWorkStation()) return true;
  } catch {}
  return run('rundll32.exe', ['user32.dll,LockWorkStation']);
}

function shutdownComputer() {
  try {
    if (koffiReady) {
      enableShutdownPrivilege();
      if (ExitWindowsEx(EWX_SHUTDOWN | EWX_FORCE | EWX_POWEROFF, 0)) return true;
    }
  } catch {}
  return run('shutdown.exe', ['/s', '/t', '0', '/f']);
}

function killPid(pid) {
  try {
    if (koffiReady) {
      const h = OpenProcess(PROCESS_ACCESS, false, pid);
      if (h && h !== 0 && h !== INVALID_HANDLE_VALUE) {
        const ok = TerminateProcess(h, 1);
        CloseHandle(h);
        if (ok) return true;
      }
    }
  } catch {}
  return run('taskkill.exe', ['/PID', String(pid), '/T', '/F']);
}

function suspendPid(pid) {
  if (!koffiReady || !NtSuspendProcess) return false;
  try {
    const h = OpenProcess(PROCESS_ACCESS, false, pid);
    if (!h || h === 0) return false;
    const st = NtSuspendProcess(h);
    CloseHandle(h);
    return st === 0;
  } catch {
    return false;
  }
}

function resumePid(pid) {
  if (!koffiReady || !NtResumeProcess) return false;
  try {
    const h = OpenProcess(PROCESS_ACCESS, false, pid);
    if (!h || h === 0) return false;
    const st = NtResumeProcess(h);
    CloseHandle(h);
    return st === 0;
  } catch {
    return false;
  }
}

function queryPath(pid) {
  if (!koffiReady) return '';
  try {
    const h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
    if (!h || h === 0) return '';
    const buf = Buffer.alloc(520);
    const size = [260];
    const ok = QueryFullProcessImageNameW(h, 0, buf, size);
    CloseHandle(h);
    if (!ok) return '';
    return buf.toString('utf16le').replace(/\0+$/, '');
  } catch {
    return '';
  }
}

function listProcessesKoffi() {
  const snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (!snap || snap === INVALID_HANDLE_VALUE) return [];
  const entry = {
    dwSize: koffi.sizeof(PROCESSENTRY32W),
    cntUsage: 0,
    th32ProcessID: 0,
    th32DefaultHeapID: 0,
    th32ModuleID: 0,
    cntThreads: 0,
    th32ParentProcessID: 0,
    pcPriClassBase: 0,
    dwFlags: 0,
    szExeFile: new Array(260).fill(0)
  };
  const out = [];
  try {
    if (!Process32FirstW(snap, entry)) return [];
    do {
      out.push({
        pid: entry.th32ProcessID,
        ppid: entry.th32ParentProcessID,
        name: wideToString(entry.szExeFile),
        path: ''
      });
    } while (Process32NextW(snap, entry));
  } catch {
    // ignore
  } finally {
    CloseHandle(snap);
  }
  return out;
}

function listProcessesTasklist() {
  const { execFileSync } = require('child_process');
  try {
    const raw = execFileSync('tasklist.exe', ['/FO', 'CSV', '/NH'], { windowsHide: true, encoding: 'utf8' });
    return raw.split(/\r?\n/).filter(Boolean).map((line) => {
      const cols = line.split('","').map((c) => c.replace(/^"|"$/g, ''));
      return { name: cols[0], pid: Number(cols[1]), path: '' };
    }).filter((p) => p.pid);
  } catch {
    return [];
  }
}

function listProcesses() {
  if (koffiReady) {
    try {
      const list = listProcessesKoffi();
      if (list.length) return list;
    } catch {}
  }
  return listProcessesTasklist();
}

const RUN_SUBKEY = 'Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const RUN_VALUE = 'GuardIsland';

function setAutostart(enable, exePath) {
  if (!koffiReady) return false;
  try {
    const keyPtr = [null];
    const sub = toWide(RUN_SUBKEY);
    const val = toWide(RUN_VALUE);
    const hkcu = koffi.as(HKEY_CURRENT_USER, 'void*');
    if (RegCreateKeyExW(hkcu, sub, 0, null, 0, KEY_SET_VALUE, null, keyPtr, null) !== 0) return false;
    try {
      if (!enable) {
        RegDeleteValueW(keyPtr[0], val);
        return true;
      }
      const data = toWide(`"${exePath}"`);
      return RegSetValueExW(keyPtr[0], val, 0, REG_SZ, data, data.length) === 0;
    } finally {
      RegCloseKey(keyPtr[0]);
    }
  } catch {
    return false;
  }
}

function isAutostart() {
  if (!koffiReady) return false;
  try {
    const keyPtr = [null];
    const hkcu = koffi.as(HKEY_CURRENT_USER, 'void*');
    if (RegOpenKeyExW(hkcu, toWide(RUN_SUBKEY), 0, KEY_QUERY_VALUE, keyPtr) !== 0) return false;
    try {
      return RegQueryValueExW(keyPtr[0], toWide(RUN_VALUE), null, null, null, [0]) === 0;
    } finally {
      RegCloseKey(keyPtr[0]);
    }
  } catch {
    return false;
  }
}

function startProcessPoll(onProc, intervalMs = 800) {
  const listed = listProcesses();
  let known = new Set(listed.map((p) => p.pid));
  const byPid = new Map(listed.map((p) => [p.pid, p]));
  const timer = setInterval(() => {
    const now = listProcesses();
    const nextMap = new Map(now.map((p) => [p.pid, p]));
    for (const p of now) {
      if (!known.has(p.pid)) {
        p.path = queryPath(p.pid);
        const parent = nextMap.get(p.ppid) || byPid.get(p.ppid);
        p.parentName = parent?.name || '';
        p.parentPath = parent?.path || queryPath(p.ppid);
        onProc(p);
      }
    }
    known = new Set(now.map((p) => p.pid));
    byPid.clear();
    for (const p of now) byPid.set(p.pid, p);
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = {
  koffiReady,
  lockWorkstation,
  shutdownComputer,
  killPid,
  suspendPid,
  resumePid,
  listProcesses,
  queryPath,
  setAutostart,
  isAutostart,
  startProcessPoll
};
