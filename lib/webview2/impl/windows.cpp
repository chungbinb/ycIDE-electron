// webview2 支持库 Windows 实现
// 窗口类：
//   YcWebView2Host —— 浏览框（导航到 地址 属性指定的网页）
//   YcWebButton    —— 网页按钮（HTML 渲染的现代风格按钮，单击经 WM_COMMAND/BN_CLICKED 上抛）
//   YcWebEdit      —— 网页编辑框（HTML 渲染的现代风格输入框，内容变化经 WM_COMMAND/EN_CHANGE 上抛）
// 运行时发现采用注册表方式（免分发 WebView2Loader.dll）：
//   读取 EdgeUpdate ClientState 中 WebView2 运行时的 EBWebView 安装路径，
//   动态加载 EmbeddedBrowserWebView.dll 并调用 CreateWebViewEnvironmentWithOptionsInternal。
// 注意：网页按钮/网页编辑框的 HTML/CSS 模板必须与设计器预览
// （src/renderer/src/components/Editor/VisualDesigner.tsx 同名组件分支）保持视觉一致。
#include <windows.h>
#include <objbase.h>
#include <string>
#include "WebView2.h"

namespace {

constexpr wchar_t kBrowserClassName[] = L"YcWebView2Host";
constexpr wchar_t kButtonClassName[] = L"YcWebButton";
constexpr wchar_t kEditClassName[] = L"YcWebEdit";
constexpr wchar_t kClientStateSubKey[] =
    L"SOFTWARE\\Microsoft\\EdgeUpdate\\ClientState\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

// EmbeddedBrowserWebView.dll 内部导出（与官方 WebView2Loader 的内部调用一致）
using CreateWebViewEnvironmentWithOptionsInternal_t = HRESULT(STDMETHODCALLTYPE*)(
    bool checkRunningInstance,
    int runtimeType,  // 0 = installed runtime
    PCWSTR userDataFolder,
    IUnknown* environmentOptions,
    ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler* handler);

enum class YcHostMode { Browser, Button, Edit };

struct YcWebViewState {
  YcHostMode mode = YcHostMode::Browser;
  ICoreWebView2Controller* controller = nullptr;
  ICoreWebView2* webview = nullptr;
  std::wstring text;  // Browser=地址 / Button=标题 / Edit=内容
  bool createFailed = false;
  bool suppressScriptSync = false;  // 文本变更来自网页侧时不回写脚本，防循环
};

std::wstring queryEbWebViewPath(HKEY rootKey) {
  HKEY key = nullptr;
  if (RegOpenKeyExW(rootKey, kClientStateSubKey, 0, KEY_READ | KEY_WOW64_32KEY, &key) != ERROR_SUCCESS) {
    return L"";
  }
  wchar_t buffer[MAX_PATH * 2] = {0};
  DWORD size = sizeof(buffer) - sizeof(wchar_t);
  DWORD type = 0;
  LONG status = RegQueryValueExW(key, L"EBWebView", nullptr, &type, reinterpret_cast<LPBYTE>(buffer), &size);
  RegCloseKey(key);
  if (status != ERROR_SUCCESS || (type != REG_SZ && type != REG_EXPAND_SZ)) return L"";
  return buffer;
}

HMODULE loadEmbeddedBrowserDll() {
  static HMODULE cached = nullptr;
  static bool attempted = false;
  if (attempted) return cached;
  attempted = true;

  std::wstring base = queryEbWebViewPath(HKEY_LOCAL_MACHINE);
  if (base.empty()) base = queryEbWebViewPath(HKEY_CURRENT_USER);
  if (base.empty()) return nullptr;

#if defined(_M_ARM64)
  const wchar_t* arch = L"arm64";
#elif defined(_WIN64)
  const wchar_t* arch = L"x64";
#else
  const wchar_t* arch = L"x86";
#endif
  // 注册表 EBWebView 值指向版本目录，DLL 位于其下 EBWebView\<arch>\ 子目录
  std::wstring dllPath = base + L"\\EBWebView\\" + arch + L"\\EmbeddedBrowserWebView.dll";
  cached = LoadLibraryW(dllPath.c_str());
  return cached;
}

std::wstring resolveUserDataFolder() {
  wchar_t localAppData[MAX_PATH] = {0};
  DWORD n = GetEnvironmentVariableW(L"LOCALAPPDATA", localAppData, MAX_PATH);
  std::wstring root = (n > 0 && n < MAX_PATH) ? localAppData : L".";

  wchar_t exePath[MAX_PATH] = {0};
  GetModuleFileNameW(nullptr, exePath, MAX_PATH);
  std::wstring exe = exePath;
  size_t slash = exe.find_last_of(L"\\/");
  if (slash != std::wstring::npos) exe = exe.substr(slash + 1);
  size_t dot = exe.find_last_of(L'.');
  if (dot != std::wstring::npos) exe = exe.substr(0, dot);
  if (exe.empty()) exe = L"ycApp";

  std::wstring folder = root + L"\\ycIDE.WebView2\\" + exe;
  CreateDirectoryW((root + L"\\ycIDE.WebView2").c_str(), nullptr);
  CreateDirectoryW(folder.c_str(), nullptr);
  return folder;
}

// JS 单引号字符串转义（含防 </script> 提前闭合）
std::wstring jsEscape(const std::wstring& value) {
  std::wstring out;
  out.reserve(value.size() + 8);
  for (wchar_t ch : value) {
    switch (ch) {
      case L'\\': out += L"\\\\"; break;
      case L'\'': out += L"\\'"; break;
      case L'\n': out += L"\\n"; break;
      case L'\r': out += L"\\r"; break;
      case L'<': out += L"\\x3C"; break;
      default: out += ch; break;
    }
  }
  return out;
}

// —— HTML 模板（与设计器预览同款样式，改动需双侧同步）——

std::wstring buildButtonHtml(const std::wstring& label) {
  std::wstring html =
      L"<!DOCTYPE html><html><head><meta charset=\"utf-8\"><style>"
      L"html,body{margin:0;height:100%;overflow:hidden;background:transparent}"
      L"button{box-sizing:border-box;width:100%;height:100%;border:none;border-radius:6px;"
      L"background:linear-gradient(180deg,#4f8cff,#2f6fe0);color:#fff;"
      L"font:14px 'Segoe UI','Microsoft YaHei',sans-serif;cursor:pointer;"
      L"transition:filter .15s,transform .05s;user-select:none}"
      L"button:hover{filter:brightness(1.08)}"
      L"button:active{transform:scale(.97)}"
      L"</style></head><body><button id=\"b\"></button><script>"
      L"const b=document.getElementById('b');"
      L"b.textContent='";
  html += jsEscape(label);
  html +=
      L"';b.addEventListener('click',()=>window.chrome.webview.postMessage('yc:click'));"
      L"window.__setLabel=t=>{b.textContent=t};"
      L"</script></body></html>";
  return html;
}

std::wstring buildEditHtml(const std::wstring& value) {
  std::wstring html =
      L"<!DOCTYPE html><html><head><meta charset=\"utf-8\"><style>"
      L"html,body{margin:0;height:100%;overflow:hidden;background:transparent}"
      L"input{box-sizing:border-box;width:100%;height:100%;border:1px solid #d0d5dd;border-radius:6px;"
      L"padding:0 10px;font:14px 'Segoe UI','Microsoft YaHei',sans-serif;color:#1f2430;background:#fff;"
      L"outline:none;transition:border-color .15s,box-shadow .15s}"
      L"input:hover{border-color:#9fb3d1}"
      L"input:focus{border-color:#2f6fe0;box-shadow:0 0 0 3px rgba(47,111,224,.18)}"
      L"</style></head><body><input id=\"i\"><script>"
      L"const i=document.getElementById('i');"
      L"i.value='";
  html += jsEscape(value);
  html +=
      L"';i.addEventListener('input',()=>window.chrome.webview.postMessage('yc:input:'+i.value));"
      L"window.__setValue=t=>{i.value=t};"
      L"</script></body></html>";
  return html;
}

void runHostScript(YcWebViewState* state, const std::wstring& script) {
  if (state && state->webview) {
    state->webview->ExecuteScript(script.c_str(), nullptr);
  }
}

class YcWebMessageHandler : public ICoreWebView2WebMessageReceivedEventHandler {
 public:
  explicit YcWebMessageHandler(HWND host) : m_host(host) {}

  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    if (riid == IID_IUnknown || riid == IID_ICoreWebView2WebMessageReceivedEventHandler) {
      *ppv = this;
      AddRef();
      return S_OK;
    }
    *ppv = nullptr;
    return E_NOINTERFACE;
  }
  ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&m_refCount); }
  ULONG STDMETHODCALLTYPE Release() override {
    ULONG count = InterlockedDecrement(&m_refCount);
    if (count == 0) delete this;
    return count;
  }

  HRESULT STDMETHODCALLTYPE Invoke(ICoreWebView2* sender, ICoreWebView2WebMessageReceivedEventArgs* args) override {
    if (!args || !IsWindow(m_host)) return S_OK;
    LPWSTR raw = nullptr;
    if (FAILED(args->TryGetWebMessageAsString(&raw)) || !raw) return S_OK;
    std::wstring message = raw;
    CoTaskMemFree(raw);

    YcWebViewState* state = reinterpret_cast<YcWebViewState*>(GetWindowLongPtrW(m_host, GWLP_USERDATA));
    HWND parent = GetParent(m_host);
    int ctrlId = GetDlgCtrlID(m_host);

    if (message == L"yc:click") {
      if (parent) {
        PostMessageW(parent, WM_COMMAND, MAKEWPARAM(ctrlId, BN_CLICKED), reinterpret_cast<LPARAM>(m_host));
      }
      return S_OK;
    }
    constexpr wchar_t kInputPrefix[] = L"yc:input:";
    constexpr size_t kInputPrefixLen = 9;
    if (message.compare(0, kInputPrefixLen, kInputPrefix) == 0) {
      if (state) {
        state->suppressScriptSync = true;
        SetWindowTextW(m_host, message.substr(kInputPrefixLen).c_str());
        state->suppressScriptSync = false;
      }
      if (parent) {
        PostMessageW(parent, WM_COMMAND, MAKEWPARAM(ctrlId, EN_CHANGE), reinterpret_cast<LPARAM>(m_host));
      }
    }
    return S_OK;
  }

 private:
  volatile LONG m_refCount = 1;
  HWND m_host;
};

