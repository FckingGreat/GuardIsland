#include "common.h"

static Napi::Value Start(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  StartMessageLoop();
  return env.Undefined();
}

static Napi::Value Stop(const Napi::CallbackInfo& info) {
  StopProcessWatch();
  StopMessageLoop();
  if (g_guard.usbTsfn) g_guard.usbTsfn.Release();
  if (g_guard.hotkeyTsfn) g_guard.hotkeyTsfn.Release();
  if (g_guard.procTsfn) g_guard.procTsfn.Release();
  return info.Env().Undefined();
}

static Napi::Value OnUsb(const Napi::CallbackInfo& info) {
  g_guard.usbTsfn = Napi::ThreadSafeFunction::New(info.Env(), info[0].As<Napi::Function>(), "usb", 0, 1);
  g_guard.usbEnabled.store(true);
  StartMessageLoop();
  return info.Env().Undefined();
}

static Napi::Value OffUsb(const Napi::CallbackInfo& info) {
  g_guard.usbEnabled.store(false);
  return info.Env().Undefined();
}

static Napi::Value OnHotkey(const Napi::CallbackInfo& info) {
  g_guard.hotkeyVk = info[0].As<Napi::Number>().Int32Value();
  g_guard.hotkeyMods = info[1].As<Napi::Number>().Int32Value();
  g_guard.hotkeyTsfn = Napi::ThreadSafeFunction::New(info.Env(), info[2].As<Napi::Function>(), "hotkey", 0, 1);
  g_guard.hotkeyEnabled.store(true);
  StartMessageLoop();
  if (g_guard.hwnd) {
    UnregisterHotKey(g_guard.hwnd, 1);
    RegisterHotKey(g_guard.hwnd, 1, g_guard.hotkeyMods, g_guard.hotkeyVk);
  }
  return info.Env().Undefined();
}

static Napi::Value OffHotkey(const Napi::CallbackInfo& info) {
  g_guard.hotkeyEnabled.store(false);
  if (g_guard.hwnd) UnregisterHotKey(g_guard.hwnd, 1);
  return info.Env().Undefined();
}

static Napi::Value Lock(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), LockStation());
}

static Napi::Value Shutdown(const Napi::CallbackInfo& info) {
  const bool powerOff = info.Length() > 0 ? info[0].As<Napi::Boolean>().Value() : true;
  return Napi::Boolean::New(info.Env(), ShutdownStation(powerOff));
}

static Napi::Value OnProc(const Napi::CallbackInfo& info) {
  g_guard.procTsfn = Napi::ThreadSafeFunction::New(info.Env(), info[0].As<Napi::Function>(), "proc", 0, 1);
  g_guard.procEnabled.store(true);
  StartProcessWatch();
  return info.Env().Undefined();
}

static Napi::Value OffProc(const Napi::CallbackInfo& info) {
  g_guard.procEnabled.store(false);
  StopProcessWatch();
  return info.Env().Undefined();
}

static Napi::Value Kill(const Napi::CallbackInfo& info) {
  const DWORD pid = info[0].As<Napi::Number>().Uint32Value();
  return Napi::Boolean::New(info.Env(), KillPid(pid));
}

static Napi::Value SetAuto(const Napi::CallbackInfo& info) {
  const bool en = info[0].As<Napi::Boolean>().Value();
  std::u16string exe = info[1].As<Napi::String>().Utf16Value();
  std::u16string args = info.Length() > 2 ? info[2].As<Napi::String>().Utf16Value() : u"";
  return Napi::Boolean::New(info.Env(), SetRunKey(en, std::wstring(exe.begin(), exe.end()), std::wstring(args.begin(), args.end())));
}

static Napi::Value HasAuto(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), IsRunKeySet());
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("start", Napi::Function::New(env, Start));
  exports.Set("stop", Napi::Function::New(env, Stop));
  exports.Set("onUsb", Napi::Function::New(env, OnUsb));
  exports.Set("offUsb", Napi::Function::New(env, OffUsb));
  exports.Set("onHotkey", Napi::Function::New(env, OnHotkey));
  exports.Set("offHotkey", Napi::Function::New(env, OffHotkey));
  exports.Set("lock", Napi::Function::New(env, Lock));
  exports.Set("shutdown", Napi::Function::New(env, Shutdown));
  exports.Set("onProcess", Napi::Function::New(env, OnProc));
  exports.Set("offProcess", Napi::Function::New(env, OffProc));
  exports.Set("kill", Napi::Function::New(env, Kill));
  exports.Set("setAutostart", Napi::Function::New(env, SetAuto));
  exports.Set("isAutostart", Napi::Function::New(env, HasAuto));
  exports.Set("engine", Napi::String::New(env, "native"));
  return exports;
}

NODE_API_MODULE(guard_native, Init)
