// 脚本语言支持组件（script.fne 对齐版）——Windows 实现
// 底层改用系统 IActiveScript 引擎（JScript / VBScript），无需易语言运行时。
//
// 对外 ABI（供转译器生成的 main.cpp 调用）：
//   组件方法（按实例名 name 维护独立引擎状态）：
//     int          script_execute(const wchar_t* name, const wchar_t* code)         执行代码，成功=1 失败=0
//     const char*  script_calc_exp(const wchar_t* name, const wchar_t* expr)        计算表达式→UTF-8 文本
//     void         script_reset(const wchar_t* name)                                清除引擎（含已定义过程）
//     const char*  script_run(name, proc, initializer_list<const wchar_t*> args)    运行过程/函数→UTF-8 文本
//   组件属性（propId: 0=语言 1=错误信息(只读) 2=超时）：
//     long long    script_get_int(name, propId) / void script_set_int(name, propId, v)
//     const char*  script_get_text(name, propId) / void script_set_text(name, propId, v)
//   自由命令：
//     const char*  script_Eval(const char* exprUtf8, const char* langUtf8)          一次性求值（无组件）
//   窗口单元注册（非可视，空实现，仅为满足编译器对源码型库的调用约定）：
//     void         script_register_window_units(HINSTANCE)
//
// 文本返回值均为 UTF-8 const char*，由转译侧 yc_utf8_to_wide 立即拷成 YC_TEXT；本文件用 8 槽轮转缓冲持有。

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <ole2.h>
#include <oleauto.h>
#include <objbase.h>
#include <activscp.h>
#include <string>
#include <vector>
#include <unordered_map>
#include <initializer_list>

namespace {

// ---------------------------------------------------------------------------
// 自定义 GUID（数值抄自 activscp.h 的 DEFINE_GUID；本地定义以免依赖 -luuid / __uuidof(ms-ext)）
// ---------------------------------------------------------------------------
const GUID kGUID_NULL              = {0x00000000,0x0000,0x0000,{0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00}};
const GUID kIID_IUnknown           = {0x00000000,0x0000,0x0000,{0xC0,0x00,0x00,0x00,0x00,0x00,0x00,0x46}};
const GUID kIID_IActiveScript      = {0xbb1a2ae1,0xa4f9,0x11cf,{0x8f,0x20,0x00,0x80,0x5f,0x2c,0xd0,0x64}};
const GUID kIID_IActiveScriptSite  = {0xdb01a1e3,0xa42b,0x11cf,{0x8f,0x20,0x00,0x80,0x5f,0x2c,0xd0,0x64}};
#ifdef _WIN64
const GUID kIID_IActiveScriptParse = {0xc7ef7658,0xe1ee,0x480e,{0x97,0xea,0xd5,0x2c,0xb4,0xd7,0x6d,0x17}};
#else
const GUID kIID_IActiveScriptParse = {0xbb1a2ae2,0xa4f9,0x11cf,{0x8f,0x20,0x00,0x80,0x5f,0x2c,0xd0,0x64}};
#endif

// ---------------------------------------------------------------------------
// 编码工具
// ---------------------------------------------------------------------------
std::wstring utf8ToWide(const char* s) {
    if (!s || !s[0]) return std::wstring();
    int n = MultiByteToWideChar(CP_UTF8, 0, s, -1, NULL, 0);
    if (n <= 1) return std::wstring();
    std::wstring out; out.resize((size_t)n - 1);
    MultiByteToWideChar(CP_UTF8, 0, s, -1, &out[0], n);
    return out;
}

std::string wideToUtf8(const wchar_t* s) {
    if (!s || !s[0]) return std::string();
    int n = WideCharToMultiByte(CP_UTF8, 0, s, -1, NULL, 0, NULL, NULL);
    if (n <= 1) return std::string();
    std::string out; out.resize((size_t)n - 1);
    WideCharToMultiByte(CP_UTF8, 0, s, -1, &out[0], n, NULL, NULL);
    return out;
}

// 返回值缓冲：8 槽轮转，避免同一条转译语句里多次文本返回互相覆盖（与 main.cpp 的 yc_c_str_slot 同理）。
const char* keepUtf8(const std::string& s) {
    static thread_local std::string slots[8];
    static thread_local unsigned idx = 0;
    std::string& b = slots[(idx++) & 7u];
    b = s;
    return b.c_str();
}

void ensureCom() {
    static thread_local bool done = false;
    if (!done) {
        // 脚本引擎为单元线程模型；GUI 主线程通常已是 STA，重复调用返回 S_FALSE/RPC_E_CHANGED_MODE 均无害。
        CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
        done = true;
    }
}

// VARIANT → UTF-8 文本（空/NULL→空串；其余统一 VariantChangeType 到 BSTR）
std::string variantToUtf8(VARIANT& v) {
    if (v.vt == VT_BSTR) return wideToUtf8(v.bstrVal ? v.bstrVal : L"");
    if (v.vt == VT_EMPTY || v.vt == VT_NULL) return std::string();
    VARIANT tmp; VariantInit(&tmp);
    std::string out;
    if (SUCCEEDED(VariantChangeType(&tmp, &v, 0, VT_BSTR)) && tmp.bstrVal) {
        out = wideToUtf8(tmp.bstrVal);
    }
    VariantClear(&tmp);
    return out;
}

// ---------------------------------------------------------------------------
// IActiveScriptSite：最小宿主站点，核心职责是 OnScriptError 捕获出错信息
// ---------------------------------------------------------------------------
class ScriptSite : public IActiveScriptSite {
    LONG m_ref;
    std::wstring* m_errSink;  // 指向所属 ScriptState::errorInfo
public:
    explicit ScriptSite(std::wstring* sink) : m_ref(1), m_errSink(sink) {}
    virtual ~ScriptSite() {}