class YcControllerCompletedHandler : public ICoreWebView2CreateCoreWebView2ControllerCompletedHandler {
 public:
  explicit YcControllerCompletedHandler(HWND host) : m_host(host) {}

  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    if (riid == IID_IUnknown || riid == IID_ICoreWebView2CreateCoreWebView2ControllerCompletedHandler) {
      *ppv = this;
      AddRef();
      return S_OK;
    }
    *ppv = nullptr;
    return E_NOINTERFACE;
  }
  ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&m_refCount); }
  ULONG STDMETHODCALLTYPE Release() override {
    ULONG count = InterlockedDecrement(&m_refCount);
    if (count == 0) delete this;
    return count;
  }

  HRESULT STDMETHODCALLTYPE Invoke(HRESULT result, ICoreWebView2Controller* controller) override {
    YcWebViewState* state = reinterpret_cast<YcWebViewState*>(GetWindowLongPtrW(m_host, GWLP_USERDATA));
    if (FAILED(result) || !controller || !state || !IsWindow(m_host)) {
      if (state) {
        state->createFailed = true;
        InvalidateRect(m_host, nullptr, TRUE);
      }
      return S_OK;
    }
    controller->AddRef();
    state->controller = controller;

    RECT rc;
    GetClientRect(m_host, &rc);
    controller->put_Bounds(rc);
    controller->put_IsVisible(TRUE);

    ICoreWebView2* webview = nullptr;
    if (FAILED(controller->get_CoreWebView2(&webview)) || !webview) return S_OK;
    state->webview = webview;  // 持有引用供 ExecuteScript/Navigate

    if (state->mode == YcHostMode::Browser) {
      if (!state->text.empty()) {
        webview->Navigate(state->text.c_str());
      }
      return S_OK;
    }

    YcWebMessageHandler* messageHandler = new YcWebMessageHandler(m_host);
    EventRegistrationToken token = {};
    webview->add_WebMessageReceived(messageHandler, &token);
    messageHandler->Release();

    const std::wstring html = (state->mode == YcHostMode::Button)
        ? buildButtonHtml(state->text)
        : buildEditHtml(state->text);
    webview->NavigateToString(html.c_str());
    return S_OK;
  }

 private:
  volatile LONG m_refCount = 1;
  HWND m_host;
};

