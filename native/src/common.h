#pragma once

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif

#include <windows.h>
#include <dbt.h>
#include <napi.h>
#include <string>
#include <atomic>
#include <mutex>
#include <thread>

struct GuardState {
  std::atomic<bool> running{false};
  HWND hwnd = nullptr;
  HANDLE thread = nullptr;
  DWORD threadId = 0;
  HDEVNOTIFY usbNotify = nullptr;
  HDEVNOTIFY hidNotify = nullptr;
  int hotkeyVk = VK_INSERT;
  int hotkeyMods = 0;
  Napi::ThreadSafeFunction usbTsfn;
  Napi::ThreadSafeFunction hotkeyTsfn;
  Napi::ThreadSafeFunction procTsfn;
  std::atomic<bool> usbEnabled{false};
  std::atomic<bool> hotkeyEnabled{false};
  std::atomic<bool> procEnabled{false};
};

extern GuardState g_guard;

void StartMessageLoop();
void StopMessageLoop();
bool EnableShutdownPrivilege();
bool LockStation();
bool ShutdownStation(bool powerOff);
bool KillPid(DWORD pid);
bool SetRunKey(bool enable, const std::wstring& exe, const std::wstring& args);
bool IsRunKeySet();
void StartProcessWatch();
void StopProcessWatch();
