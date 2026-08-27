#include "common.h"

#include <comdef.h>
#include <Wbemidl.h>
#include <sstream>

#pragma comment(lib, "wbemuuid.lib")

static IWbemLocator* g_loc = nullptr;
static IWbemServices* g_svc = nullptr;
static IUnsecuredApartment* g_apt = nullptr;
static IWbemObjectSink* g_sink = nullptr;
static IUnknown* g_stubUnk = nullptr;
static IWbemObjectSink* g_stubSink = nullptr;
static std::atomic<bool> g_procRunning{false};

class ProcessSink : public IWbemObjectSink {
 public:
  LONG ref_ = 0;

  ULONG STDMETHODCALLTYPE AddRef() override {
    return InterlockedIncrement(&ref_);
  }
  ULONG STDMETHODCALLTYPE Release() override {
    LONG r = InterlockedDecrement(&ref_);
    if (r == 0) delete this;
    return r;
  }
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** pp) override {
    if (riid == IID_IUnknown || riid == IID_IWbemObjectSink) {
      *pp = this;
      AddRef();
      return WBEM_S_NO_ERROR;
    }
    *pp = nullptr;
    return E_NOINTERFACE;
  }
  HRESULT STDMETHODCALLTYPE Indicate(LONG count, IWbemClassObject** objs) override {
    if (!g_guard.procEnabled.load() || !g_guard.procTsfn) return WBEM_S_NO_ERROR;
    for (LONG i = 0; i < count; i++) {
      VARIANT vtInst;
      VariantInit(&vtInst);
      if (FAILED(objs[i]->Get(L"TargetInstance", 0, &vtInst, nullptr, nullptr))) continue;
      IWbemClassObject* proc = nullptr;
      vtInst.punkVal->QueryInterface(IID_IWbemClassObject, reinterpret_cast<void**>(&proc));
      VariantClear(&vtInst);
      if (!proc) continue;

      VARIANT vName, vPid, vCmd;
      VariantInit(&vName);
      VariantInit(&vPid);
      VariantInit(&vCmd);
      proc->Get(L"Name", 0, &vName, nullptr, nullptr);
      proc->Get(L"ProcessId", 0, &vPid, nullptr, nullptr);
      proc->Get(L"ExecutablePath", 0, &vCmd, nullptr, nullptr);

      std::wstring name = vName.vt == VT_BSTR && vName.bstrVal ? vName.bstrVal : L"";
      std::wstring path = vCmd.vt == VT_BSTR && vCmd.bstrVal ? vCmd.bstrVal : L"";
      uint32_t pid = vPid.vt == VT_I4 ? static_cast<uint32_t>(vPid.lVal) : 0;

      VariantClear(&vName);
      VariantClear(&vPid);
      VariantClear(&vCmd);
      proc->Release();

      g_guard.procTsfn.NonBlockingCall([name, path, pid](Napi::Env env, Napi::Function cb) {
        Napi::Object o = Napi::Object::New(env);
        o.Set("name", Napi::String::New(env, std::string(name.begin(), name.end())));
        o.Set("path", Napi::String::New(env, std::string(path.begin(), path.end())));
        o.Set("pid", pid);
        cb.Call({o});
      });
    }
    return WBEM_S_NO_ERROR;
  }
  HRESULT STDMETHODCALLTYPE SetStatus(LONG, HRESULT, BSTR, IWbemClassObject*) override {
    return WBEM_S_NO_ERROR;
  }
};

void StartProcessWatch() {
  if (g_procRunning.exchange(true)) return;
  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  (void)hr;
  CoInitializeSecurity(nullptr, -1, nullptr, nullptr, RPC_C_AUTHN_LEVEL_DEFAULT,
                       RPC_C_IMP_LEVEL_IMPERSONATE, nullptr, EOAC_NONE, nullptr);
  CoCreateInstance(CLSID_WbemLocator, nullptr, CLSCTX_INPROC_SERVER, IID_IWbemLocator,
                   reinterpret_cast<void**>(&g_loc));
  if (!g_loc) return;
  g_loc->ConnectServer(_bstr_t(L"ROOT\\CIMV2"), nullptr, nullptr, nullptr, 0, nullptr, nullptr, &g_svc);
  if (!g_svc) return;
  CoSetProxyBlanket(g_svc, RPC_C_AUTHN_WINNT, RPC_C_AUTHZ_NONE, nullptr, RPC_C_AUTHN_LEVEL_CALL,
                    RPC_C_IMP_LEVEL_IMPERSONATE, nullptr, EOAC_NONE);
  CoCreateInstance(CLSID_UnsecuredApartment, nullptr, CLSCTX_LOCAL_SERVER, IID_IUnsecuredApartment,
                   reinterpret_cast<void**>(&g_apt));
  auto* sink = new ProcessSink();
  sink->AddRef();
  g_sink = sink;
  g_apt->CreateObjectStub(sink, &g_stubUnk);
  g_stubUnk->QueryInterface(IID_IWbemObjectSink, reinterpret_cast<void**>(&g_stubSink));
  g_svc->ExecNotificationQueryAsync(
      _bstr_t(L"WQL"),
      _bstr_t(L"SELECT * FROM __InstanceCreationEvent WITHIN 0.2 WHERE TargetInstance ISA 'Win32_Process'"),
      WBEM_FLAG_SEND_STATUS, nullptr, g_stubSink);
}

void StopProcessWatch() {
  if (!g_procRunning.exchange(false)) return;
  if (g_svc && g_stubSink) g_svc->CancelAsyncCall(g_stubSink);
  if (g_stubSink) g_stubSink->Release();
  if (g_stubUnk) g_stubUnk->Release();
  if (g_sink) g_sink->Release();
  if (g_apt) g_apt->Release();
  if (g_svc) g_svc->Release();
  if (g_loc) g_loc->Release();
  g_stubSink = nullptr;
  g_stubUnk = nullptr;
  g_sink = nullptr;
  g_apt = nullptr;
  g_svc = nullptr;
  g_loc = nullptr;
}