class YcEnvironmentCompletedHandler : public ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler {
 public:
  explicit YcEnvironmentCompletedHandler(HWND host) : m_host(host) {}

  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    if (riid == IID_IUnknown || riid == IID_ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler) {
      *ppv = this;
      AddRef();
      return S_OK;
    }
    *ppv = nullptr;
    return E_NOINTERFACE;
  }
  ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&m_refCount); }
  ULONG STDMETHODCALLTYPE Release() override {
    ULONG count = InterlockedDecrement(&m_refCount);
    if (count == 0) delete this;
    return count;
  }

  HRESULT STDMETHODCALLTYPE Invoke(HRESULT result, ICoreWebView2Environment* environment) override {
    if (FAILED(result) || !environment || !IsWindow(m_host)) {
      YcWebViewState* state = reinterpret_cast<YcWebViewState*>(GetWindowLongPtrW(m_host, GWLP_USERDATA));
      if (state) {
        state->createFailed = true;
        InvalidateRect(m_host, nullptr, TRUE);
      }
      return S_OK;
    }
    YcControllerCompletedHandler* handler = new YcControllerCompletedHandler(m_host);
    environment->CreateCoreWebView2Controller(m_host, handler);
    handler->Release();
    return S_OK;
  }

 private:
  volatile LONG m_refCount = 1;
  HWND m_host;
};

