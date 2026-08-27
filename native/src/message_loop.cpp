#include "common.h"

#include <setupapi.h>
#include <initguid.h>
#include <usbiodef.h>
#include <hidclass.h>

GuardState g_guard;

static const wchar_t kClassName[] = L"GuardIslandMsgWnd";

static void EmitUsb(const char* action, const char* kind) {
  if (!g_guard.usbEnabled.load() || !g_guard.usbTsfn) return;
  std::string a = action;
  std::string k = kind;
  g_guard.usbTsfn.NonBlockingCall([a, k](Napi::Env env, Napi::Function cb) {
    Napi::Object o = Napi::Object::New(env);
    o.Set("action", a);
    o.Set("kind", k);
    cb.Call({o});
  });
}

static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
  if (msg == WM_DEVICECHANGE) {
    const char* action = nullptr;
    if (wParam == DBT_DEVICEARRIVAL) action = "arrive";
    else if (wParam == DBT_DEVICEREMOVECOMPLETE) action = "remove";
    if (action) {
      const char* kind = "device";
      auto* hdr = reinterpret_cast<DEV_BROADCAST_HDR*>(lParam);
      if (hdr) {
        if (hdr->dbch_devicetype == DBT_DEVTYP_DEVICEINTERFACE) kind = "interface";
        else if (hdr->dbch_devicetype == DBT_DEVTYP_VOLUME) kind = "volume";
      }
      EmitUsb(action, kind);
    }
    return TRUE;
  }
  if (msg == WM_HOTKEY && g_guard.hotkeyEnabled.load() && g_guard.hotkeyTsfn) {
    g_guard.hotkeyTsfn.NonBlockingCall([](Napi::Env env, Napi::Function cb) {
      cb.Call({Napi::String::New(env, "hotkey")});
    });
    return 0;
  }
  if (msg == WM_DESTROY) {
    PostQuitMessage(0);
    return 0;
  }
  return DefWindowProcW(hwnd, msg, wParam, lParam);
}

static DWORD WINAPI MessageThread(LPVOID) {
  WNDCLASSEXW wc{};
  wc.cbSize = sizeof(wc);
  wc.lpfnWndProc = WndProc;
  wc.hInstance = GetModuleHandleW(nullptr);
  wc.lpszClassName = kClassName;
  RegisterClassExW(&wc);

  HWND hwnd = CreateWindowExW(
      0, kClassName, L"GuardIsland", 0, 0, 0, 0, 0,
      HWND_MESSAGE, nullptr, GetModuleHandleW(nullptr), nullptr);
  g_guard.hwnd = hwnd;

  DEV_BROADCAST_DEVICEINTERFACE_W filter{};
  filter.dbcc_size = sizeof(filter);
  filter.dbcc_devicetype = DBT_DEVTYP_DEVICEINTERFACE;
  filter.dbcc_classguid = GUID_DEVINTERFACE_USB_DEVICE;
  g_guard.usbNotify = RegisterDeviceNotificationW(hwnd, &filter, DEVICE_NOTIFY_WINDOW_HANDLE);

  filter.dbcc_classguid = GUID_DEVINTERFACE_HID;
  g_guard.hidNotify = RegisterDeviceNotificationW(hwnd, &filter, DEVICE_NOTIFY_WINDOW_HANDLE);

  if (g_guard.hotkeyEnabled.load()) {
    RegisterHotKey(hwnd, 1, g_guard.hotkeyMods, g_guard.hotkeyVk);
  }

  MSG msg;
  while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
    TranslateMessage(&msg);
    DispatchMessageW(&msg);
  }

  if (g_guard.usbNotify) UnregisterDeviceNotification(g_guard.usbNotify);
  if (g_guard.hidNotify) UnregisterDeviceNotification(g_guard.hidNotify);
  UnregisterHotKey(hwnd, 1);
  g_guard.hwnd = nullptr;
  return 0;
}

void StartMessageLoop() {
  if (g_guard.running.exchange(true)) return;
  g_guard.thread = CreateThread(nullptr, 0, MessageThread, nullptr, 0, &g_guard.threadId);
}

void StopMessageLoop() {
  if (!g_guard.running.exchange(false)) return;
  if (g_guard.hwnd) PostMessageW(g_guard.hwnd, WM_CLOSE, 0, 0);
  if (g_guard.thread) {
    WaitForSingleObject(g_guard.thread, 3000);
    CloseHandle(g_guard.thread);
    g_guard.thread = nullptr;
  }
}

bool EnableShutdownPrivilege() {
  HANDLE token = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, &token)) {
    return false;
  }
  TOKEN_PRIVILEGES tp{};
  LookupPrivilegeValueW(nullptr, SE_SHUTDOWN_NAME, &tp.Privileges[0].Luid);
  tp.PrivilegeCount = 1;
  tp.Privileges[0].Attributes = SE_PRIVILEGE_ENABLED;
  const BOOL ok = AdjustTokenPrivileges(token, FALSE, &tp, sizeof(tp), nullptr, nullptr);
  CloseHandle(token);
  return ok && GetLastError() == ERROR_SUCCESS;
}

bool LockStation() {
  return LockWorkStation() != 0;
}

bool ShutdownStation(bool powerOff) {
  if (!EnableShutdownPrivilege()) return false;
  UINT flags = EWX_SHUTDOWN | EWX_FORCE;
  if (powerOff) flags |= EWX_POWEROFF;
  return ExitWindowsEx(flags, SHTDN_REASON_MAJOR_OTHER | SHTDN_REASON_MINOR_MAINTENANCE) != 0;
}

bool KillPid(DWORD pid) {
  HANDLE h = OpenProcess(PROCESS_TERMINATE, FALSE, pid);
  if (!h) return false;
  const BOOL ok = TerminateProcess(h, 1);
  CloseHandle(h);
  return ok != 0;
}

static const wchar_t kRunKey[] = L"Software\\Microsoft\\Windows\\CurrentVersion\\Run";
static const wchar_t kValue[] = L"GuardIsland";

bool SetRunKey(bool enable, const std::wstring& exe, const std::wstring& args) {
  HKEY key = nullptr;
  if (RegCreateKeyExW(HKEY_CURRENT_USER, kRunKey, 0, nullptr, 0, KEY_SET_VALUE, nullptr, &key, nullptr) != ERROR_SUCCESS) {
    return false;
  }
  bool ok = false;
  if (!enable) {
    ok = RegDeleteValueW(key, kValue) == ERROR_SUCCESS || GetLastError() == ERROR_FILE_NOT_FOUND;
  } else {
    std::wstring cmd = L"\"" + exe + L"\"";
    if (!args.empty()) cmd += L" " + args;
    ok = RegSetValueExW(
             key, kValue, 0, REG_SZ,
             reinterpret_cast<const BYTE*>(cmd.c_str()),
             static_cast<DWORD>((cmd.size() + 1) * sizeof(wchar_t))) == ERROR_SUCCESS;
  }
  RegCloseKey(key);
  return ok;
}

bool IsRunKeySet() {
  HKEY key = nullptr;
  if (RegOpenKeyExW(HKEY_CURRENT_USER, kRunKey, 0, KEY_QUERY_VALUE, &key) != ERROR_SUCCESS) {
    return false;
  }
  DWORD type = 0, size = 0;
  const LONG st = RegQueryValueExW(key, kValue, nullptr, &type, nullptr, &size);
  RegCloseKey(key);
  return st == ERROR_SUCCESS;
}