    // IUnknown
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER;
        if (IsEqualGUID(riid, kIID_IUnknown) || IsEqualGUID(riid, kIID_IActiveScriptSite)) {
            *ppv = static_cast<IActiveScriptSite*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = NULL;
        return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return (ULONG)InterlockedIncrement(&m_ref); }
    ULONG STDMETHODCALLTYPE Release() override {
        LONG r = InterlockedDecrement(&m_ref);
        if (r == 0) delete this;
        return (ULONG)r;
    }

    // IActiveScriptSite
    HRESULT STDMETHODCALLTYPE GetLCID(LCID* p) override { if (p) *p = LOCALE_USER_DEFAULT; return S_OK; }
    HRESULT STDMETHODCALLTYPE GetItemInfo(LPCOLESTR, DWORD, IUnknown**, ITypeInfo**) override { return TYPE_E_ELEMENTNOTFOUND; }
    HRESULT STDMETHODCALLTYPE GetDocVersionString(BSTR* p) override { if (p) *p = NULL; return S_OK; }
    HRESULT STDMETHODCALLTYPE OnScriptTerminate(const VARIANT*, const EXCEPINFO*) override { return S_OK; }
    HRESULT STDMETHODCALLTYPE OnStateChange(SCRIPTSTATE) override { return S_OK; }
    HRESULT STDMETHODCALLTYPE OnScriptError(IActiveScriptError* err) override {
        if (err && m_errSink) {
            EXCEPINFO ei; ZeroMemory(&ei, sizeof(ei));
            DWORD ctx = 0; ULONG line = 0; LONG col = 0;
            err->GetExceptionInfo(&ei);
            err->GetSourcePosition(&ctx, &line, &col);
            wchar_t pos[80];
            swprintf(pos, 80, L"行 %lu, 列 %ld: ", (unsigned long)(line + 1), (long)(col + 1));
            std::wstring msg = pos;
            if (ei.bstrDescription && ei.bstrDescription[0]) msg += ei.bstrDescription;
            else msg += L"脚本错误";
            *m_errSink = msg;
            if (ei.bstrSource) SysFreeString(ei.bstrSource);
            if (ei.bstrDescription) SysFreeString(ei.bstrDescription);
            if (ei.bstrHelpFile) SysFreeString(ei.bstrHelpFile);
        }
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE OnEnterScript() override { return S_OK; }
    HRESULT STDMETHODCALLTYPE OnLeaveScript() override { return S_OK; }
};

// ---------------------------------------------------------------------------
// 每实例状态：按组件名维护独立引擎
// ---------------------------------------------------------------------------
struct ScriptState {
    std::wstring language = L"JScript";
    std::wstring errorInfo;
    int timeout = 0;              // 毫秒；<=0 表示不限制
    std::wstring lastCode;       // 「执行」空代码时复用上次
    IActiveScript* engine = nullptr;
    IActiveScriptParse* parser = nullptr;
    ScriptSite* site = nullptr;
    std::wstring engineLang;     // 当前引擎对应语言；与 language 不一致时重建
};

std::unordered_map<std::wstring, ScriptState> g_states;

ScriptState& stateOf(const wchar_t* name) {
    return g_states[name ? std::wstring(name) : std::wstring()];
}

void destroyEngine(ScriptState& s) {
    if (s.parser) { s.parser->Release(); s.parser = nullptr; }
    if (s.engine) { s.engine->Close(); s.engine->Release(); s.engine = nullptr; }
    if (s.site)   { s.site->Release();  s.site = nullptr; }
    s.engineLang.clear();
}

// 确保引擎存在且语言匹配；返回 false 时 errorInfo 已填写
bool ensureEngine(ScriptState& s) {
    if (s.engine && s.parser && s.engineLang == s.language) return true;
    destroyEngine(s);
    ensureCom();

    std::wstring lang = s.language.empty() ? std::wstring(L"JScript") : s.language;
    CLSID clsid;
    if (FAILED(CLSIDFromProgID(lang.c_str(), &clsid))) {
        s.errorInfo = L"不支持的脚本语言：" + lang;
        return false;
    }
    IActiveScript* eng = nullptr;
    if (FAILED(CoCreateInstance(clsid, NULL, CLSCTX_INPROC_SERVER, kIID_IActiveScript, (void**)&eng)) || !eng) {
        s.errorInfo = L"无法创建脚本引擎：" + lang;
        return false;
    }
    ScriptSite* site = new ScriptSite(&s.errorInfo);
    if (FAILED(eng->SetScriptSite(site))) { site->Release(); eng->Release(); s.errorInfo = L"设置脚本宿主失败"; return false; }
    IActiveScriptParse* parse = nullptr;
    if (FAILED(eng->QueryInterface(kIID_IActiveScriptParse, (void**)&parse)) || !parse) {
        eng->Close(); eng->Release(); site->Release();
        s.errorInfo = L"脚本引擎不支持解析接口";
        return false;
    }
    if (FAILED(parse->InitNew())) { parse->Release(); eng->Close(); eng->Release(); site->Release(); s.errorInfo = L"初始化脚本引擎失败"; return false; }
    eng->SetScriptState(SCRIPTSTATE_STARTED);

    s.engine = eng;
    s.parser = parse;
    s.site = site;
    s.engineLang = lang;
    return true;
}

// ---------------------------------------------------------------------------
// 超时看门狗（纯 Win32 线程，避免依赖 std::thread / winpthreads）
// ---------------------------------------------------------------------------
struct WatchCtx {
    IActiveScript* engine = nullptr;
    int timeout = 0;
    volatile LONG done = 0;
};

DWORD WINAPI watchProc(LPVOID p) {
    WatchCtx* w = (WatchCtx*)p;
    int waited = 0;
    while (waited < w->timeout) {
        Sleep(50);
        if (InterlockedCompareExchange(&w->done, 0, 0)) return 0;
        waited += 50;
    }
    if (InterlockedCompareExchange(&w->done, 0, 0)) return 0;
    int r = MessageBoxW(NULL,
        L"脚本执行时间已超过设定的超时值，是否中止执行？\n（选择“否”则继续等待脚本执行完成）",
        L"脚本执行超时", MB_YESNO | MB_ICONWARNING | MB_SYSTEMMODAL);
    if (r == IDYES && !InterlockedCompareExchange(&w->done, 0, 0) && w->engine) {
        EXCEPINFO ei; ZeroMemory(&ei, sizeof(ei));
        ei.scode = E_ABORT;
        ei.bstrDescription = SysAllocString(L"脚本执行被用户中止（超时）");
        w->engine->InterruptScriptThread(SCRIPTTHREADID_BASE, &ei, 0);
        if (ei.bstrDescription) SysFreeString(ei.bstrDescription);
    }
    return 0;
}

HANDLE beginWatch(ScriptState& s, WatchCtx& w) {
    if (s.timeout <= 0 || !s.engine) return NULL;
    w.engine = s.engine;
    w.timeout = s.timeout;
    w.done = 0;
    return CreateThread(NULL, 0, watchProc, &w, 0, NULL);
}

void endWatch(HANDLE h, WatchCtx& w) {
    if (!h) return;
    InterlockedExchange(&w.done, 1);
    WaitForSingleObject(h, INFINITE);
    CloseHandle(h);
}

void freeExcepInfo(EXCEPINFO& ei) {
    if (ei.bstrSource) SysFreeString(ei.bstrSource);
    if (ei.bstrDescription) SysFreeString(ei.bstrDescription);
    if (ei.bstrHelpFile) SysFreeString(ei.bstrHelpFile);
}

} // namespace

// ===========================================================================
// 对外 ABI
// ===========================================================================

// 执行代码：函数/过程定义会注册到引擎全局，之后可用 script_run 单独调用。
extern "C" int script_execute(const wchar_t* name, const wchar_t* code) {
    ScriptState& s = stateOf(name);
    s.errorInfo.clear();
    std::wstring src = (code && code[0]) ? std::wstring(code) : s.lastCode;
    if (code && code[0]) s.lastCode = code;
    if (src.empty()) return 1;  // 无代码可执行，视为成功空操作
    if (!ensureEngine(s)) return 0;

    EXCEPINFO ei; ZeroMemory(&ei, sizeof(ei));
    WatchCtx w; HANDLE hw = beginWatch(s, w);
    HRESULT hr = s.parser->ParseScriptText(src.c_str(), NULL, NULL, NULL, 0, 0, 0, NULL, &ei);
    endWatch(hw, w);

    if (FAILED(hr)) {
        if (s.errorInfo.empty()) {
            s.errorInfo = (ei.bstrDescription && ei.bstrDescription[0]) ? std::wstring(ei.bstrDescription) : std::wstring(L"脚本执行出错");
        }
        freeExcepInfo(ei);
        return 0;
    }
    freeExcepInfo(ei);
    return 1;
}

// 计算表达式：返回结果文本（UTF-8）。
extern "C" const char* script_calc_exp(const wchar_t* name, const wchar_t* expr) {
    ScriptState& s = stateOf(name);
    s.errorInfo.clear();
    if (!ensureEngine(s)) return keepUtf8(std::string());

    VARIANT result; VariantInit(&result);
    EXCEPINFO ei; ZeroMemory(&ei, sizeof(ei));
    WatchCtx w; HANDLE hw = beginWatch(s, w);
    HRESULT hr = s.parser->ParseScriptText(expr ? expr : L"", NULL, NULL, NULL, 0, 0, SCRIPTTEXT_ISEXPRESSION, &result, &ei);
    endWatch(hw, w);

    std::string out;
    if (SUCCEEDED(hr)) {
        out = variantToUtf8(result);
    } else if (s.errorInfo.empty()) {
        s.errorInfo = (ei.bstrDescription && ei.bstrDescription[0]) ? std::wstring(ei.bstrDescription) : std::wstring(L"表达式计算出错");
    }
    VariantClear(&result);
    freeExcepInfo(ei);
    return keepUtf8(out);
}

// 清除：销毁引擎（含已定义过程/变量），下次调用惰性重建。
extern "C" void script_reset(const wchar_t* name) {
    ScriptState& s = stateOf(name);
    destroyEngine(s);
    s.errorInfo.clear();
    s.lastCode.clear();
}

// 运行指定过程/函数，args 每项为一个宽字符串参数（以 VT_BSTR 传入脚本）；返回结果文本（UTF-8）。
const char* script_run(const wchar_t* name, const wchar_t* proc, std::initializer_list<const wchar_t*> args) {
    ScriptState& s = stateOf(name);
    s.errorInfo.clear();
    if (!ensureEngine(s)) return keepUtf8(std::string());
    if (!proc || !proc[0]) { s.errorInfo = L"未指定要运行的过程或函数名"; return keepUtf8(std::string()); }

    IDispatch* disp = NULL;
    if (FAILED(s.engine->GetScriptDispatch(NULL, &disp)) || !disp) {
        s.errorInfo = L"无法获取脚本调度接口";
        return keepUtf8(std::string());
    }

    DISPID dispid = 0;
    OLECHAR* nm = const_cast<OLECHAR*>(proc);
    HRESULT hr = disp->GetIDsOfNames(kGUID_NULL, &nm, 1, LOCALE_USER_DEFAULT, &dispid);
    if (FAILED(hr)) {
        s.errorInfo = std::wstring(L"找不到过程或函数：") + proc;
        disp->Release();
        return keepUtf8(std::string());
    }

    // 参数打包：COM 约定 rgvarg 为逆序。
    std::vector<VARIANT> vargs;
    vargs.reserve(args.size());
    for (const wchar_t* a : args) {
        VARIANT v; VariantInit(&v);
        v.vt = VT_BSTR;
        v.bstrVal = SysAllocString(a ? a : L"");
        vargs.push_back(v);
    }
    std::vector<VARIANT> rev(vargs.rbegin(), vargs.rend());
    DISPPARAMS dp; ZeroMemory(&dp, sizeof(dp));
    dp.cArgs = (UINT)rev.size();
    dp.rgvarg = rev.empty() ? NULL : rev.data();

    VARIANT result; VariantInit(&result);
    EXCEPINFO ei; ZeroMemory(&ei, sizeof(ei));
    UINT argErr = 0;
    WatchCtx w; HANDLE hw = beginWatch(s, w);
    hr = disp->Invoke(dispid, kGUID_NULL, LOCALE_USER_DEFAULT, DISPATCH_METHOD, &dp, &result, &ei, &argErr);
    endWatch(hw, w);

    std::string out;
    if (SUCCEEDED(hr)) {
        out = variantToUtf8(result);
    } else if (s.errorInfo.empty()) {
        s.errorInfo = (ei.bstrDescription && ei.bstrDescription[0]) ? std::wstring(ei.bstrDescription) : std::wstring(L"脚本运行出错");
    }

    VariantClear(&result);
    for (VARIANT& v : vargs) VariantClear(&v);
    freeExcepInfo(ei);
    disp->Release();
    return keepUtf8(out);
}

// 属性读写：propId 0=语言 1=错误信息(只读) 2=超时
extern "C" long long script_get_int(const wchar_t* name, int propId) {
    ScriptState& s = stateOf(name);
    if (propId == 2) return (long long)s.timeout;
    return 0;
}

extern "C" void script_set_int(const wchar_t* name, int propId, long long v) {
    ScriptState& s = stateOf(name);
    if (propId == 2) s.timeout = (int)v;  // 「无超时」常量 -1 → 归一为不限制（<=0）
}

extern "C" const char* script_get_text(const wchar_t* name, int propId) {
    ScriptState& s = stateOf(name);
    if (propId == 0) return keepUtf8(wideToUtf8(s.language.c_str()));
    if (propId == 1) return keepUtf8(wideToUtf8(s.errorInfo.c_str()));
    return keepUtf8(std::string());
}

extern "C" void script_set_text(const wchar_t* name, int propId, const wchar_t* v) {
    ScriptState& s = stateOf(name);
    if (propId == 0) {
        std::wstring lang = v ? v : L"";
        if (lang.empty()) lang = L"JScript";
        s.language = lang;  // 与 engineLang 不一致时，下次 ensureEngine 重建引擎
    }
    // propId 1（错误信息）只读，忽略写入。
}

// 自由命令：一次性求值（无组件），使用临时独立引擎。expr/lang 均为 UTF-8。
extern "C" const char* script_Eval(const char* exprUtf8, const char* langUtf8) {
    std::wstring wexpr = utf8ToWide(exprUtf8);
    std::wstring wlang = utf8ToWide(langUtf8);
    if (wlang.empty()) wlang = L"JScript";
    ensureCom();

    CLSID clsid;
    if (FAILED(CLSIDFromProgID(wlang.c_str(), &clsid))) return keepUtf8(std::string());
    IActiveScript* eng = NULL;
    if (FAILED(CoCreateInstance(clsid, NULL, CLSCTX_INPROC_SERVER, kIID_IActiveScript, (void**)&eng)) || !eng) return keepUtf8(std::string());
    std::wstring sink;
    ScriptSite* site = new ScriptSite(&sink);
    eng->SetScriptSite(site);
    IActiveScriptParse* parse = NULL;
    std::string out;
    if (SUCCEEDED(eng->QueryInterface(kIID_IActiveScriptParse, (void**)&parse)) && parse) {
        parse->InitNew();
        eng->SetScriptState(SCRIPTSTATE_STARTED);
        VARIANT result; VariantInit(&result);
        EXCEPINFO ei; ZeroMemory(&ei, sizeof(ei));
        if (SUCCEEDED(parse->ParseScriptText(wexpr.c_str(), NULL, NULL, NULL, 0, 0, SCRIPTTEXT_ISEXPRESSION, &result, &ei))) {
            out = variantToUtf8(result);
        }
        VariantClear(&result);
        freeExcepInfo(ei);
        parse->Release();
    }
    eng->Close();
    eng->Release();
    site->Release();
    return keepUtf8(out);
}

// 非可视功能组件，无窗口类需注册；编译器对源码型（有 windowUnits）库会生成本函数调用，故须存在。
extern "C" void script_register_window_units(HINSTANCE) {
}