bool startWebViewCreation(HWND host) {
  HMODULE dll = loadEmbeddedBrowserDll();
  if (!dll) return false;
  auto createFn = reinterpret_cast<CreateWebViewEnvironmentWithOptionsInternal_t>(
      GetProcAddress(dll, "CreateWebViewEnvironmentWithOptionsInternal"));
  if (!createFn) return false;

  CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

  std::wstring userData = resolveUserDataFolder();
  YcEnvironmentCompletedHandler* handler = new YcEnvironmentCompletedHandler(host);
  HRESULT hr = createFn(true, 0 /* installed runtime */, userData.c_str(), nullptr, handler);
  handler->Release();
  return SUCCEEDED(hr);
}

void paintPlaceholder(HWND hwnd, YcWebViewState* state) {
  PAINTSTRUCT ps;
  HDC hdc = BeginPaint(hwnd, &ps);
  RECT rc;
  GetClientRect(hwnd, &rc);
  FillRect(hdc, &rc, reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1));
  SetBkMode(hdc, TRANSPARENT);
  SetTextColor(hdc, RGB(96, 96, 96));
  const wchar_t* text = (state && state->createFailed)
      ? L"WebView2 运行时不可用（请安装 Microsoft Edge WebView2 Runtime）"
      : L"WebView2 加载中…";
  RECT textRc = rc;
  DrawTextW(hdc, text, -1, &textRc, DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS);
  EndPaint(hwnd, &ps);
}

YcHostMode resolveModeFromClassName(HWND hwnd) {
  wchar_t cls[64] = {0};
  GetClassNameW(hwnd, cls, 64);
  if (lstrcmpW(cls, kButtonClassName) == 0) return YcHostMode::Button;
  if (lstrcmpW(cls, kEditClassName) == 0) return YcHostMode::Edit;
  return YcHostMode::Browser;
}

LRESULT CALLBACK YcWebHostProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
  YcWebViewState* state = reinterpret_cast<YcWebViewState*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
  switch (message) {
    case WM_NCCREATE: {
      state = new YcWebViewState();
      const CREATESTRUCTW* cs = reinterpret_cast<const CREATESTRUCTW*>(lParam);
      if (cs && cs->lpszName) state->text = cs->lpszName;
      SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(state));
      state->mode = resolveModeFromClassName(hwnd);
      return TRUE;
    }
    case WM_CREATE: {
      if (state && !startWebViewCreation(hwnd)) {
        state->createFailed = true;
      }
      return 0;
    }
    case WM_SIZE: {
      if (state && state->controller) {
        RECT rc;
        GetClientRect(hwnd, &rc);
        state->controller->put_Bounds(rc);
      }
      return 0;
    }
    case WM_SETTEXT: {
      const wchar_t* newText = reinterpret_cast<const wchar_t*>(lParam);
      if (state) {
        state->text = newText ? newText : L"";
        if (!state->suppressScriptSync && state->webview) {
          switch (state->mode) {
            case YcHostMode::Browser:
              if (!state->text.empty()) state->webview->Navigate(state->text.c_str());
              break;
            case YcHostMode::Button:
              runHostScript(state, L"window.__setLabel('" + jsEscape(state->text) + L"')");
              break;
            case YcHostMode::Edit:
              runHostScript(state, L"window.__setValue('" + jsEscape(state->text) + L"')");
              break;
          }
        }
      }
      return TRUE;
    }
    case WM_GETTEXT: {
      if (!state || wParam == 0 || !lParam) return 0;
      wchar_t* buffer = reinterpret_cast<wchar_t*>(lParam);
      size_t copyLen = state->text.size();
      if (copyLen > wParam - 1) copyLen = wParam - 1;
      memcpy(buffer, state->text.c_str(), copyLen * sizeof(wchar_t));
      buffer[copyLen] = L'\0';
      return static_cast<LRESULT>(copyLen);
    }
    case WM_GETTEXTLENGTH: {
      return state ? static_cast<LRESULT>(state->text.size()) : 0;
    }
    case WM_PAINT: {
      if (state && state->controller) {
        PAINTSTRUCT ps;
        BeginPaint(hwnd, &ps);
        EndPaint(hwnd, &ps);
        return 0;
      }
      paintPlaceholder(hwnd, state);
      return 0;
    }
    case WM_DESTROY: {
      if (state) {
        if (state->webview) {
          state->webview->Release();
          state->webview = nullptr;
        }
        if (state->controller) {
          state->controller->Close();
          state->controller->Release();
          state->controller = nullptr;
        }
      }
      return 0;
    }
    case WM_NCDESTROY: {
      if (state) {
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
        delete state;
      }
      return DefWindowProcW(hwnd, message, wParam, lParam);
    }
    default:
      return DefWindowProcW(hwnd, message, wParam, lParam);
  }
}

void registerHostClass(HINSTANCE hInstance, const wchar_t* className) {
  WNDCLASSW wc = {};
  wc.lpfnWndProc = YcWebHostProc;
  wc.hInstance = hInstance;
  wc.lpszClassName = className;
  wc.hCursor = LoadCursorW(nullptr, MAKEINTRESOURCEW(32512) /* IDC_ARROW */);
  wc.style = CS_HREDRAW | CS_VREDRAW;
  RegisterClassW(&wc);
}

}  // namespace

// 取WebView2运行时版本：返回 UTF-8 版本号文本，未安装返回空串。
// 返回值被生成代码立即经 yc_utf8_to_wide 转换，单一静态缓冲即可。
extern "C" const char* webview2_RuntimeVersion() {
  static char versionUtf8[160] = {0};
  versionUtf8[0] = '\0';
  std::wstring base = queryEbWebViewPath(HKEY_LOCAL_MACHINE);
  if (base.empty()) base = queryEbWebViewPath(HKEY_CURRENT_USER);
  if (base.empty()) return versionUtf8;
  // EBWebView 路径末段即版本号（如 ...\EBWebView\120.0.xxxx.yy）
  size_t slash = base.find_last_of(L"\\/");
  std::wstring version = (slash != std::wstring::npos) ? base.substr(slash + 1) : base;
  WideCharToMultiByte(CP_UTF8, 0, version.c_str(), -1, versionUtf8, sizeof(versionUtf8) - 1, nullptr, nullptr);
  return versionUtf8;
}

// 由生成的主程序在创建窗口前调用，注册全部浏览宿主窗口类
extern "C" void webview2_register_window_units(HINSTANCE hInstance) {
  registerHostClass(hInstance, kBrowserClassName);
  registerHostClass(hInstance, kButtonClassName);
  registerHostClass(hInstance, kEditClassName);
}
