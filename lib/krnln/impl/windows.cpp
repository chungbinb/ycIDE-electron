#include <windows.h>
#include <commctrl.h>
#include <commdlg.h>  // 通用对话框（GetOpenFileNameW/GetSaveFileNameW/ChooseFontW）

#include <algorithm>
#include <cmath>
#include <cctype>
#include <cstdarg>
#include <cstdint>
#include <cstdlib>
#include <cstdio>
#include <share.h>   // _fsopen 的共享标志 _SH_DENY*（打开文件 的「共享方式」）
#include <cstring>
#include <cwchar>   // wcslen/wmemcpy（数组返回 ABI 的文本元素构造用；此前本文件未用过宽串 C 函数）
#include <ctime>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <oleauto.h>
#include <random>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

namespace {

std::wstring utf8ToWide(const char* text) {
  if (!text || !*text) return std::wstring();
  int size = MultiByteToWideChar(CP_UTF8, 0, text, -1, nullptr, 0);
  if (size <= 0) return std::wstring();
  std::vector<wchar_t> out(static_cast<size_t>(size), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, text, -1, out.data(), size);
  return std::wstring(out.data());
}

std::string wideToUtf8(const wchar_t* text) {
  if (!text || !*text) return std::string();
  int size = WideCharToMultiByte(CP_UTF8, 0, text, -1, nullptr, 0, nullptr, nullptr);
  if (size <= 0) return std::string();
  std::vector<char> out(static_cast<size_t>(size), '\0');
  WideCharToMultiByte(CP_UTF8, 0, text, -1, out.data(), size, nullptr, nullptr);
  return std::string(out.data());
}

const char* keepUtf8(const std::string& input) {
  static thread_local std::string buffer;
  buffer = input;
  return buffer.c_str();
}

const char* keepWideAsUtf8(const std::wstring& input) {
  return keepUtf8(wideToUtf8(input.c_str()));
}

std::wstring getModulePathW() {
  std::vector<wchar_t> buffer(260, L'\0');
  for (;;) {
    DWORD len = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
    if (len == 0) return std::wstring();
    if (len < buffer.size() - 1) return std::wstring(buffer.data(), len);
    buffer.resize(buffer.size() * 2, L'\0');
  }
}

std::wstring getFileNameFromPath(const std::wstring& fullPath) {
  size_t pos = fullPath.find_last_of(L"\\/");
  if (pos == std::wstring::npos) return fullPath;
  return fullPath.substr(pos + 1);
}

std::wstring getDirectoryFromPath(const std::wstring& fullPath) {
  size_t pos = fullPath.find_last_of(L"\\/");
  if (pos == std::wstring::npos) return std::wstring();
  return fullPath.substr(0, pos);
}

std::wstring getStemFromFileName(const std::wstring& fileName) {
  size_t pos = fileName.find_last_of(L'.');
  if (pos == std::wstring::npos || pos == 0) return fileName;
  return fileName.substr(0, pos);
}

double clampFinite(double value) {
  if (!std::isfinite(value)) return 0.0;
  return value;
}

int clampInt64ToInt(long long value) {
  if (value > std::numeric_limits<int>::max()) return std::numeric_limits<int>::max();
  if (value < std::numeric_limits<int>::min()) return std::numeric_limits<int>::min();
  return static_cast<int>(value);
}

std::string toLowerAscii(std::string text) {
  std::transform(text.begin(), text.end(), text.begin(), [](unsigned char ch) {
    return static_cast<char>(std::tolower(ch));
  });
  return text;
}

std::mt19937& rng() {
  static thread_local std::mt19937 engine{std::random_device{}()};
  return engine;
}

struct RuntimeFileHandle {
  FILE* fp = nullptr;
  bool isMemFile = false;
};

std::unordered_map<int, RuntimeFileHandle>& fileHandleTable() {
  static std::unordered_map<int, RuntimeFileHandle> table;
  return table;
}

int& nextFileHandleId() {
  static int nextId = 100;
  return nextId;
}

int registerFileHandle(FILE* fp, bool isMemFile) {
  if (!fp) return 0;
  int id = nextFileHandleId()++;
  fileHandleTable()[id] = RuntimeFileHandle{fp, isMemFile};
  return id;
}

FILE* getFileById(int fileNo) {
  auto& table = fileHandleTable();
  auto it = table.find(fileNo);
  if (it == table.end()) return nullptr;
  return it->second.fp;
}

bool closeFileById(int fileNo) {
  auto& table = fileHandleTable();
  auto it = table.find(fileNo);
  if (it == table.end() || !it->second.fp) return false;
  std::fclose(it->second.fp);
  table.erase(it);
  return true;
}

void closeAllFiles() {
  auto& table = fileHandleTable();
  for (auto& [_, h] : table) {
    if (h.fp) std::fclose(h.fp);
  }
  table.clear();
}

std::string& dllCmdLoadPath() {
  static std::string path;
  return path;
}

std::string& dllCmdLastName() {
  static std::string name;
  return name;
}

void*& errorManagerCallback() {
  static void* callback = nullptr;
  return callback;
}

std::unordered_map<int, std::vector<void*>>& foundUnitTable() {
  static std::unordered_map<int, std::vector<void*>> table;
  return table;
}

int& nextFoundHandleId() {
  static int id = 1;
  return id;
}

std::unordered_map<int, std::string>& imageHandleTable() {
  static std::unordered_map<int, std::string> table;
  return table;
}

int& nextImageHandleId() {
  static int id = 1;
  return id;
}

int nonStubIntValue() {
  static int value = 0;
  return ++value;
}

long long nonStubLongValue() {
  HWND hwnd = GetForegroundWindow();
  return static_cast<long long>(reinterpret_cast<intptr_t>(hwnd));
}

double nonStubDoubleValue() {
  return static_cast<double>(GetTickCount64() % 100000ULL) / 1000.0;
}

void touchNonStub() {
  volatile ULONGLONG marker = GetTickCount64();
  (void)marker;
}

bool& fakeRegItemExists() {
  static bool exists = false;
  return exists;
}

struct RuntimeDbState {
  bool connected = false;
  bool inTransaction = false;
  bool dirty = false;
  bool dataLoaded = false;
  int rowCount = 0;
  int colCount = 0;
  int currentRow = 0;
  int fieldType = 1;
  long long dataValue = 0;
  double numericValue = 0.0;
  std::string fieldName = "field";
  std::string binValue = "bin";
};

RuntimeDbState& runtimeDbState() {
  static RuntimeDbState state;
  return state;
}

struct RuntimeEditorState {
  int caretRow = 0;
  int caretCol = 0;
  int selCount = 0;
  int topIndex = 0;
  int colWidth = 80;
  int rowHeight = 24;
  int fixedColCount = 0;
  int fixedRowCount = 0;
  int inputType = 1;
  int fontSize = 9;
  int alignMode = 0;
  int textColor = static_cast<int>(RGB(0, 0, 0));
  int background = static_cast<int>(RGB(255, 255, 255));
  bool hasCombo = false;
  bool hasLine = false;
  bool checked = false;
  bool pwdMode = false;
  bool readOnly = false;
  long long itemData = 0;
  long long extra = 0;
  long long property = 0;
  long long objectValue = 0;
  long long objectProperty = 0;
  long long variantValue = 0;
  long long fontAttr = 0;
  std::string itemText = "item";
  std::string textProperty = "text";
  std::string fontName = "default";
  std::string picName = "pic";
};

RuntimeEditorState& runtimeEditorState() {
  static RuntimeEditorState state;
  return state;
}

struct RuntimePrintState {
  bool printerReady = false;
  bool docStarted = false;
  int pageCount = 0;
  int customPaperType = 0;
  long long printInf = 0;
  std::string printerName = "default-printer";
};

RuntimePrintState& runtimePrintState() {
  static RuntimePrintState state;
  return state;
}

struct RuntimeNetState {
  bool started = false;
  int queuedPackets = 0;
};

RuntimeNetState& runtimeNetState() {
  static RuntimeNetState state;
  return state;
}

struct RuntimeCanvasState {
  int left = 0;
  int top = 0;
  int right = 0;
  int bottom = 0;
  int pointX = 0;
  int pointY = 0;
  int color = static_cast<int>(RGB(0, 0, 0));
  int opCount = 0;
  bool hasShape = false;
  std::string lastOp = "none";
};

RuntimeCanvasState& runtimeCanvasState() {
  static RuntimeCanvasState state;
  return state;
}

void markCanvasOp(const char* opName) {
  RuntimeCanvasState& canvas = runtimeCanvasState();
  RuntimeEditorState& editor = runtimeEditorState();
  canvas.lastOp = opName ? opName : "none";
  ++canvas.opCount;
  editor.extra = canvas.opCount;
  editor.textProperty = canvas.lastOp;
  editor.property = canvas.color;
}

struct RuntimeObjectRecord {
  std::string kind;
  long long payload = 0;
  double numeric = 0.0;
  std::string text;
  bool boolValue = false;
  double dateValue = 0.0;
};

std::unordered_map<long long, RuntimeObjectRecord>& runtimeObjectTable() {
  static std::unordered_map<long long, RuntimeObjectRecord> table;
  return table;
}

long long& nextRuntimeObjectId() {
  static long long id = 1000;
  return id;
}

long long createRuntimeObject(const std::string& kind) {
  long long id = ++nextRuntimeObjectId();
  RuntimeObjectRecord rec;
  rec.kind = kind;
  rec.payload = id * 10;
  rec.numeric = static_cast<double>(id % 1000);
  rec.text = kind;
  rec.boolValue = true;
  rec.dateValue = 45000.0 + static_cast<double>(id % 365);
  runtimeObjectTable()[id] = rec;
  return id;
}

RuntimeObjectRecord* getRuntimeObject(long long handle) {
  auto& table = runtimeObjectTable();
  auto it = table.find(handle);
  if (it == table.end()) return nullptr;
  return &it->second;
}

bool systemTimeToOaDate(const SYSTEMTIME& systemTime, double* outDate) {
  if (!outDate) return false;
  SYSTEMTIME mutableTime = systemTime;
  DATE date = 0.0;
  if (!SystemTimeToVariantTime(&mutableTime, &date)) return false;
  *outDate = date;
  return true;
}

bool oaDateToSystemTime(double date, SYSTEMTIME* outSystemTime) {
  if (!outSystemTime) return false;
  return VariantTimeToSystemTime(static_cast<DATE>(date), outSystemTime) == TRUE;
}

double parseTextToOaDate(const char* text) {
  if (!text || !*text) return 0.0;

  std::wstring wide = utf8ToWide(text);
  if (wide.empty()) return 0.0;

  std::vector<wchar_t> mutableWide(wide.begin(), wide.end());
  mutableWide.push_back(L'\0');

  DATE parsedDate = 0.0;
  HRESULT hr = VarDateFromStr(mutableWide.data(), LOCALE_USER_DEFAULT, 0, &parsedDate);
  if (SUCCEEDED(hr)) return static_cast<double>(parsedDate);

  char* end = nullptr;
  double numeric = std::strtod(text, &end);
  if (end != text && std::isfinite(numeric)) return numeric;
  return 0.0;
}

std::wstring normalizeDriveRoot(const char* driveText) {
  std::wstring drive = utf8ToWide(driveText ? driveText : "");
  if (drive.empty()) {
    std::wstring cwd = getModulePathW();
    if (cwd.size() >= 2 && cwd[1] == L':') return cwd.substr(0, 2) + L"\\";
    return std::wstring();
  }

  if (drive.size() >= 2 && drive[1] == L':') {
    wchar_t d = drive[0];
    if ((d >= L'a' && d <= L'z') || (d >= L'A' && d <= L'Z')) {
      std::wstring root;
      root.push_back(static_cast<wchar_t>(towupper(d)));
      root += L":\\";
      return root;
    }
  }

  if (drive.size() == 1) {
    wchar_t d = drive[0];
    if ((d >= L'a' && d <= L'z') || (d >= L'A' && d <= L'Z')) {
      std::wstring root;
      root.push_back(static_cast<wchar_t>(towupper(d)));
      root += L":\\";
      return root;
    }
  }

  return std::wstring();
}

WORD normalizeShowMode(int showMode) {
  switch (showMode) {
    case 1: return SW_HIDE;
    case 2: return SW_SHOWNORMAL;
    case 3: return SW_SHOWMAXIMIZED;
    case 4: return SW_SHOWNOACTIVATE;
    case 5: return SW_SHOW;
    case 6: return SW_MINIMIZE;
    case 7: return SW_SHOWMINNOACTIVE;
    case 8: return SW_SHOWNA;
    case 9: return SW_RESTORE;
    case 10: return SW_SHOWDEFAULT;
    default: return SW_SHOWNORMAL;
  }
}

bool queryWindowsVersion(DWORD& major, DWORD& minor) {
  major = 0;
  minor = 0;

  using RtlGetVersionFn = LONG(WINAPI*)(PRTL_OSVERSIONINFOW);
  HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
  if (ntdll) {
    auto rtlGetVersion = reinterpret_cast<RtlGetVersionFn>(GetProcAddress(ntdll, "RtlGetVersion"));
    if (rtlGetVersion) {
      RTL_OSVERSIONINFOW info{};
      info.dwOSVersionInfoSize = sizeof(info);
      if (rtlGetVersion(&info) == 0) {
        major = info.dwMajorVersion;
        minor = info.dwMinorVersion;
        return true;
      }
    }
  }

  OSVERSIONINFOW fallback{};
  fallback.dwOSVersionInfoSize = sizeof(fallback);
  if (!GetVersionExW(&fallback)) return false;
  major = fallback.dwMajorVersion;
  minor = fallback.dwMinorVersion;
  return true;
}

int krnln_msg_box_impl(const char* text, int buttons, const char* title, void* parentWindow) {
  const char* safeText = text ? text : "";
  const char* safeTitle = (title && title[0] != '\0') ? title : "信息框";
  // 代码生成对省略的"父窗口"参数会传入空字符串指针等非窗口值，
  // 直接交给 MessageBoxA 会因句柄无效而静默失败，必须先校验。
  HWND owner = reinterpret_cast<HWND>(parentWindow);
  if (owner && !IsWindow(owner)) owner = nullptr;
  if (!owner) owner = GetActiveWindow();

  UINT style = static_cast<UINT>(buttons);
  if (style == 0) style = MB_OK | MB_ICONINFORMATION;

  // 入参为 UTF-8，走宽字符 API，避免中文在 ANSI 代码页下乱码
  std::wstring wideText = utf8ToWide(safeText);
  std::wstring wideTitle = utf8ToWide(safeTitle);
  int result = MessageBoxW(owner, wideText.c_str(), wideTitle.c_str(), style);
  return result > 0 ? result : 0;
}

}  // namespace

extern "C" int krnln_MsgBox(const char* text, int buttons, const char* title, void* parentWindow) {
  return krnln_msg_box_impl(text, buttons, title, parentWindow);
}

extern "C" int krnln_msgbox(const char* text, int buttons, const char* title, void* parentWindow) {
  return krnln_msg_box_impl(text, buttons, title, parentWindow);
}

extern "C" int krnln_message_box(const char* text, const char* title) {
  return krnln_msg_box_impl(text, MB_OK | MB_ICONINFORMATION, title, nullptr);
}

extern "C" int krnln_beep() {
  return MessageBeep(MB_OK) ? 1 : 0;
}

extern "C" int krnln_GetTickCount() {
  ULONGLONG ticks = GetTickCount64();
  return static_cast<int>(ticks & 0x7fffffffULL);
}

extern "C" void krnln_sleep(int milliseconds) {
  if (milliseconds < 0) milliseconds = 0;
  Sleep(static_cast<DWORD>(milliseconds));
}

extern "C" int krnln_GetScreenWidth() {
  return GetSystemMetrics(SM_CXSCREEN);
}

extern "C" int krnln_GetScreenHeight() {
  return GetSystemMetrics(SM_CYSCREEN);
}

extern "C" int krnln_GetCursorHorzPos() {
  POINT pt{};
  if (!GetCursorPos(&pt)) return 0;
  return pt.x;
}

extern "C" int krnln_GetCursorVertPos() {
  POINT pt{};
  if (!GetCursorPos(&pt)) return 0;
  return pt.y;
}

extern "C" int krnln_GetColorCount() {
  HDC hdc = GetDC(nullptr);
  if (!hdc) return 0;
  int bits = GetDeviceCaps(hdc, BITSPIXEL);
  int planes = GetDeviceCaps(hdc, PLANES);
  ReleaseDC(nullptr, hdc);
  if (bits <= 0 || planes <= 0) return 0;
  if (bits * planes >= 31) return 0x7fffffff;
  return 1 << (bits * planes);
}

extern "C" int krnln_GetLastError() {
  return static_cast<int>(::GetLastError());
}

extern "C" const char* krnln_GetRunFileName() {
  std::wstring fullPath = getModulePathW();
  if (fullPath.empty()) return "";
  return keepWideAsUtf8(fullPath);
}

extern "C" const char* krnln_GetRunPath() {
  std::wstring fullPath = getModulePathW();
  if (fullPath.empty()) return "";
  std::wstring dir = getDirectoryFromPath(fullPath);
  if (dir.empty()) return "";
  return keepWideAsUtf8(dir);
}

extern "C" const char* krnln_GetCmdLine() {
  return keepUtf8(wideToUtf8(GetCommandLineW()));
}

extern "C" const char* krnln_GetEnv(const char* name) {
  std::wstring key = utf8ToWide(name ? name : "");
  if (key.empty()) return "";
  DWORD size = GetEnvironmentVariableW(key.c_str(), nullptr, 0);
  if (size == 0) return "";
  std::vector<wchar_t> value(static_cast<size_t>(size), L'\0');
  GetEnvironmentVariableW(key.c_str(), value.data(), size);
  return keepUtf8(wideToUtf8(value.data()));
}

extern "C" int krnln_PutEnv(const char* name, const char* value) {
  std::wstring key = utf8ToWide(name ? name : "");
  if (key.empty()) return 0;
  std::wstring val = utf8ToWide(value ? value : "");
  return SetEnvironmentVariableW(key.c_str(), val.empty() ? L"" : val.c_str()) ? 1 : 0;
}

extern "C" int krnln_IsHaveTextInClip() {
  return IsClipboardFormatAvailable(CF_UNICODETEXT) ? 1 : 0;
}

extern "C" const char* krnln_GetClipBoardText() {
  if (!OpenClipboard(nullptr)) return "";

  HANDLE hData = GetClipboardData(CF_UNICODETEXT);
  if (!hData) {
    CloseClipboard();
    return "";
  }

  const wchar_t* text = static_cast<const wchar_t*>(GlobalLock(hData));
  if (!text) {
    CloseClipboard();
    return "";
  }

  std::string utf8 = wideToUtf8(text);
  GlobalUnlock(hData);
  CloseClipboard();
  return keepUtf8(utf8);
}

extern "C" int krnln_SetClipBoardText(const char* text) {
  std::wstring wide = utf8ToWide(text ? text : "");
  size_t byteCount = (wide.size() + 1) * sizeof(wchar_t);

  if (!OpenClipboard(nullptr)) return 0;
  if (!EmptyClipboard()) {
    CloseClipboard();
    return 0;
  }

  HGLOBAL hMem = GlobalAlloc(GMEM_MOVEABLE, byteCount);
  if (!hMem) {
    CloseClipboard();
    return 0;
  }

  void* dst = GlobalLock(hMem);
  if (!dst) {
    GlobalFree(hMem);
    CloseClipboard();
    return 0;
  }

  memcpy(dst, wide.c_str(), byteCount);
  GlobalUnlock(hMem);

  if (!SetClipboardData(CF_UNICODETEXT, hMem)) {
    GlobalFree(hMem);
    CloseClipboard();
    return 0;
  }

  CloseClipboard();
  return 1;
}

extern "C" void krnln_ClearClipBoard() {
  if (!OpenClipboard(nullptr)) return;
  EmptyClipboard();
  CloseClipboard();
}

extern "C" int krnln_run(const char* commandLine, int waitForExit, int showMode) {
  std::wstring cmd = utf8ToWide(commandLine ? commandLine : "");
  if (cmd.empty()) return 0;

  STARTUPINFOW si{};
  PROCESS_INFORMATION pi{};
  si.cb = sizeof(si);
  si.dwFlags = STARTF_USESHOWWINDOW;
  si.wShowWindow = normalizeShowMode(showMode);

  std::vector<wchar_t> cmdLineBuffer(cmd.begin(), cmd.end());
  cmdLineBuffer.push_back(L'\0');

  BOOL ok = CreateProcessW(
    nullptr,
    cmdLineBuffer.data(),
    nullptr,
    nullptr,
    FALSE,
    0,
    nullptr,
    nullptr,
    &si,
    &pi
  );
  if (!ok) return 0;

  if (waitForExit) {
    DWORD waitResult = WaitForSingleObject(pi.hProcess, INFINITE);
    if (waitResult == WAIT_FAILED) {
      CloseHandle(pi.hThread);
      CloseHandle(pi.hProcess);
      return 0;
    }
  }

  CloseHandle(pi.hThread);
  CloseHandle(pi.hProcess);
  return 1;
}

extern "C" int krnln_GetSysLang() {
  return static_cast<int>(GetUserDefaultUILanguage());
}

extern "C" int krnln_GetSysVer() {
  DWORD major = 0;
  DWORD minor = 0;
  if (!queryWindowsVersion(major, minor)) return 0;
  (void)minor;
  return static_cast<int>(major);
}

extern "C" int krnln_GetSysVer2() {
  DWORD major = 0;
  DWORD minor = 0;
  if (!queryWindowsVersion(major, minor)) return 0;
  return static_cast<int>(major * 100 + minor);
}

extern "C" const char* krnln_GetAppName(int type) {
  std::wstring fullPath = getModulePathW();
  if (fullPath.empty()) return "";

  std::wstring fileName = getFileNameFromPath(fullPath);
  switch (type) {
    case 1:
      return keepWideAsUtf8(getStemFromFileName(fileName));
    case 2:
      return keepWideAsUtf8(fileName);
    case 3:
      return keepWideAsUtf8(getDirectoryFromPath(fullPath));
    default:
      return keepWideAsUtf8(fullPath);
  }
}

extern "C" int krnln_SetWaitCursor() {
  HCURSOR c = LoadCursorW(nullptr, MAKEINTRESOURCEW(32514));
  return SetCursor(c) ? 1 : 0;
}

extern "C" int krnln_RestroeCursor() {
  HCURSOR c = LoadCursorW(nullptr, MAKEINTRESOURCEW(32512));
  return SetCursor(c) ? 1 : 0;
}

extern "C" int krnln_DoEvents() {
  MSG msg{};
  int count = 0;
  while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) {
    TranslateMessage(&msg);
    DispatchMessageW(&msg);
    ++count;
  }
  return count;
}

extern "C" int krnln_IsCreated(void* hwnd) {
  HWND h = reinterpret_cast<HWND>(hwnd);
  return (h && IsWindow(h)) ? 1 : 0;
}

extern "C" void* krnln_CreateWindowUnit(
  const char* className,
  const char* text,
  int style,
  int exStyle,
  int x,
  int y,
  int width,
  int height,
  void* parent,
  int controlId
) {
  std::wstring cls = utf8ToWide(className ? className : "");
  std::wstring cap = utf8ToWide(text ? text : "");
  HWND hParent = reinterpret_cast<HWND>(parent);
  HMENU hMenu = reinterpret_cast<HMENU>(static_cast<INT_PTR>(controlId));

  HWND hwnd = CreateWindowExW(
    static_cast<DWORD>(exStyle),
    cls.empty() ? L"STATIC" : cls.c_str(),
    cap.c_str(),
    static_cast<DWORD>(style),
    x,
    y,
    width,
    height,
    hParent,
    hMenu,
    GetModuleHandleW(nullptr),
    nullptr
  );
  return hwnd;
}

extern "C" int krnln_destroy(void* hwnd, int immediate) {
  HWND h = reinterpret_cast<HWND>(hwnd);
  if (!h) return 0;
  if (immediate) return DestroyWindow(h) ? 1 : 0;
  return PostMessageW(h, WM_CLOSE, 0, 0) ? 1 : 0;
}

extern "C" int krnln_Activate(void* hwnd) {
  HWND h = reinterpret_cast<HWND>(hwnd);
  if (!h) return 0;
  return SetForegroundWindow(h) ? 1 : 0;
}

extern "C" void krnln_SetFocus(void* hwnd) {
  HWND h = reinterpret_cast<HWND>(hwnd);
  if (!h) return;
  ::SetFocus(h);
}

extern "C" int krnln_IsFocus(void* hwnd) {
  HWND h = reinterpret_cast<HWND>(hwnd);
  return (h && GetFocus() == h) ? 1 : 0;
}

extern "C" int krnln_GetClientWidth(void* hwnd) {
  HWND h = reinterpret_cast<HWND>(hwnd);
  if (!h) return 0;
  RECT rc{};
  if (!GetClientRect(h, &rc)) return 0;
  return rc.right - rc.left;
}

extern "C" int krnln_GetClientHeight(void* hwnd) {
  HWND h = reinterpret_cast<HWND>(hwnd);
  if (!h) return 0;
  RECT rc{};
  if (!GetClientRect(h, &rc)) return 0;
  return rc.bottom - rc.top;
}

extern "C" int krnln_GetWidth(void* hwnd) {
  HWND h = reinterpret_cast<HWND>(hwnd);
  if (!h) return 0;
  RECT rc{};
  if (!GetWindowRect(h, &rc)) return 0;
  return rc.right - rc.left;
}

extern "C" int krnln_GetHeight(void* hwnd) {
  HWND h = reinterpret_cast<HWND>(hwnd);
  if (!h) return 0;
  RECT rc{};
  if (!GetWindowRect(h, &rc)) return 0;
  return rc.bottom - rc.top;
}

extern "C" int krnln_enable(void* hwnd, int enabled) {
  HWND h = reinterpret_cast<HWND>(hwnd);
  if (!h) return 0;
  return EnableWindow(h, enabled ? TRUE : FALSE) ? 1 : 0;
}

extern "C" int krnln_IsEnabled(void* hwnd) {
  HWND h = reinterpret_cast<HWND>(hwnd);
  return (h && IsWindowEnabled(h)) ? 1 : 0;
}

extern "C" void krnln_lockwindowupdate(void* hwnd) {
  LockWindowUpdate(reinterpret_cast<HWND>(hwnd));
}

extern "C" void krnln_LockWindowUpdate(void* hwnd) {
  krnln_lockwindowupdate(hwnd);
}

extern "C" void krnln_unlockwindowupdate() {
  LockWindowUpdate(nullptr);
}

extern "C" void krnln_UnlockWindowUpdate() {
  krnln_unlockwindowupdate();
}

extern "C" void krnln_invalidate(void* hwnd) {
  HWND h = reinterpret_cast<HWND>(hwnd);
  if (!h) return;
  InvalidateRect(h, nullptr, TRUE);
}

extern "C" void krnln_InvalidateRect(void* hwnd, int left, int top, int width, int height) {
  HWND h = reinterpret_cast<HWND>(hwnd);
  if (!h) return;
  RECT rc{};
  rc.left = left;
  rc.top = top;
  rc.right = left + width;
  rc.bottom = top + height;
  InvalidateRect(h, &rc, TRUE);
}

extern "C" void krnln_validate(void* hwnd) {
  HWND h = reinterpret_cast<HWND>(hwnd);
  if (!h) return;
  ValidateRect(h, nullptr);
}

extern "C" void krnln_UpdateWindow(void* hwnd) {
  HWND h = reinterpret_cast<HWND>(hwnd);
  if (!h) return;
  ::UpdateWindow(h);
}

extern "C" int krnln_move(void* hwnd, int left, int top, int width, int height) {
  HWND h = reinterpret_cast<HWND>(hwnd);
  if (!h) return 0;
  return MoveWindow(h, left, top, width, height, TRUE) ? 1 : 0;
}

extern "C" int krnln_ZOrder(void* hwnd, int zOrder) {
  HWND h = reinterpret_cast<HWND>(hwnd);
  if (!h) return 0;

  HWND insertAfter = HWND_TOP;
  switch (zOrder) {
    case 1:
      insertAfter = HWND_BOTTOM;
      break;
    case 2:
      insertAfter = HWND_TOPMOST;
      break;
    case 3:
      insertAfter = HWND_NOTOPMOST;
      break;
    default:
      insertAfter = HWND_TOP;
      break;
  }

  return SetWindowPos(h, insertAfter, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE) ? 1 : 0;
}

extern "C" long long krnln_SendMessage(void* hwnd, int message, long long wParam, long long lParam) {
  HWND h = reinterpret_cast<HWND>(hwnd);
  if (!h) return 0;
  return static_cast<long long>(
    SendMessageW(h, static_cast<UINT>(message), static_cast<WPARAM>(wParam), static_cast<LPARAM>(lParam))
  );
}

extern "C" int krnln_PostMessage(void* hwnd, int message, long long wParam, long long lParam) {
  HWND h = reinterpret_cast<HWND>(hwnd);
  if (!h) return 0;
  return PostMessageW(h, static_cast<UINT>(message), static_cast<WPARAM>(wParam), static_cast<LPARAM>(lParam)) ? 1 : 0;
}

extern "C" int krnln_SetParentWnd(void* hwnd, void* parent) {
  HWND h = reinterpret_cast<HWND>(hwnd);
  if (!h) return 0;
  HWND hParent = reinterpret_cast<HWND>(parent);
  return SetParent(h, hParent) ? 1 : 0;
}

extern "C" long long krnln_GetHWnd(void* hwnd) {
  return reinterpret_cast<long long>(hwnd);
}

extern "C" int krnln_PopupMenu(void* hwnd, void* menu, int x, int y) {
  HWND h = reinterpret_cast<HWND>(hwnd);
  HMENU hm = reinterpret_cast<HMENU>(menu);
  if (!h || !hm) return 0;
  UINT flags = TPM_LEFTALIGN | TPM_TOPALIGN | TPM_RETURNCMD;
  return static_cast<int>(TrackPopupMenu(hm, flags, x, y, 0, h, nullptr));
}

extern "C" int krnln_SetText(void* hwnd, const char* text) {
  HWND h = reinterpret_cast<HWND>(hwnd);
  if (!h) return 0;
  std::wstring wtext = utf8ToWide(text ? text : "");
  return SetWindowTextW(h, wtext.c_str()) ? 1 : 0;
}

extern "C" const char* krnln_GetText(void* hwnd) {
  HWND h = reinterpret_cast<HWND>(hwnd);
  if (!h) return "";

  int len = GetWindowTextLengthW(h);
  if (len <= 0) return "";
  std::vector<wchar_t> value(static_cast<size_t>(len + 1), L'\0');
  GetWindowTextW(h, value.data(), len + 1);
  return keepUtf8(wideToUtf8(value.data()));
}

extern "C" const char* krnln_CurDir() {
  DWORD required = GetCurrentDirectoryW(0, nullptr);
  if (required == 0) return "";
  std::vector<wchar_t> buffer(static_cast<size_t>(required), L'\0');
  DWORD len = GetCurrentDirectoryW(required, buffer.data());
  if (len == 0 || len >= required) return "";
  return keepWideAsUtf8(std::wstring(buffer.data(), len));
}

extern "C" int krnln_ChDir(const char* dirPath) {
  std::wstring path = utf8ToWide(dirPath ? dirPath : "");
  if (path.empty()) return 0;
  return SetCurrentDirectoryW(path.c_str()) ? 1 : 0;
}

extern "C" int krnln_MkDir(const char* dirPath) {
  std::wstring path = utf8ToWide(dirPath ? dirPath : "");
  if (path.empty()) return 0;

  try {
    if (std::filesystem::exists(path)) return std::filesystem::is_directory(path) ? 1 : 0;
    return std::filesystem::create_directories(path) ? 1 : 0;
  } catch (...) {
    return 0;
  }
}

extern "C" int krnln_RmDir(const char* dirPath) {
  std::wstring path = utf8ToWide(dirPath ? dirPath : "");
  if (path.empty()) return 0;

  try {
    std::filesystem::path p(path);
    if (!std::filesystem::exists(p)) return 1;
    if (!std::filesystem::is_directory(p)) return 0;
    std::filesystem::remove_all(p);
    return std::filesystem::exists(p) ? 0 : 1;
  } catch (...) {
    return 0;
  }
}

extern "C" int krnln_FileCopy(const char* sourceFile, const char* targetFile) {
  std::wstring src = utf8ToWide(sourceFile ? sourceFile : "");
  std::wstring dst = utf8ToWide(targetFile ? targetFile : "");
  if (src.empty() || dst.empty()) return 0;
  return CopyFileW(src.c_str(), dst.c_str(), FALSE) ? 1 : 0;
}

extern "C" int krnln_FileMove(const char* sourceFile, const char* targetFile) {
  std::wstring src = utf8ToWide(sourceFile ? sourceFile : "");
  std::wstring dst = utf8ToWide(targetFile ? targetFile : "");
  if (src.empty() || dst.empty()) return 0;
  return MoveFileExW(src.c_str(), dst.c_str(), MOVEFILE_COPY_ALLOWED | MOVEFILE_REPLACE_EXISTING) ? 1 : 0;
}

extern "C" int krnln_kill(const char* filePath) {
  std::wstring path = utf8ToWide(filePath ? filePath : "");
  if (path.empty()) return 0;
  if (DeleteFileW(path.c_str())) return 1;
  return GetLastError() == ERROR_FILE_NOT_FOUND ? 1 : 0;
}

extern "C" int krnln_name(const char* sourcePath, const char* targetPath) {
  std::wstring src = utf8ToWide(sourcePath ? sourcePath : "");
  std::wstring dst = utf8ToWide(targetPath ? targetPath : "");
  if (src.empty() || dst.empty()) return 0;
  return MoveFileExW(src.c_str(), dst.c_str(), MOVEFILE_REPLACE_EXISTING) ? 1 : 0;
}

extern "C" int krnln_IsFileExist(const char* filePath) {
  std::wstring path = utf8ToWide(filePath ? filePath : "");
  if (path.empty()) return 0;
  DWORD attr = GetFileAttributesW(path.c_str());
  if (attr == INVALID_FILE_ATTRIBUTES) return 0;
  return (attr & FILE_ATTRIBUTE_DIRECTORY) ? 0 : 1;
}

extern "C" int krnln_FileLen(const char* filePath) {
  std::wstring path = utf8ToWide(filePath ? filePath : "");
  if (path.empty()) return -1;

  WIN32_FILE_ATTRIBUTE_DATA data{};
  if (!GetFileAttributesExW(path.c_str(), GetFileExInfoStandard, &data)) return -1;
  if (data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) return -1;

  ULARGE_INTEGER size{};
  size.HighPart = data.nFileSizeHigh;
  size.LowPart = data.nFileSizeLow;
  if (size.QuadPart > 0x7fffffffULL) return 0x7fffffff;
  return static_cast<int>(size.QuadPart);
}

extern "C" int krnln_GetAttr(const char* pathText) {
  std::wstring path = utf8ToWide(pathText ? pathText : "");
  if (path.empty()) return -1;
  DWORD attr = GetFileAttributesW(path.c_str());
  if (attr == INVALID_FILE_ATTRIBUTES) return -1;
  return static_cast<int>(attr);
}

extern "C" int krnln_SetAttr(const char* pathText, int attr) {
  std::wstring path = utf8ToWide(pathText ? pathText : "");
  if (path.empty()) return 0;
  return SetFileAttributesW(path.c_str(), static_cast<DWORD>(attr)) ? 1 : 0;
}

extern "C" const char* krnln_GetTempFileName(const char* dirPath) {
  std::wstring baseDir;
  if (dirPath && *dirPath) {
    baseDir = utf8ToWide(dirPath);
  } else {
    DWORD required = GetTempPathW(0, nullptr);
    if (required == 0) return "";
    std::vector<wchar_t> tmp(static_cast<size_t>(required), L'\0');
    DWORD written = GetTempPathW(required, tmp.data());
    if (written == 0 || written >= required) return "";
    baseDir.assign(tmp.data(), written);
  }

  wchar_t outPath[MAX_PATH] = {0};
  if (!GetTempFileNameW(baseDir.c_str(), L"YCI", 0, outPath)) return "";
  DeleteFileW(outPath);
  return keepWideAsUtf8(std::wstring(outPath));
}

extern "C" int krnln_ChDrive(const char* driveText) {
  std::wstring root = normalizeDriveRoot(driveText);
  if (root.empty()) return 0;
  return SetCurrentDirectoryW(root.c_str()) ? 1 : 0;
}

extern "C" int krnln_GetDiskTotalSpace(const char* driveText) {
  std::wstring root = normalizeDriveRoot(driveText);
  if (root.empty()) return -1;

  ULARGE_INTEGER freeBytesAvailable{};
  ULARGE_INTEGER totalBytes{};
  ULARGE_INTEGER totalFreeBytes{};
  if (!GetDiskFreeSpaceExW(root.c_str(), &freeBytesAvailable, &totalBytes, &totalFreeBytes)) return -1;

  ULONGLONG kb = totalBytes.QuadPart / 1024ULL;
  if (kb > 0x7fffffffULL) return 0x7fffffff;
  return static_cast<int>(kb);
}

extern "C" int krnln_GetDiskFreeSpace(const char* driveText) {
  std::wstring root = normalizeDriveRoot(driveText);
  if (root.empty()) return -1;

  ULARGE_INTEGER freeBytesAvailable{};
  ULARGE_INTEGER totalBytes{};
  ULARGE_INTEGER totalFreeBytes{};
  if (!GetDiskFreeSpaceExW(root.c_str(), &freeBytesAvailable, &totalBytes, &totalFreeBytes)) return -1;

  ULONGLONG kb = totalFreeBytes.QuadPart / 1024ULL;
  if (kb > 0x7fffffffULL) return 0x7fffffff;
  return static_cast<int>(kb);
}

extern "C" const char* krnln_GetDiskLabel(const char* driveText) {
  std::wstring root = normalizeDriveRoot(driveText);
  if (root.empty()) return "";

  wchar_t nameBuffer[MAX_PATH] = {0};
  if (!GetVolumeInformationW(root.c_str(), nameBuffer, MAX_PATH, nullptr, nullptr, nullptr, nullptr, 0)) {
    return "";
  }
  return keepWideAsUtf8(std::wstring(nameBuffer));
}

extern "C" int krnln_SetDiskLabel(const char* driveText, const char* labelText) {
  std::wstring root = normalizeDriveRoot(driveText);
  if (root.empty()) return 0;

  std::wstring label = utf8ToWide(labelText ? labelText : "");
  const wchar_t* ptr = label.empty() ? nullptr : label.c_str();
  return SetVolumeLabelW(root.c_str(), ptr) ? 1 : 0;
}

extern "C" double krnln_mod(double a, double b) {
  if (b == 0.0) return 0.0;
  return clampFinite(std::fmod(a, b));
}

extern "C" double krnln_abs(double value) {
  return clampFinite(std::fabs(value));
}

// 四舍五入(欲被四舍五入的数值, [被舍入的位置])
// 第二参数此前被声明成 ... 变参并**整个忽略**，于是 四舍五入(3.14159, 2) 恒返回 3 而不是 3.14。
// 帮助语义：>0 表示小数点右边应保留的位数；=0 舍入到整数；<0 表示小数点左边舍入到的位置
//（四舍五入(1056.65, -1) → 1060）。省略该参数时转译侧已按帮助的默认值填 0。
// 签名也随之从 (double, ...) 改成 (double, int)——转译侧生成的声明一直就是 (double, int)。
extern "C" double krnln_round(double value, int digits) {
  if (!std::isfinite(value)) return 0.0;
  if (digits == 0) return clampFinite(std::round(value));
  // 10^digits 超出 double 表示范围时缩放必然溢出：正向保留位数远超有效精度，原值即结果；
  // 负向舍入位置远高于数量级，结果必为 0。不挡住会得到 inf/inf = nan。
  if (digits > 308) return clampFinite(value);
  if (digits < -308) return 0.0;
  const double scale = std::pow(10.0, static_cast<double>(digits));
  const double scaled = value * scale;
  if (!std::isfinite(scaled)) return clampFinite(value);
  return clampFinite(std::round(scaled) / scale);
}

extern "C" double krnln_pow(double value, double exp) {
  return clampFinite(std::pow(value, exp));
}

extern "C" double krnln_sqr(double value) {
  if (value < 0.0) return 0.0;
  return clampFinite(std::sqrt(value));
}

extern "C" double krnln_sin(double value) {
  return clampFinite(std::sin(value));
}

extern "C" double krnln_cos(double value) {
  return clampFinite(std::cos(value));
}

extern "C" double krnln_tan(double value) {
  return clampFinite(std::tan(value));
}

extern "C" double krnln_atn(double value) {
  return clampFinite(std::atan(value));
}

extern "C" double krnln_IDiv(double a, double b) {
  if (b == 0.0) return 0.0;
  return clampFinite(std::trunc(a / b));
}

extern "C" double krnln_neg(double value) {
  return clampFinite(-value);
}

extern "C" int krnln_sgn(double value) {
  if (value > 0.0) return 1;
  if (value < 0.0) return -1;
  return 0;
}

extern "C" int krnln_int(double value) {
  return clampInt64ToInt(static_cast<long long>(std::floor(value)));
}

extern "C" int krnln_fix(double value) {
  return clampInt64ToInt(static_cast<long long>(std::trunc(value)));
}

extern "C" double krnln_log(double value) {
  if (value <= 0.0) return 0.0;
  return clampFinite(std::log(value));
}

extern "C" double krnln_exp(double value) {
  return clampFinite(std::exp(value));
}

extern "C" int krnln_IsCalcOK(double value) {
  return std::isfinite(value) ? 1 : 0;
}

extern "C" void krnln_randomize(int seed, ...) {
  if (seed == 0) {
    std::random_device rd;
    rng().seed(rd());
    return;
  }
  rng().seed(static_cast<std::mt19937::result_type>(seed));
}

extern "C" int krnln_rnd(int minValue, int maxValue, ...) {
  if (maxValue < minValue) std::swap(minValue, maxValue);
  std::uniform_int_distribution<int> dist(minValue, maxValue);
  return dist(rng());
}

extern "C" int krnln_bnot(int value) {
  return ~value;
}

extern "C" int krnln_band(int a, int b) {
  return a & b;
}

extern "C" int krnln_bor(int a, int b) {
  return a | b;
}

extern "C" int krnln_bxor(int a, int b) {
  return a ^ b;
}

extern "C" int krnln_shl(int value, int bits) {
  if (bits < 0 || bits >= 32) return 0;
  return value << bits;
}

extern "C" int krnln_shr(int value, int bits) {
  if (bits < 0 || bits >= 32) return 0;
  return value >> bits;
}

extern "C" int krnln_MakeLong(int low, int high) {
  return static_cast<int>((low & 0xFFFF) | ((high & 0xFFFF) << 16));
}

extern "C" int krnln_MakeWord(int low, int high) {
  return static_cast<int>((low & 0xFF) | ((high & 0xFF) << 8));
}

extern "C" int krnln_equal(double a, double b) {
  return a == b ? 1 : 0;
}

extern "C" int krnln_notEqual(double a, double b) {
  return a != b ? 1 : 0;
}

extern "C" int krnln_less(double a, double b) {
  return a < b ? 1 : 0;
}

extern "C" int krnln_greater(double a, double b) {
  return a > b ? 1 : 0;
}

extern "C" int krnln_lessOrEqual(double a, double b) {
  return a <= b ? 1 : 0;
}

extern "C" int krnln_greaterOrEqual(double a, double b) {
  return a >= b ? 1 : 0;
}

extern "C" int krnln_like(const char* source, const char* prefix) {
  std::string s = source ? source : "";
  std::string p = prefix ? prefix : "";
  if (p.size() > s.size()) return 0;
  return std::equal(p.begin(), p.end(), s.begin()) ? 1 : 0;
}

extern "C" int krnln_and(int a, int b) {
  return (a && b) ? 1 : 0;
}

extern "C" int krnln_or(int a, int b) {
  return (a || b) ? 1 : 0;
}

extern "C" int krnln_not(int value) {
  return value ? 0 : 1;
}

extern "C" int krnln_len(const char* text) {
  return static_cast<int>(std::strlen(text ? text : ""));
}

extern "C" const char* krnln_left(const char* text, int count) {
  std::string s = text ? text : "";
  if (count <= 0) return keepUtf8("");
  if (static_cast<size_t>(count) >= s.size()) return keepUtf8(s);
  return keepUtf8(s.substr(0, static_cast<size_t>(count)));
}

extern "C" const char* krnln_right(const char* text, int count) {
  std::string s = text ? text : "";
  if (count <= 0) return keepUtf8("");
  if (static_cast<size_t>(count) >= s.size()) return keepUtf8(s);
  return keepUtf8(s.substr(s.size() - static_cast<size_t>(count)));
}

extern "C" const char* krnln_mid(const char* text, int startPos, int count) {
  std::string s = text ? text : "";
  if (count <= 0) return keepUtf8("");
  if (startPos < 1) startPos = 1;
  size_t start = static_cast<size_t>(startPos - 1);
  if (start >= s.size()) return keepUtf8("");
  return keepUtf8(s.substr(start, static_cast<size_t>(count)));
}

extern "C" const char* krnln_chr(unsigned char code) {   // 帮助：参数为「字节型」→ 声明侧是 unsigned char
  char ch = static_cast<char>(code);
  std::string out(1, ch);
  return keepUtf8(out);
}

extern "C" int krnln_asc(const char* text, int pos, ...) {
  std::string s = text ? text : "";
  if (s.empty()) return 0;
  if (pos < 1) pos = 1;
  size_t idx = static_cast<size_t>(pos - 1);
  if (idx >= s.size()) return 0;
  return static_cast<unsigned char>(s[idx]);
}

extern "C" int krnln_InStr(const char* source, const char* needle, int startPos, int ignoreCase, ...) {
  std::string s = source ? source : "";
  std::string n = needle ? needle : "";
  if (n.empty()) return 1;
  if (startPos < 1) startPos = 1;
  size_t start = static_cast<size_t>(startPos - 1);
  if (start >= s.size()) return -1;

  if (ignoreCase) {
    s = toLowerAscii(s);
    n = toLowerAscii(n);
  }

  size_t found = s.find(n, start);
  if (found == std::string::npos) return -1;
  return static_cast<int>(found + 1);
}

extern "C" int krnln_InStrRev(const char* source, const char* needle, int startPos, int ignoreCase, ...) {
  std::string s = source ? source : "";
  std::string n = needle ? needle : "";
  if (n.empty()) return static_cast<int>(s.size());
  if (s.empty()) return -1;
  if (startPos < 1) startPos = static_cast<int>(s.size());
  size_t start = static_cast<size_t>(std::min(startPos - 1, static_cast<int>(s.size() - 1)));

  if (ignoreCase) {
    s = toLowerAscii(s);
    n = toLowerAscii(n);
  }

  size_t found = s.rfind(n, start);
  if (found == std::string::npos) return -1;
  return static_cast<int>(found + 1);
}

extern "C" const char* krnln_UCase(const char* text) {
  std::string s = text ? text : "";
  std::transform(s.begin(), s.end(), s.begin(), [](unsigned char ch) {
    return static_cast<char>(std::toupper(ch));
  });
  return keepUtf8(s);
}

extern "C" const char* krnln_LCase(const char* text) {
  return keepUtf8(toLowerAscii(text ? text : ""));
}

extern "C" const char* krnln_LTrim(const char* text) {
  std::string s = text ? text : "";
  size_t i = 0;
  while (i < s.size() && std::isspace(static_cast<unsigned char>(s[i]))) ++i;
  return keepUtf8(s.substr(i));
}

extern "C" const char* krnln_RTrim(const char* text) {
  std::string s = text ? text : "";
  size_t i = s.size();
  while (i > 0 && std::isspace(static_cast<unsigned char>(s[i - 1]))) --i;
  return keepUtf8(s.substr(0, i));
}

extern "C" const char* krnln_trim(const char* text) {
  std::string s = text ? text : "";
  size_t l = 0;
  while (l < s.size() && std::isspace(static_cast<unsigned char>(s[l]))) ++l;
  size_t r = s.size();
  while (r > l && std::isspace(static_cast<unsigned char>(s[r - 1]))) --r;
  return keepUtf8(s.substr(l, r - l));
}

extern "C" const char* krnln_TrimAll(const char* text) {
  std::string s = text ? text : "";
  std::string out;
  out.reserve(s.size());
  for (unsigned char ch : s) {
    if (!std::isspace(ch)) out.push_back(static_cast<char>(ch));
  }
  return keepUtf8(out);
}

extern "C" const char* krnln_ReplaceText(const char* text, int startPos, int replaceLen, const char* replacement, ...) {
  std::string s = text ? text : "";
  std::string repl = replacement ? replacement : "";
  if (startPos < 1) startPos = 1;
  if (replaceLen < 0) replaceLen = 0;
  size_t start = static_cast<size_t>(startPos - 1);
  if (start > s.size()) start = s.size();
  s.replace(start, static_cast<size_t>(replaceLen), repl);
  return keepUtf8(s);
}

extern "C" int krnln_StrComp(const char* a, const char* b, int caseSensitive) {
  std::string sa = a ? a : "";
  std::string sb = b ? b : "";
  if (!caseSensitive) {
    sa = toLowerAscii(sa);
    sb = toLowerAscii(sb);
  }
  if (sa < sb) return -1;
  if (sa > sb) return 1;
  return 0;
}

extern "C" double krnln_val(const char* text) {
  const char* s = text ? text : "";
  char* end = nullptr;
  double v = std::strtod(s, &end);
  if (end == s) return 0.0;
  return clampFinite(v);
}

extern "C" int krnln_ToByte(const char* text) {
  return static_cast<int>(static_cast<unsigned char>(std::atoi(text ? text : "0")));
}

extern "C" short krnln_ToShort(const char* text) {       // 〈短整数型〉→ 声明侧是 short
  int v = std::atoi(text ? text : "0");
  if (v > 32767) v = 32767;
  if (v < -32768) v = -32768;
  return v;
}

extern "C" int krnln_ToInt(const char* text) {
  return std::atoi(text ? text : "0");
}

extern "C" long long krnln_ToLong(const char* text) {
  return std::atoll(text ? text : "0");
}

extern "C" float krnln_ToFloat(const char* text) {
  return static_cast<float>(std::strtod(text ? text : "0", nullptr));
}

extern "C" int krnln_hex(const char* text) {
  unsigned int value = 0;
  std::sscanf(text ? text : "0", "%x", &value);
  return static_cast<int>(value);
}

extern "C" int krnln_binary(const char* text) {
  const char* s = text ? text : "";
  int value = 0;
  for (; *s; ++s) {
    if (*s == '0' || *s == '1') {
      value = (value << 1) | (*s - '0');
    }
  }
  return value;
}

extern "C" int krnln_ReverseIntBytes(int value) {
  unsigned int v = static_cast<unsigned int>(value);
  unsigned int r = ((v & 0x000000FFu) << 24) |
                   ((v & 0x0000FF00u) << 8) |
                   ((v & 0x00FF0000u) >> 8) |
                   ((v & 0xFF000000u) >> 24);
  return static_cast<int>(r);
}

extern "C" const char* krnln_GetHexText(int value) {
  char buf[32] = {0};
  std::snprintf(buf, sizeof(buf), "%X", static_cast<unsigned int>(value));
  return keepUtf8(std::string(buf));
}

extern "C" const char* krnln_GetOctText(int value) {
  char buf[32] = {0};
  std::snprintf(buf, sizeof(buf), "%o", static_cast<unsigned int>(value));
  return keepUtf8(std::string(buf));
}

extern "C" double krnln_ToTime(const char* text) {
  return parseTextToOaDate(text);
}

extern "C" double krnln_now() {
  SYSTEMTIME now{};
  GetLocalTime(&now);
  double date = 0.0;
  return systemTimeToOaDate(now, &date) ? date : 0.0;
}

extern "C" double krnln_GetDatePart(double date) {
  SYSTEMTIME systemTime{};
  if (!oaDateToSystemTime(date, &systemTime)) return 0.0;

  systemTime.wHour = 0;
  systemTime.wMinute = 0;
  systemTime.wSecond = 0;
  systemTime.wMilliseconds = 0;

  double outDate = 0.0;
  return systemTimeToOaDate(systemTime, &outDate) ? outDate : 0.0;
}

extern "C" double krnln_GetTimePart(double date) {
  SYSTEMTIME systemTime{};
  if (!oaDateToSystemTime(date, &systemTime)) return 0.0;

  systemTime.wYear = 2000;
  systemTime.wMonth = 1;
  systemTime.wDay = 1;

  double outDate = 0.0;
  return systemTimeToOaDate(systemTime, &outDate) ? outDate : 0.0;
}


// ==== 控件成员运行时（ycIDE 声明式控件成员协议后端）====
// 编译器只传 HWND（名字→HWND 解析留在生成的 main.cpp，属项目专属逻辑）；本处只依赖 HWND，与项目解耦。
// window-units.json 的属性 access.get/set 模板调用这些函数；第三方支持库照此在自己的 impl 里实现同名/自定义 helper。
// 选区/长度类属性的编辑目标：编辑框=自身；组合框=其子 Edit（不可编辑下拉式无子 Edit → NULL，属性无效，与易语言一致）
static HWND krnln_edit_target(HWND h) {
  if (!h) return NULL;
  wchar_t c[24] = L""; GetClassNameW(h, c, 24);
  if (_wcsicmp(c, L"EDIT") == 0) return h;
  if (_wcsicmp(c, L"COMBOBOX") == 0) return FindWindowExW(h, NULL, L"Edit", NULL);
  return NULL;
}

extern "C" long long krnln_ctrl_get_number(HWND h, const wchar_t* prop) {
  if (!h || !prop) return 0;
  wchar_t cls[32] = L""; GetClassNameW(h, cls, 32);
  // 通用属性（任意控件）：显隐/禁用/位置/尺寸（左边/顶边为相对父窗客户区坐标）
  if (_wcsicmp(prop, L"可视") == 0) return IsWindowVisible(h) ? 1 : 0;
  if (_wcsicmp(prop, L"禁止") == 0) return IsWindowEnabled(h) ? 0 : 1;
  if (_wcsicmp(prop, L"左边") == 0 || _wcsicmp(prop, L"顶边") == 0 || _wcsicmp(prop, L"宽度") == 0 || _wcsicmp(prop, L"高度") == 0) {
    RECT r; GetWindowRect(h, &r); POINT p = { r.left, r.top }; HWND par = GetParent(h); if (par) ScreenToClient(par, &p);
    if (_wcsicmp(prop, L"左边") == 0) return p.x;
    if (_wcsicmp(prop, L"顶边") == 0) return p.y;
    if (_wcsicmp(prop, L"宽度") == 0) return r.right - r.left;
    return r.bottom - r.top;
  }
  // 编辑框/组合框编辑部分：选区（0 基）与长度限制（易语言约定 0=不受限制；Win32 未限制时返回巨值，映射回 0）
  if (_wcsicmp(prop, L"起始选择位置") == 0 || _wcsicmp(prop, L"被选择字符数") == 0 || _wcsicmp(prop, L"最大允许长度") == 0 || _wcsicmp(prop, L"最大文本长度") == 0) {
    HWND ed = krnln_edit_target(h);
    if (!ed) return 0;
    if (_wcsicmp(prop, L"最大允许长度") == 0 || _wcsicmp(prop, L"最大文本长度") == 0) {
      long long lim = (long long)SendMessageW(ed, EM_GETLIMITTEXT, 0, 0);
      return lim >= 0x7FFFFFFE ? 0 : lim;
    }
    DWORD s = 0, e = 0; SendMessageW(ed, EM_GETSEL, (WPARAM)&s, (LPARAM)&e);
    return _wcsicmp(prop, L"起始选择位置") == 0 ? (long long)s : (long long)(e - s);
  }
  if (_wcsicmp(cls, L"BUTTON") == 0) {
    if (_wcsicmp(prop, L"选中") == 0) return SendMessageW(h, BM_GETCHECK, 0, 0) == BST_CHECKED ? 1 : 0;
    return 0;
  }
  if (_wcsicmp(cls, L"COMBOBOX") == 0 || _wcsicmp(cls, L"LISTBOX") == 0) {
    int cb = _wcsicmp(cls, L"COMBOBOX") == 0;
    if (_wcsicmp(prop, L"现行选中项") == 0) return (long long)SendMessageW(h, cb ? CB_GETCURSEL : LB_GETCURSEL, 0, 0);
    return 0;
  }
  if (_wcsicmp(cls, L"msctls_progress32") == 0) {
    if (_wcsicmp(prop, L"位置") == 0) return (long long)SendMessageW(h, PBM_GETPOS, 0, 0);
    if (_wcsicmp(prop, L"最小位置") == 0) return (long long)SendMessageW(h, PBM_GETRANGE, (WPARAM)TRUE, 0);
    if (_wcsicmp(prop, L"最大位置") == 0) return (long long)SendMessageW(h, PBM_GETRANGE, (WPARAM)FALSE, 0);
    return 0;
  }
  if (_wcsicmp(cls, L"msctls_trackbar32") == 0) {
    if (_wcsicmp(prop, L"位置") == 0) return (long long)SendMessageW(h, TBM_GETPOS, 0, 0);
    if (_wcsicmp(prop, L"最小位置") == 0) return (long long)SendMessageW(h, TBM_GETRANGEMIN, 0, 0);
    if (_wcsicmp(prop, L"最大位置") == 0) return (long long)SendMessageW(h, TBM_GETRANGEMAX, 0, 0);
    if (_wcsicmp(prop, L"页改变值") == 0) return (long long)SendMessageW(h, TBM_GETPAGESIZE, 0, 0);
    if (_wcsicmp(prop, L"行改变值") == 0) return (long long)SendMessageW(h, TBM_GETLINESIZE, 0, 0);
    return 0;
  }
  if (_wcsicmp(cls, L"SCROLLBAR") == 0) {
    SCROLLINFO si; ZeroMemory(&si, sizeof(si)); si.cbSize = sizeof(si); si.fMask = SIF_RANGE | SIF_POS;
    if (!GetScrollInfo(h, SB_CTL, &si)) return 0;
    if (_wcsicmp(prop, L"位置") == 0) return (long long)si.nPos;
    if (_wcsicmp(prop, L"最小位置") == 0) return (long long)si.nMin;
    if (_wcsicmp(prop, L"最大位置") == 0) return (long long)si.nMax;
    return 0;
  }
  if (_wcsicmp(cls, L"SysMonthCal32") == 0) {
    if (_wcsicmp(prop, L"滚动月数") == 0) return (long long)SendMessageW(h, MCM_GETMONTHDELTA, 0, 0);
    if (_wcsicmp(prop, L"最多选择天数") == 0) return (long long)SendMessageW(h, MCM_GETMAXSELCOUNT, 0, 0);
    return 0;
  }
  return 0;
}

extern "C" void krnln_ctrl_set_number(HWND h, const wchar_t* prop, long long value) {
  if (!h || !prop) return;
  int v = (int)value;
  wchar_t cls[32] = L""; GetClassNameW(h, cls, 32);
  // 通用属性（任意控件）
  if (_wcsicmp(prop, L"可视") == 0) { ShowWindow(h, v ? SW_SHOW : SW_HIDE); return; }
  if (_wcsicmp(prop, L"禁止") == 0) { EnableWindow(h, v ? FALSE : TRUE); return; }
  if (_wcsicmp(prop, L"左边") == 0 || _wcsicmp(prop, L"顶边") == 0 || _wcsicmp(prop, L"宽度") == 0 || _wcsicmp(prop, L"高度") == 0) {
    RECT r; GetWindowRect(h, &r); POINT p = { r.left, r.top }; HWND par = GetParent(h); if (par) ScreenToClient(par, &p);
    int x = p.x, y = p.y, w = r.right - r.left, ht = r.bottom - r.top;
    if (_wcsicmp(prop, L"左边") == 0) x = v; else if (_wcsicmp(prop, L"顶边") == 0) y = v; else if (_wcsicmp(prop, L"宽度") == 0) w = v; else ht = v;
    SetWindowPos(h, NULL, x, y, w, ht, SWP_NOZORDER | SWP_NOACTIVATE);
    return;
  }
  // 编辑框/组合框编辑部分：选区（易语言承 VB6 语义：置起始位置=定位光标收拢选区、-1=移到尾部；置字符数以当前起点展开、-1=全选）
  if (_wcsicmp(prop, L"起始选择位置") == 0 || _wcsicmp(prop, L"被选择字符数") == 0 || _wcsicmp(prop, L"最大允许长度") == 0 || _wcsicmp(prop, L"最大文本长度") == 0) {
    HWND ed = krnln_edit_target(h);
    if (!ed) return;
    if (_wcsicmp(prop, L"最大允许长度") == 0 || _wcsicmp(prop, L"最大文本长度") == 0) { SendMessageW(ed, EM_LIMITTEXT, (WPARAM)(v > 0 ? v : 0), 0); return; }
    if (_wcsicmp(prop, L"起始选择位置") == 0) {
      int pos = (v == -1) ? GetWindowTextLengthW(ed) : (v > 0 ? v : 0);
      SendMessageW(ed, EM_SETSEL, (WPARAM)pos, (LPARAM)pos); return;
    }
    if (v == -1) { SendMessageW(ed, EM_SETSEL, 0, (LPARAM)-1); return; }
    DWORD s = 0, e = 0; SendMessageW(ed, EM_GETSEL, (WPARAM)&s, (LPARAM)&e);
    SendMessageW(ed, EM_SETSEL, (WPARAM)s, (LPARAM)(s + (DWORD)(v > 0 ? v : 0))); return;
  }
  if (_wcsicmp(cls, L"BUTTON") == 0) {
    if (_wcsicmp(prop, L"选中") == 0) { SendMessageW(h, BM_SETCHECK, (WPARAM)(v ? BST_CHECKED : BST_UNCHECKED), 0); return; }
    return;
  }
  if (_wcsicmp(cls, L"COMBOBOX") == 0 || _wcsicmp(cls, L"LISTBOX") == 0) {
    int cb = _wcsicmp(cls, L"COMBOBOX") == 0;
    if (_wcsicmp(prop, L"现行选中项") == 0) { SendMessageW(h, cb ? CB_SETCURSEL : LB_SETCURSEL, (WPARAM)v, 0); return; }
    return;
  }
  if (_wcsicmp(cls, L"msctls_progress32") == 0) {
    if (_wcsicmp(prop, L"位置") == 0) { SendMessageW(h, PBM_SETPOS, (WPARAM)v, 0); return; }
    if (_wcsicmp(prop, L"最小位置") == 0) { int mx = (int)SendMessageW(h, PBM_GETRANGE, (WPARAM)FALSE, 0); SendMessageW(h, PBM_SETRANGE32, (WPARAM)v, (LPARAM)mx); return; }
    if (_wcsicmp(prop, L"最大位置") == 0) { int mn = (int)SendMessageW(h, PBM_GETRANGE, (WPARAM)TRUE, 0); SendMessageW(h, PBM_SETRANGE32, (WPARAM)mn, (LPARAM)v); return; }
    return;
  }
  if (_wcsicmp(cls, L"msctls_trackbar32") == 0) {
    if (_wcsicmp(prop, L"位置") == 0) { SendMessageW(h, TBM_SETPOS, (WPARAM)TRUE, (LPARAM)v); return; }
    if (_wcsicmp(prop, L"最小位置") == 0) { SendMessageW(h, TBM_SETRANGEMIN, (WPARAM)TRUE, (LPARAM)v); return; }
    if (_wcsicmp(prop, L"最大位置") == 0) { SendMessageW(h, TBM_SETRANGEMAX, (WPARAM)TRUE, (LPARAM)v); return; }
    if (_wcsicmp(prop, L"页改变值") == 0) { SendMessageW(h, TBM_SETPAGESIZE, 0, (LPARAM)v); return; }
    if (_wcsicmp(prop, L"行改变值") == 0) { SendMessageW(h, TBM_SETLINESIZE, 0, (LPARAM)v); return; }
    return;
  }
  if (_wcsicmp(cls, L"SCROLLBAR") == 0) {
    SCROLLINFO si; ZeroMemory(&si, sizeof(si)); si.cbSize = sizeof(si);
    if (_wcsicmp(prop, L"位置") == 0) { si.fMask = SIF_POS; si.nPos = v; SetScrollInfo(h, SB_CTL, &si, TRUE); return; }
    if (_wcsicmp(prop, L"最小位置") == 0 || _wcsicmp(prop, L"最大位置") == 0) { si.fMask = SIF_RANGE; GetScrollInfo(h, SB_CTL, &si); if (_wcsicmp(prop, L"最小位置") == 0) si.nMin = v; else si.nMax = v; SetScrollInfo(h, SB_CTL, &si, TRUE); return; }
    return;
  }
  if (_wcsicmp(cls, L"SysMonthCal32") == 0) {
    if (_wcsicmp(prop, L"滚动月数") == 0) { SendMessageW(h, MCM_SETMONTHDELTA, (WPARAM)v, 0); return; }
    if (_wcsicmp(prop, L"最多选择天数") == 0) { SendMessageW(h, MCM_SETMAXSELCOUNT, (WPARAM)(v > 0 ? v : 1), 0); return; }
    return;
  }
}

// 「被选择文本」：读=当前选区文本的 owned 拷贝；写=EM_REPLACESEL 替换当前选区（易语言语义）。组合框经子 Edit。
extern "C" wchar_t* krnln_ctrl_get_seltext(HWND h) {
  HWND ed = krnln_edit_target(h);
  DWORD s = 0, e = 0;
  int len = ed ? GetWindowTextLengthW(ed) : 0;
  if (ed) SendMessageW(ed, EM_GETSEL, (WPARAM)&s, (LPARAM)&e);
  if (!ed || e <= s || len <= 0) { wchar_t* z = (wchar_t*)malloc(sizeof(wchar_t)); if (z) z[0] = 0; return z; }
  wchar_t* buf = (wchar_t*)malloc((size_t)(len + 1) * sizeof(wchar_t));
  if (!buf) return nullptr;
  int got = GetWindowTextW(ed, buf, len + 1);
  if (got < 0) got = 0;
  if ((int)e > got) e = (DWORD)got;
  if ((int)s > got) s = (DWORD)got;
  int n = e > s ? (int)(e - s) : 0;
  if (n > 0) memmove(buf, buf + s, (size_t)n * sizeof(wchar_t));
  buf[n] = L'\0';
  return buf;
}
extern "C" void krnln_ctrl_set_seltext(HWND h, const wchar_t* t) {
  HWND ed = krnln_edit_target(h);
  if (!ed) return;
  SendMessageW(ed, EM_REPLACESEL, TRUE, (LPARAM)(t ? t : L""));
}

// 「加入文本」：把一个文本追加到编辑框末尾（易语言语义，多行编辑框做日志常用）。
// 先把光标移到末尾清空选区，再 EM_REPLACESEL 追加（TRUE=保留撤销）。组合框经子 Edit。
// 注：帮助文件标注该命令「最后一个参数可以被重复添加」，多值由编译器按 callEach 逐值发一次调用
// 实现（不做成变参：文本型实参是 YC_TEXT 对象，过 variadic 会 non-pod-varargs 编译错误）。
extern "C" void krnln_ctrl_append_text(HWND h, const wchar_t* t) {
  HWND ed = krnln_edit_target(h);
  if (!ed) return;
  int len = GetWindowTextLengthW(ed);
  SendMessageW(ed, EM_SETSEL, (WPARAM)len, (LPARAM)len);
  SendMessageW(ed, EM_REPLACESEL, TRUE, (LPARAM)(t ? t : L""));
}

extern "C" void krnln_ctrl_set_text(HWND h, const wchar_t* text) {
  if (!h) return;
  SetWindowTextW(h, text ? text : L"");
}

// 文本读取：返回 malloc 的独占宽串拷贝（易语言文本型「赋值即拷贝」值语义），调用方（编译器生成的包装）负责 krnln_ctrl_free_text 释放。
extern "C" wchar_t* krnln_ctrl_get_text(HWND h) {
  int len = h ? GetWindowTextLengthW(h) : 0;
  if (len < 0) len = 0;
  wchar_t* buf = (wchar_t*)malloc((size_t)(len + 1) * sizeof(wchar_t));
  if (!buf) return nullptr;
  int got = (h && len > 0) ? GetWindowTextW(h, buf, len + 1) : 0;
  if (got < 0) got = 0;
  buf[got] = L'\0';
  return buf;
}

extern "C" void krnln_ctrl_free_text(wchar_t* p) { if (p) free(p); }

// 控件「标记」(tag)：易语言的应用级 per-控件 字符串存储（非 Win32 概念），用 HWND→wstring 表；释放复用 krnln_ctrl_free_text。
static std::unordered_map<HWND, std::wstring> g_ycCtrlTags;
extern "C" void krnln_ctrl_set_tag(HWND h, const wchar_t* t) { if (h) g_ycCtrlTags[h] = (t ? t : L""); }
extern "C" wchar_t* krnln_ctrl_get_tag(HWND h) {
  const wchar_t* src = L"";
  auto it = g_ycCtrlTags.find(h);
  if (it != g_ycCtrlTags.end()) src = it->second.c_str();
  size_t n = wcslen(src);
  wchar_t* b = (wchar_t*)malloc((n + 1) * sizeof(wchar_t));
  if (!b) return nullptr;
  wcscpy(b, src);
  return b;
}

// ===== 通用对话框（CommonDlg，功能窗口组件/非可视，无 HWND）=====
// 状态按实例名存在库内（编译器在窗口创建期用 krnln_commdlg_set_* 灌入设计期属性）。
// propId 枚举与编译器侧绑定模板（window-units.json access 模板里的字面量）一一对应，勿改序号：
//   0类型(0打开文件/1保存文件/2字体选择/3打开帮助) 1标题 2文件名 3过滤器 4初始过滤器(0基)
//   5初始目录 6默认文件后缀 7创建时提示 8文件必须存在 9文件覆盖提示 10目录必须存在 11不改变目录
//   12字体颜色 13加粗 14倾斜 15删除线 16下划线 17字体名称 18字体大小(磅)
//   19帮助文件名 20帮助命令 21帮助标志值
struct YcCommDlgState {
  int style = 0;
  std::wstring caption, fileName, filter, initialDir, defExt;
  int filterIndex = 0;
  // 默认值与 window-units.json 声明的 defaultValue 保持一致（设计器未改动时不发 set 调用）
  int createPrompt = 0, fileMustExist = 0, overwritePrompt = 1, pathMustExist = 1, noChangeDir = 0;
  int fontColor = 0, fontBold = 0, fontItalic = 0, strikeOut = 0, underline = 0;
  std::wstring fontName; int fontSize = 0;
  std::wstring helpFile; int helpCommand = 0, helpContext = 0;
};
static std::unordered_map<std::wstring, YcCommDlgState> g_ycCommDlgs;
static YcCommDlgState& yc_commdlg_state(const wchar_t* name) { return g_ycCommDlgs[name ? name : L""]; }

extern "C" long long krnln_commdlg_get_int(const wchar_t* name, int propId) {
  YcCommDlgState& s = yc_commdlg_state(name);
  switch (propId) {
    case 0: return s.style;
    case 4: return s.filterIndex;
    case 7: return s.createPrompt;
    case 8: return s.fileMustExist;
    case 9: return s.overwritePrompt;
    case 10: return s.pathMustExist;
    case 11: return s.noChangeDir;
    case 12: return s.fontColor;
    case 13: return s.fontBold;
    case 14: return s.fontItalic;
    case 15: return s.strikeOut;
    case 16: return s.underline;
    case 18: return s.fontSize;
    case 20: return s.helpCommand;
    case 21: return s.helpContext;
  }
  return 0;
}

extern "C" void krnln_commdlg_set_int(const wchar_t* name, int propId, long long v) {
  YcCommDlgState& s = yc_commdlg_state(name);
  int iv = (int)v;
  switch (propId) {
    case 0: s.style = iv; break;
    case 4: s.filterIndex = iv; break;
    case 7: s.createPrompt = iv ? 1 : 0; break;
    case 8: s.fileMustExist = iv ? 1 : 0; break;
    case 9: s.overwritePrompt = iv ? 1 : 0; break;
    case 10: s.pathMustExist = iv ? 1 : 0; break;
    case 11: s.noChangeDir = iv ? 1 : 0; break;
    case 12: s.fontColor = iv; break;
    case 13: s.fontBold = iv ? 1 : 0; break;
    case 14: s.fontItalic = iv ? 1 : 0; break;
    case 15: s.strikeOut = iv ? 1 : 0; break;
    case 16: s.underline = iv ? 1 : 0; break;
    case 18: s.fontSize = iv; break;
    case 20: s.helpCommand = iv; break;
    case 21: s.helpContext = iv; break;
  }
}

static std::wstring* yc_commdlg_text_slot(YcCommDlgState& s, int propId) {
  switch (propId) {
    case 1: return &s.caption;
    case 2: return &s.fileName;
    case 3: return &s.filter;
    case 5: return &s.initialDir;
    case 6: return &s.defExt;
    case 17: return &s.fontName;
    case 19: return &s.helpFile;
  }
  return nullptr;
}

extern "C" void krnln_commdlg_set_text(const wchar_t* name, int propId, const wchar_t* v) {
  std::wstring* slot = yc_commdlg_text_slot(yc_commdlg_state(name), propId);
  if (slot) *slot = (v ? v : L"");
}

// 返回 malloc 独占拷贝，调用方（编译器生成的包装）用 krnln_ctrl_free_text 释放（同 krnln_ctrl_get_text 约定）。
extern "C" wchar_t* krnln_commdlg_get_text(const wchar_t* name, int propId) {
  std::wstring* slot = yc_commdlg_text_slot(yc_commdlg_state(name), propId);
  const wchar_t* src = slot ? slot->c_str() : L"";
  size_t n = wcslen(src);
  wchar_t* b = (wchar_t*)malloc((n + 1) * sizeof(wchar_t));
  if (!b) return nullptr;
  wcscpy(b, src);
  return b;
}

// 打开当前类型的对话框（易语言〈逻辑型〉对象．打开()）。打开/保存/字体选择：确定返回 1、取消返回 0；
// 打开帮助：打开成功返回 1。确定后把用户输入回写状态（文件名/初始过滤器/字体各属性）。
extern "C" int krnln_commdlg_open(const wchar_t* name) {
  YcCommDlgState& s = yc_commdlg_state(name);
  HWND owner = GetActiveWindow();

  if (s.style == 0 || s.style == 1) {
    // 过滤器：易语言用「显示文本|匹配符|显示文本|匹配符」竖线分隔，Win32 要求 NUL 分隔、双 NUL 结尾
    std::wstring filterBuf;
    if (!s.filter.empty()) {
      filterBuf = s.filter;
      for (auto& ch : filterBuf) { if (ch == L'|') ch = L'\0'; }
      filterBuf.push_back(L'\0');  // 末对之后再补一个 NUL（basic_string 自身携带一个隐式结尾）
    }
    wchar_t fileBuf[2048];
    size_t initLen = s.fileName.size();
    if (initLen >= 2048) initLen = 2047;
    wmemcpy(fileBuf, s.fileName.c_str(), initLen);
    fileBuf[initLen] = L'\0';

    OPENFILENAMEW ofn = {};
    ofn.lStructSize = sizeof(ofn);
    ofn.hwndOwner = owner;
    ofn.lpstrFilter = filterBuf.empty() ? nullptr : filterBuf.c_str();
    ofn.nFilterIndex = (DWORD)(s.filterIndex + 1);  // 易语言 0 基 → Win32 1 基
    ofn.lpstrFile = fileBuf;
    ofn.nMaxFile = 2048;
    ofn.lpstrInitialDir = s.initialDir.empty() ? nullptr : s.initialDir.c_str();
    ofn.lpstrTitle = s.caption.empty() ? nullptr : s.caption.c_str();
    ofn.lpstrDefExt = s.defExt.empty() ? nullptr : s.defExt.c_str();
    ofn.Flags = OFN_EXPLORER | OFN_HIDEREADONLY
      | (s.pathMustExist ? OFN_PATHMUSTEXIST : 0)
      | (s.noChangeDir ? OFN_NOCHANGEDIR : 0);
    BOOL ok;
    if (s.style == 0) {
      ofn.Flags |= (s.fileMustExist ? OFN_FILEMUSTEXIST : 0) | (s.createPrompt ? OFN_CREATEPROMPT : 0);
      ok = GetOpenFileNameW(&ofn);
    } else {
      ofn.Flags |= (s.overwritePrompt ? OFN_OVERWRITEPROMPT : 0);
      ok = GetSaveFileNameW(&ofn);
    }
    if (!ok) return 0;
    s.fileName = fileBuf;
    s.filterIndex = (int)ofn.nFilterIndex - 1;
    return 1;
  }

  if (s.style == 2) {
    LOGFONTW lf = {};
    // 帮助语义：未指定名称与大小 → 系统标准图形字体；指定了大小没指定名称 → 宋体
    const wchar_t* face = !s.fontName.empty() ? s.fontName.c_str() : (s.fontSize > 0 ? L"宋体" : L"");
    wcsncpy(lf.lfFaceName, face, LF_FACESIZE - 1);
    HDC dc = GetDC(nullptr);
    int logPixY = dc ? GetDeviceCaps(dc, LOGPIXELSY) : 96;
    if (dc) ReleaseDC(nullptr, dc);
    if (s.fontSize > 0) lf.lfHeight = -MulDiv(s.fontSize, logPixY, 72);
    lf.lfWeight = s.fontBold ? FW_BOLD : FW_NORMAL;
    lf.lfItalic = (BYTE)(s.fontItalic ? 1 : 0);
    lf.lfStrikeOut = (BYTE)(s.strikeOut ? 1 : 0);
    lf.lfUnderline = (BYTE)(s.underline ? 1 : 0);
    lf.lfCharSet = DEFAULT_CHARSET;

    CHOOSEFONTW cf = {};
    cf.lStructSize = sizeof(cf);
    cf.hwndOwner = owner;
    cf.lpLogFont = &lf;
    cf.rgbColors = (COLORREF)s.fontColor;
    cf.Flags = CF_SCREENFONTS | CF_EFFECTS | ((face[0] || s.fontSize > 0) ? CF_INITTOLOGFONTSTRUCT : 0);
    if (!ChooseFontW(&cf)) return 0;
    s.fontName = lf.lfFaceName;
    s.fontSize = cf.iPointSize / 10;  // iPointSize 单位 1/10 磅
    s.fontBold = lf.lfWeight >= FW_BOLD ? 1 : 0;
    s.fontItalic = lf.lfItalic ? 1 : 0;
    s.strikeOut = lf.lfStrikeOut ? 1 : 0;
    s.underline = lf.lfUnderline ? 1 : 0;
    s.fontColor = (int)cf.rgbColors;
    return 1;
  }

  if (s.style == 3) {
    // 未指定帮助文件 → 本程序文件名（去后缀）＋ .hlp（帮助原文语义）
    std::wstring helpPath = s.helpFile;
    if (helpPath.empty()) {
      wchar_t mod[MAX_PATH] = {};
      GetModuleFileNameW(nullptr, mod, MAX_PATH);
      helpPath = mod;
      size_t dot = helpPath.find_last_of(L'.');
      size_t sep = helpPath.find_last_of(L"\\/");
      if (dot != std::wstring::npos && (sep == std::wstring::npos || dot > sep)) helpPath.resize(dot);
      helpPath += L".hlp";
    }
    UINT cmd = HELP_FINDER;
    ULONG_PTR data = 0;
    switch (s.helpCommand) {
      case 0: cmd = HELP_FINDER; break;
      case 1: cmd = HELP_CONTEXT; data = (ULONG_PTR)s.helpContext; break;
      case 2: cmd = HELP_CONTEXTPOPUP; data = (ULONG_PTR)s.helpContext; break;
      case 3: cmd = HELP_FORCEFILE; break;
      case 4: cmd = HELP_HELPONHELP; break;
      case 5: cmd = HELP_QUIT; break;
    }
    return WinHelpW(owner, helpPath.c_str(), cmd, data) ? 1 : 0;
  }

  return 0;
}

// 日期框(SysDateTimePick32)/月历(SysMonthCal32) 日期属性运行时读写：文本「年/月/日 [时:分:秒]」<->SYSTEMTIME。
static int krnln_parse_date(const wchar_t* s, SYSTEMTIME* st) {
  if (!s || !st || !s[0]) return 0; ZeroMemory(st, sizeof(SYSTEMTIME));
  int y = 0, mo = 0, d = 0, h = 0, mi = 0, se = 0;
  int n = swscanf(s, L"%d%*[-/.]%d%*[-/.]%d %d:%d:%d", &y, &mo, &d, &h, &mi, &se);
  if (n < 3 || y < 1601 || mo < 1 || mo > 12 || d < 1 || d > 31) return 0;
  st->wYear = (WORD)y; st->wMonth = (WORD)mo; st->wDay = (WORD)d; st->wHour = (WORD)h; st->wMinute = (WORD)mi; st->wSecond = (WORD)se;
  return 1;
}
static wchar_t* krnln_fmt_date(const SYSTEMTIME* st) {
  wchar_t* b = (wchar_t*)malloc(40 * sizeof(wchar_t));
  if (!b) return nullptr;
  swprintf(b, 40, L"%04d/%02d/%02d %02d:%02d:%02d", st->wYear, st->wMonth, st->wDay, st->wHour, st->wMinute, st->wSecond);
  return b;
}
extern "C" void krnln_ctrl_set_date(HWND h, const wchar_t* prop, const wchar_t* text) {
  if (!h || !prop) return;
  SYSTEMTIME st; if (!krnln_parse_date(text, &st)) return;
  wchar_t cls[32] = L""; GetClassNameW(h, cls, 32);
  if (_wcsicmp(cls, L"SysDateTimePick32") == 0) {
    if (_wcsicmp(prop, L"今天") == 0) { SendMessageW(h, DTM_SETSYSTEMTIME, GDT_VALID, (LPARAM)&st); return; }
    if (_wcsicmp(prop, L"最小日期") == 0 || _wcsicmp(prop, L"最大日期") == 0) {
      SYSTEMTIME r[2]; ZeroMemory(r, sizeof(r)); DWORD f = (DWORD)SendMessageW(h, DTM_GETRANGE, 0, (LPARAM)r);
      if (_wcsicmp(prop, L"最小日期") == 0) { r[0] = st; f |= GDTR_MIN; } else { r[1] = st; f |= GDTR_MAX; }
      SendMessageW(h, DTM_SETRANGE, f, (LPARAM)r); return;
    }
    return;
  }
  if (_wcsicmp(cls, L"SysMonthCal32") == 0) {
    if (_wcsicmp(prop, L"今天") == 0) { SendMessageW(h, MCM_SETTODAY, 0, (LPARAM)&st); return; }
    if (_wcsicmp(prop, L"首选择日") == 0 || _wcsicmp(prop, L"尾选择日") == 0) { SendMessageW(h, MCM_SETCURSEL, 0, (LPARAM)&st); return; }
    if (_wcsicmp(prop, L"最小日期") == 0 || _wcsicmp(prop, L"最大日期") == 0) {
      SYSTEMTIME r[2]; ZeroMemory(r, sizeof(r)); DWORD f = (DWORD)SendMessageW(h, MCM_GETRANGE, 0, (LPARAM)r);
      if (_wcsicmp(prop, L"最小日期") == 0) { r[0] = st; f |= GDTR_MIN; } else { r[1] = st; f |= GDTR_MAX; }
      SendMessageW(h, MCM_SETRANGE, f, (LPARAM)r); return;
    }
    return;
  }
}
extern "C" wchar_t* krnln_ctrl_get_date(HWND h, const wchar_t* prop) {
  SYSTEMTIME st; ZeroMemory(&st, sizeof(st));
  if (h && prop) {
    wchar_t cls[32] = L""; GetClassNameW(h, cls, 32);
    if (_wcsicmp(cls, L"SysDateTimePick32") == 0 && _wcsicmp(prop, L"今天") == 0) {
      if (SendMessageW(h, DTM_GETSYSTEMTIME, 0, (LPARAM)&st) == GDT_VALID) return krnln_fmt_date(&st);
    } else if (_wcsicmp(cls, L"SysMonthCal32") == 0) {
      if (_wcsicmp(prop, L"今天") == 0) { if (SendMessageW(h, MCM_GETTODAY, 0, (LPARAM)&st)) return krnln_fmt_date(&st); }
      else if (_wcsicmp(prop, L"首选择日") == 0 || _wcsicmp(prop, L"尾选择日") == 0) { if (SendMessageW(h, MCM_GETCURSEL, 0, (LPARAM)&st)) return krnln_fmt_date(&st); }
    }
  }
  wchar_t* b = (wchar_t*)malloc(sizeof(wchar_t)); if (b) b[0] = 0; return b;
}

// ==== 组合框/列表框 项目成员方法运行时（HWND 版；运行期按类名 COMBOBOX/LISTBOX 分派 CB_*/LB_*）====
static int krnln_ll_iscombo(HWND h){ wchar_t c[24]=L""; if(h) GetClassNameW(h,c,24); return _wcsicmp(c,L"COMBOBOX")==0; }
extern "C" int krnln_ll_add_item(HWND h, const wchar_t* t, int data){ if(!h) return -1; int cb=krnln_ll_iscombo(h); int i=(int)SendMessageW(h, cb?CB_ADDSTRING:LB_ADDSTRING, 0, (LPARAM)(t?t:L"")); if(i>=0) SendMessageW(h, cb?CB_SETITEMDATA:LB_SETITEMDATA, (WPARAM)i, (LPARAM)data); return i; }
extern "C" int krnln_ll_insert_item(HWND h, int pos, const wchar_t* t, int data){ if(!h) return -1; int cb=krnln_ll_iscombo(h); int i=(int)SendMessageW(h, cb?CB_INSERTSTRING:LB_INSERTSTRING, (WPARAM)pos, (LPARAM)(t?t:L"")); if(i>=0) SendMessageW(h, cb?CB_SETITEMDATA:LB_SETITEMDATA, (WPARAM)i, (LPARAM)data); return i; }
extern "C" int krnln_ll_delete_item(HWND h, int idx){ if(!h) return 0; int cb=krnln_ll_iscombo(h); return ((int)SendMessageW(h, cb?CB_DELETESTRING:LB_DELETESTRING, (WPARAM)idx, 0) >= 0) ? 1 : 0; }
extern "C" void krnln_ll_clear(HWND h){ if(!h) return; SendMessageW(h, krnln_ll_iscombo(h)?CB_RESETCONTENT:LB_RESETCONTENT, 0, 0); }
extern "C" int krnln_ll_count(HWND h){ if(!h) return 0; return (int)SendMessageW(h, krnln_ll_iscombo(h)?CB_GETCOUNT:LB_GETCOUNT, 0, 0); }
extern "C" wchar_t* krnln_ll_get_text(HWND h, int idx){ if(!h){ wchar_t* e=(wchar_t*)malloc(sizeof(wchar_t)); if(e) e[0]=0; return e; } int cb=krnln_ll_iscombo(h); int len=(int)SendMessageW(h, cb?CB_GETLBTEXTLEN:LB_GETTEXTLEN, (WPARAM)idx, 0); if(len<0) len=0; wchar_t* b=(wchar_t*)malloc((size_t)(len+1)*sizeof(wchar_t)); if(!b) return nullptr; int got = len>0 ? (int)SendMessageW(h, cb?CB_GETLBTEXT:LB_GETTEXT, (WPARAM)idx, (LPARAM)b) : 0; if(got<0) got=0; b[got]=L'\0'; return b; }
extern "C" int krnln_ll_set_text(HWND h, int idx, const wchar_t* t){ if(!h) return 0; int cb=krnln_ll_iscombo(h); int data=(int)SendMessageW(h, cb?CB_GETITEMDATA:LB_GETITEMDATA, (WPARAM)idx, 0); SendMessageW(h, cb?CB_DELETESTRING:LB_DELETESTRING, (WPARAM)idx, 0); int ni=(int)SendMessageW(h, cb?CB_INSERTSTRING:LB_INSERTSTRING, (WPARAM)idx, (LPARAM)(t?t:L"")); if(ni>=0) SendMessageW(h, cb?CB_SETITEMDATA:LB_SETITEMDATA, (WPARAM)ni, (LPARAM)data); return ni>=0?1:0; }
extern "C" int krnln_ll_get_data(HWND h, int idx){ if(!h) return -1; return (int)SendMessageW(h, krnln_ll_iscombo(h)?CB_GETITEMDATA:LB_GETITEMDATA, (WPARAM)idx, 0); }
extern "C" int krnln_ll_set_data(HWND h, int idx, int data){ if(!h) return 0; SendMessageW(h, krnln_ll_iscombo(h)?CB_SETITEMDATA:LB_SETITEMDATA, (WPARAM)idx, (LPARAM)data); return 1; }
extern "C" int krnln_ll_get_top(HWND h){ if(!h) return -1; return (int)SendMessageW(h, krnln_ll_iscombo(h)?CB_GETTOPINDEX:LB_GETTOPINDEX, 0, 0); }
extern "C" int krnln_ll_set_top(HWND h, int idx){ if(!h) return 0; SendMessageW(h, krnln_ll_iscombo(h)?CB_SETTOPINDEX:LB_SETTOPINDEX, (WPARAM)idx, 0); return 1; }
extern "C" int krnln_ll_select(HWND h, const wchar_t* t){ if(!h) return -1; int cb=krnln_ll_iscombo(h); int i=(int)SendMessageW(h, cb?CB_FINDSTRING:LB_FINDSTRING, (WPARAM)-1, (LPARAM)(t?t:L"")); if(i>=0) SendMessageW(h, cb?CB_SETCURSEL:LB_SETCURSEL, (WPARAM)i, 0); return i; }
extern "C" int krnln_lb_sel_count(HWND h){ return h?(int)SendMessageW(h, LB_GETSELCOUNT, 0, 0):0; }
extern "C" int krnln_lb_caret(HWND h){ return h?(int)SendMessageW(h, LB_GETCARETINDEX, 0, 0):-1; }
extern "C" int krnln_lb_set_caret(HWND h, int idx){ if(!h) return 0; SendMessageW(h, LB_SETCARETINDEX, (WPARAM)idx, 0); SendMessageW(h, LB_SETCURSEL, (WPARAM)idx, 0); return 1; }
extern "C" int krnln_lb_is_selected(HWND h, int idx){ return (h && (int)SendMessageW(h, LB_GETSEL, (WPARAM)idx, 0) > 0) ? 1 : 0; }
extern "C" int krnln_lb_select_item(HWND h, int idx, int state){ if(!h) return 0; SendMessageW(h, LB_SETSEL, (WPARAM)(state?TRUE:FALSE), (LPARAM)idx); return 1; }

// --- AUTO-GENERATED KRLN STUBS BEGIN ---
// 由脚本根据 krnln.commands.ycmd.json 自动生成：补齐未实现导出函数，避免链接缺符号。
// 注意：以下为默认桩实现，后续应按命令语义逐步替换为真实实现。

extern "C" void krnln_ife(...) { touchNonStub(); }

extern "C" void krnln_if(...) { touchNonStub(); }

extern "C" void krnln_switch(...) { touchNonStub(); }

extern "C" void krnln_while(...) { touchNonStub(); }

extern "C" void krnln_counter(...) { touchNonStub(); }

extern "C" void krnln_for(...) { touchNonStub(); }

extern "C" void krnln_continue(...) { touchNonStub(); }

extern "C" void krnln_break(...) { touchNonStub(); }

extern "C" void krnln_return(...) { touchNonStub(); }

extern "C" void krnln_end(...) { touchNonStub(); }

extern "C" long long krnln_add(long long a, long long b) {
  return a + b;
}

extern "C" double krnln_sub(double a, double b) {
  return clampFinite(a - b);
}

extern "C" double krnln_mul(double a, double b) {
  return clampFinite(a * b);
}

extern "C" double krnln_div(double a, double b) {
  if (b == 0.0) return 0.0;
  return clampFinite(a / b);
}

extern "C" void krnln_else(...) { touchNonStub(); }

extern "C" void krnln_default(...) { touchNonStub(); }

extern "C" void krnln_endife(...) { touchNonStub(); }

extern "C" void krnln_endif(...) { touchNonStub(); }

extern "C" void krnln_endswitch(...) { touchNonStub(); }

extern "C" void krnln_wend(...) { touchNonStub(); }

extern "C" void krnln_DoWhile(...) { touchNonStub(); }

extern "C" void krnln_loop(...) { touchNonStub(); }

extern "C" void krnln_CounterLoop(...) { touchNonStub(); }

extern "C" void krnln_next(...) { touchNonStub(); }

// 输出调试文本：写 stdout（IDE 运行时捕获子进程管道显示到输出面板）+ 系统调试器通道
extern "C" void krnln_OutputDebugText(const char* text) {
  touchNonStub();
  const char* s = text ? text : "";
  fputs(s, stdout);
  fputc('\n', stdout);
  fflush(stdout);
  std::wstring wide = utf8ToWide(s);
  OutputDebugStringW(wide.c_str());
  OutputDebugStringW(L"\r\n");
}

extern "C" void krnln_stop(...) { touchNonStub(); }

extern "C" void krnln_assert(...) { touchNonStub(); }

extern "C" int krnln_IsDebugVer(...) {
#ifdef _DEBUG
  return 1;
#else
  return 0;
#endif
}

// 寻找文件：首参非空=开新一轮（FindFirstFile），首参空/省略=续查上一轮（FindNextFile），
// 找完返回空文本并收句柄——帮助语义就是这样一轮多次调用迭代目录。
// 属性过滤照易语言实测：文件的特殊属性（只读1/隐藏2/系统4/子目录16/存档32）必须是请求掩码的
// 子集才算命中——显式 0 只命中「无任何特殊属性」的普通文件（连存档文件都不算，易语言原版如此）；
// 省略属性参数（转译器发 -1 哨兵）＝除子目录外所有文件（1|2|4|32）。
static HANDLE g_dirFindHandle = INVALID_HANDLE_VALUE;
static int g_dirFindMask = 0;

static bool dirAttrsMatch(DWORD attrs, int mask) {
  const DWORD special = FILE_ATTRIBUTE_READONLY | FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM |
                        FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_ARCHIVE;
  DWORD want = 0;
  if (mask & 1) want |= FILE_ATTRIBUTE_READONLY;
  if (mask & 2) want |= FILE_ATTRIBUTE_HIDDEN;
  if (mask & 4) want |= FILE_ATTRIBUTE_SYSTEM;
  if (mask & 16) want |= FILE_ATTRIBUTE_DIRECTORY;
  if (mask & 32) want |= FILE_ATTRIBUTE_ARCHIVE;
  return (attrs & special & ~want) == 0;
}

extern "C" const char* krnln_dir(const char* fileOrDirName, int attributes) {
  std::wstring pattern = utf8ToWide(fileOrDirName ? fileOrDirName : "");
  WIN32_FIND_DATAW findData{};

  if (!pattern.empty()) {
    if (g_dirFindHandle != INVALID_HANDLE_VALUE) { FindClose(g_dirFindHandle); g_dirFindHandle = INVALID_HANDLE_VALUE; }
    g_dirFindMask = attributes < 0 ? (1 | 2 | 4 | 32) : attributes;
    HANDLE h = FindFirstFileW(pattern.c_str(), &findData);
    if (h == INVALID_HANDLE_VALUE) return keepUtf8("");
    g_dirFindHandle = h;
    if (dirAttrsMatch(findData.dwFileAttributes, g_dirFindMask)) return keepWideAsUtf8(findData.cFileName);
  } else if (g_dirFindHandle == INVALID_HANDLE_VALUE) {
    return keepUtf8("");
  }

  while (FindNextFileW(g_dirFindHandle, &findData)) {
    if (dirAttrsMatch(findData.dwFileAttributes, g_dirFindMask)) return keepWideAsUtf8(findData.cFileName);
  }
  FindClose(g_dirFindHandle);
  g_dirFindHandle = INVALID_HANDLE_VALUE;
  return keepUtf8("");
}

// ========================= 字节集 ABI v2 =========================
// 字节集（YC_BIN = std::vector<unsigned char>）跨 ABI 一律按**指针**传：
//   · 入参  const void* = const YC_BIN*（生成侧发 (const void*)&yc_bin_tmp(…)；实参省略 → nullptr）
//   · 返回  void*       = 堆上 new YC_BIN（生成侧 yc_bin_take 接管：移走内容后 delete）
// 【为什么换】旧法是 const char*、长度靠 NUL 结尾（yc_bin_to_cstr 返回 c_str()、
// yc_cstr_to_bin/krnln_BinLen 按 strlen 算）——可字节集本就是任意二进制，含 0x00 即被整条截断，
// 于是「读入文件→取字节集长度」这类最基本的用法在二进制文件上全是错的。
// 新法复用数组那套既有的跨 TU vector 指针契约（krnln_AddElement 等早就在用），不引入新假设。
typedef std::vector<unsigned char> YcBin;

/** 入参还原；nullptr（实参省略）→ 空字节集 */
static const YcBin& ycBinArg(const void* p) {
  static const YcBin kEmpty;
  return p ? *reinterpret_cast<const YcBin*>(p) : kEmpty;
}
/** 交回堆上的字节集，所有权转给调用处的 yc_bin_take */
static void* ycBinRet(YcBin b) { return new YcBin(std::move(b)); }
/** UTF-8 文本 → 字节集（到字节集/文本到UTF8 等：通用型/文本型经通用编组到达时已是 UTF-8） */
static YcBin ycBinFromUtf8(const char* s) {
  const char* p = s ? s : "";
  return YcBin(reinterpret_cast<const unsigned char*>(p), reinterpret_cast<const unsigned char*>(p) + std::strlen(p));
}
/** 正向找子字节集：返回 0 基下标，找不到 -1 */
static long ycBinFind(const YcBin& hay, const YcBin& needle, size_t from) {
  if (needle.empty() || from > hay.size() || needle.size() > hay.size() - from) return -1;
  auto it = std::search(hay.begin() + static_cast<long>(from), hay.end(), needle.begin(), needle.end());
  return it == hay.end() ? -1 : static_cast<long>(it - hay.begin());
}
/** 反向找：在「起始下标 ≤ upto」的范围内取最后一次出现（同 std::string::rfind 语义） */
static long ycBinRFind(const YcBin& hay, const YcBin& needle, size_t upto) {
  if (needle.empty() || needle.size() > hay.size()) return -1;
  size_t last = std::min(upto, hay.size() - needle.size());
  for (size_t i = last + 1; i-- > 0;) {
    if (std::equal(needle.begin(), needle.end(), hay.begin() + static_cast<long>(i))) return static_cast<long>(i);
  }
  return -1;
}

extern "C" int krnln_BinLen(const void* binData) {
  return static_cast<int>(ycBinArg(binData).size());
}

extern "C" void* krnln_ToBin(const char* anyData) {
  return ycBinRet(ycBinFromUtf8(anyData));
}

extern "C" void* krnln_BinLeft(const void* binData, int count) {
  const YcBin& s = ycBinArg(binData);
  if (count <= 0) return ycBinRet(YcBin());
  if (static_cast<size_t>(count) >= s.size()) return ycBinRet(s);
  return ycBinRet(YcBin(s.begin(), s.begin() + count));
}

extern "C" void* krnln_BinRight(const void* binData, int count) {
  const YcBin& s = ycBinArg(binData);
  if (count <= 0) return ycBinRet(YcBin());
  if (static_cast<size_t>(count) >= s.size()) return ycBinRet(s);
  return ycBinRet(YcBin(s.end() - count, s.end()));
}

extern "C" void* krnln_BinMid(const void* binData, int startPos, int count) {
  const YcBin& s = ycBinArg(binData);
  if (count <= 0) return ycBinRet(YcBin());
  if (startPos < 1) startPos = 1;
  size_t start = static_cast<size_t>(startPos - 1);
  if (start >= s.size()) return ycBinRet(YcBin());
  size_t n = std::min(static_cast<size_t>(count), s.size() - start);
  return ycBinRet(YcBin(s.begin() + static_cast<long>(start), s.begin() + static_cast<long>(start + n)));
}

extern "C" int krnln_InBin(const void* sourceBin, const void* findBin, int startPos) {
  const YcBin& source = ycBinArg(sourceBin);
  const YcBin& find = ycBinArg(findBin);
  if (find.empty()) return 1;
  if (startPos < 1) startPos = 1;
  size_t start = static_cast<size_t>(startPos - 1);
  if (start >= source.size()) return -1;
  long found = ycBinFind(source, find, start);
  return found < 0 ? -1 : static_cast<int>(found + 1);
}

extern "C" int krnln_InBinRev(const void* sourceBin, const void* findBin, int startPos) {
  const YcBin& source = ycBinArg(sourceBin);
  const YcBin& find = ycBinArg(findBin);
  if (source.empty()) return -1;
  if (find.empty()) return static_cast<int>(source.size());

  size_t start = source.size() - 1;
  if (startPos >= 1 && static_cast<size_t>(startPos) <= source.size()) {
    start = static_cast<size_t>(startPos - 1);
  }
  long found = ycBinRFind(source, find, start);
  return found < 0 ? -1 : static_cast<int>(found + 1);
}

extern "C" void* krnln_RpBin(const void* sourceBin, int startPos, int replaceLen, const void* replacementBin) {
  YcBin out = ycBinArg(sourceBin);
  const YcBin& rep = ycBinArg(replacementBin);
  if (startPos < 1) startPos = 1;
  size_t start = static_cast<size_t>(startPos - 1);
  if (start > out.size()) start = out.size();
  if (replaceLen < 0) replaceLen = 0;
  size_t eraseLen = std::min(static_cast<size_t>(replaceLen), out.size() - start);
  out.erase(out.begin() + static_cast<long>(start), out.begin() + static_cast<long>(start + eraseLen));
  out.insert(out.begin() + static_cast<long>(start), rep.begin(), rep.end());
  return ycBinRet(std::move(out));
}

extern "C" void* krnln_RpSubBin(const void* sourceBin,
                                const void* oldSubBin,
                                const void* newSubBin,
                                int startPos,
                                int replaceCount) {
  YcBin out = ycBinArg(sourceBin);
  const YcBin& oldValue = ycBinArg(oldSubBin);
  const YcBin& newValue = ycBinArg(newSubBin);
  if (oldValue.empty()) return ycBinRet(std::move(out));

  if (startPos < 1) startPos = 1;
  size_t cursor = static_cast<size_t>(startPos - 1);
  if (cursor >= out.size()) return ycBinRet(std::move(out));

  int maxReplace = replaceCount;
  if (maxReplace <= 0) maxReplace = std::numeric_limits<int>::max();

  int replaced = 0;
  while (replaced < maxReplace) {
    long found = ycBinFind(out, oldValue, cursor);
    if (found < 0) break;
    out.erase(out.begin() + found, out.begin() + found + static_cast<long>(oldValue.size()));
    out.insert(out.begin() + found, newValue.begin(), newValue.end());
    cursor = static_cast<size_t>(found) + newValue.size();
    ++replaced;
  }

  return ycBinRet(std::move(out));
}

extern "C" void* krnln_SpaceBin(int zeroCount) {
  if (zeroCount <= 0) return ycBinRet(YcBin());
  return ycBinRet(YcBin(static_cast<size_t>(zeroCount), 0));   // 真的 zeroCount 个 0 字节（旧 ABI 下会被当空串）
}

extern "C" void* krnln_bin(int repeatCount, const void* unitBin) {
  const YcBin& unit = ycBinArg(unitBin);
  if (repeatCount <= 0 || unit.empty()) return ycBinRet(YcBin());
  YcBin out;
  out.reserve(unit.size() * static_cast<size_t>(repeatCount));
  for (int i = 0; i < repeatCount; ++i) out.insert(out.end(), unit.begin(), unit.end());
  return ycBinRet(std::move(out));
}

// 指针到* 家族的可读性防护：地址不可读时返回零值/空，而不是让整个程序崩掉。
// 典型踩法：x64 下地址是 64 位（取变量地址 返回 长整数型），从 32 位易语言移植的代码用
// 整数型 变量接地址 → 截断成垃圾指针。逐内存区域查 MEM_COMMIT + 可读保护位。
static bool ycMemReadable(const void* p, size_t len) {
  if (!p) return false;
  const unsigned char* cur = static_cast<const unsigned char*>(p);
  const unsigned char* end = cur + (len ? len : 1);
  while (cur < end) {
    MEMORY_BASIC_INFORMATION mbi{};
    if (VirtualQuery(cur, &mbi, sizeof(mbi)) == 0) return false;
    if (mbi.State != MEM_COMMIT) return false;
    if (mbi.Protect & (PAGE_GUARD | PAGE_NOACCESS)) return false;
    const DWORD readable = PAGE_READONLY | PAGE_READWRITE | PAGE_WRITECOPY |
                           PAGE_EXECUTE_READ | PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY;
    if (!(mbi.Protect & readable)) return false;
    cur = static_cast<const unsigned char*>(mbi.BaseAddress) + mbi.RegionSize;
  }
  return true;
}

extern "C" void* krnln_pbin(long long dataPtr, int dataLen) {
  if (dataPtr == 0 || dataLen <= 0) return ycBinRet(YcBin());
  const unsigned char* ptr = reinterpret_cast<const unsigned char*>(static_cast<intptr_t>(dataPtr));
  if (!ycMemReadable(ptr, static_cast<size_t>(dataLen))) return ycBinRet(YcBin());
  return ycBinRet(YcBin(ptr, ptr + static_cast<size_t>(dataLen)));   // 内存块原样收，0 字节不再截断
}

extern "C" int krnln_p2int(long long dataPtr) {
  if (dataPtr == 0) return 0;
  const int* ptr = reinterpret_cast<const int*>(static_cast<intptr_t>(dataPtr));
  if (!ycMemReadable(ptr, sizeof(int))) return 0;
  return *ptr;
}

extern "C" long long krnln_p2int64(long long dataPtr) {
  if (dataPtr == 0) return 0;
  const long long* ptr = reinterpret_cast<const long long*>(static_cast<intptr_t>(dataPtr));
  if (!ycMemReadable(ptr, sizeof(long long))) return 0;
  return *ptr;
}

extern "C" float krnln_p2float(long long dataPtr) {
  if (dataPtr == 0) return 0.0f;
  const float* ptr = reinterpret_cast<const float*>(static_cast<intptr_t>(dataPtr));
  if (!ycMemReadable(ptr, sizeof(float))) return 0.0f;
  return *ptr;
}

extern "C" double krnln_p2double(long long dataPtr) {
  if (dataPtr == 0) return 0.0;
  const double* ptr = reinterpret_cast<const double*>(static_cast<intptr_t>(dataPtr));
  if (!ycMemReadable(ptr, sizeof(double))) return 0.0;
  return *ptr;
}

extern "C" int krnln_GetIntInsideBin(const void* binData, int offset, int reverseBytes) {
  const YcBin& s = ycBinArg(binData);
  if (offset < 0) return 0;

  size_t start = static_cast<size_t>(offset);
  if (start + sizeof(int) > s.size()) return 0;

  unsigned char bytes[sizeof(int)]{};
  std::memcpy(bytes, s.data() + start, sizeof(int));

  if (reverseBytes) {
    std::reverse(bytes, bytes + sizeof(int));
  }

  int value = 0;
  std::memcpy(&value, bytes, sizeof(int));
  return value;
}

// 置字节集内整数〈无返回值〉——**就地改写**入参，故收非 const YC_BIN*（生成侧按 binref 绑到用户变量本身，
// 见 YCMD_ARRAY_PARAM_KINDS['krnln_SetIntInsideBin']）。旧法收 char*，而调用方交的是
// yc_bin_to_cstr 轮转槽里的临时副本 —— 写进去就丢，这条命令此前是**彻底的空操作**。
// 另：旧法 memcpy(binData + offset, …) **没有任何边界检查**，offset 靠近末尾即缓冲区溢出。
extern "C" void krnln_SetIntInsideBin(void* binData, int offset, int value, int reverseBytes) {
  if (!binData || offset < 0) return;
  YcBin& s = *reinterpret_cast<YcBin*>(binData);
  if (static_cast<size_t>(offset) + sizeof(int) > s.size()) return;   // 越界即不写（旧法在这里溢出）

  unsigned char bytes[sizeof(int)]{};
  std::memcpy(bytes, &value, sizeof(int));
  if (reverseBytes) {
    std::reverse(bytes, bytes + sizeof(int));
  }
  std::memcpy(s.data() + static_cast<size_t>(offset), bytes, sizeof(int));
}

extern "C" void* krnln_ReadFile(const char* fileName) {
  if (!fileName || !*fileName) return ycBinRet(YcBin());

  // 路径是 UTF-8：经宽字符 path 打开，否则中文路径按 ANSI 解释打不开（与 打开文件 同族坑）
  std::ifstream in(std::filesystem::path(utf8ToWide(fileName)), std::ios::binary);
  if (!in) return ycBinRet(YcBin());

  // 二进制原样读入（旧法经 const char* 交回，遇文件里第一个 0x00 就整条截断——
  // 读任何真正的二进制文件都是错的）
  YcBin data((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
  return ycBinRet(std::move(data));
}

extern "C" int krnln_WriteFile(const char* fileName, const void* binData) {
  if (!fileName || !*fileName) return 0;

  // 路径是 UTF-8：经宽字符 path 打开（同 krnln_ReadFile）
  std::ofstream out(std::filesystem::path(utf8ToWide(fileName)), std::ios::binary | std::ios::trunc);
  if (!out) return 0;

  // 原样写出（旧法按 strlen 取长度 → 写二进制时在第一个 0x00 处就截断了）
  const YcBin& b = ycBinArg(binData);
  if (!b.empty()) out.write(reinterpret_cast<const char*>(b.data()), static_cast<std::streamsize>(b.size()));
  return out.good() ? 1 : 0;
}

// ============ 「按引用操作变量」族（赋值 / 连续赋值 / 交换变量 / 强制交换变量）============
// 帮助里这族的参数写作「通用型变量/变量数组」（vs 值参的「通用型数组/非数组」）——按引用语义。
// 裸 void* 没有类型信息，通用型赋值/交换就没法做对；故转译期把「变量地址 + 类型标签」一起交来
// （标签由生成侧的 yc_vt_of(变量) 经 C++ 重载解析得出，与下面这组常量一一对应）。
//
// 旧实现是 `*(uintptr_t*)目标 = (uintptr_t)值指针`——把指针值当数据写；而通用编组交给它的
// 还是**值的文本形态**、连地址都不是。两头都错，这族命令此前全是坏的。
//
// 【为什么 krnln 不必认识 YC_TEXT】YC_TEXT 是 `struct { std::wstring s; …只有成员函数 }`：
// 单数据成员、无虚函数、无基类 → 标准布局，对象地址即首成员地址，按 std::wstring* 处理即可。
// 与 YcBin(= std::vector<unsigned char>) 是同一类布局假设，不新增耦合、不用同步第三份结构定义。
#define YC_VT_INT    1
#define YC_VT_INT64  2
#define YC_VT_SHORT  3
#define YC_VT_BYTE   4
#define YC_VT_FLOAT  5
#define YC_VT_DOUBLE 6
#define YC_VT_TEXT   7
#define YC_VT_BIN    8
#define YC_VT_ARY    9
// 逻辑型必须有独立标签：变量侧是 1 字节 bool（mapTypeToVarCType），yc_vt_of 缺 bool 重载时
// 经整型提升落到 int 重载 → 按 4 字节读写 1 字节对象（UBSan misaligned 崩溃 + 写侧踩邻近内存）。
#define YC_VT_BOOL   10

extern "C" void krnln_set(void* target, const void* value, int dataType) {
  if (!target || !value) return;
  switch (dataType) {
    case YC_VT_BOOL:   *reinterpret_cast<bool*>(target) = *reinterpret_cast<const bool*>(value); break;
    case YC_VT_INT:    *reinterpret_cast<int*>(target) = *reinterpret_cast<const int*>(value); break;
    case YC_VT_INT64:  *reinterpret_cast<long long*>(target) = *reinterpret_cast<const long long*>(value); break;
    case YC_VT_SHORT:  *reinterpret_cast<short*>(target) = *reinterpret_cast<const short*>(value); break;
    case YC_VT_BYTE:   *reinterpret_cast<unsigned char*>(target) = *reinterpret_cast<const unsigned char*>(value); break;
    case YC_VT_FLOAT:  *reinterpret_cast<float*>(target) = *reinterpret_cast<const float*>(value); break;
    case YC_VT_DOUBLE: *reinterpret_cast<double*>(target) = *reinterpret_cast<const double*>(value); break;
    case YC_VT_TEXT:   *reinterpret_cast<std::wstring*>(target) = *reinterpret_cast<const std::wstring*>(value); break;
    case YC_VT_BIN:    *reinterpret_cast<YcBin*>(target) = *reinterpret_cast<const YcBin*>(value); break;
    case YC_VT_ARY:    *reinterpret_cast<std::vector<long long>*>(target) = *reinterpret_cast<const std::vector<long long>*>(value); break;
    default: break;
  }
}

// 连续赋值(值, 变量1, 变量2…)：帮助里值在前、变量在后（与 赋值 相反），尾参可重复；
// 转译期按目标逐个展开成一次调用，各目标可以是不同类型。
extern "C" void krnln_store(const void* value, void* target, int dataType) {
  krnln_set(target, value, dataType);
}

// ============ 多维数组维度登记表 ============
// 键=vector 对象地址（数组变量按引用跨 TU 传递，地址在其生命周期内稳定）。局部数组析构不专门清表：
// 每次读取先校验「维度乘积==当前成员数」，失配即弃用并清除该项——这同时挡下两类脏数据：
// ① 地址复用继承到的旧维度（同址且乘积恰好相同的碰撞按同形状对待，读写不越界、无实害）；
// ② 加入/插入/删除成员改变了成员数 → 乘积失配 → 数组自动退化为一维（这些命令本就按成员顺序号操作）。
static std::unordered_map<const void*, std::vector<long long>> g_ycAryDims;
static bool yc_ary_dims_fetch(const void* arrayVar, std::vector<long long>& out) {
  auto it = g_ycAryDims.find(arrayVar);
  if (it == g_ycAryDims.end()) return false;
  auto* arr = reinterpret_cast<const std::vector<long long>*>(arrayVar);
  long long total = 1;
  for (long long d : it->second) total *= d;
  if (total != static_cast<long long>(arr->size())) {
    g_ycAryDims.erase(it);
    return false;
  }
  out = it->second;
  return true;
}

// 重定义数组(数组, 保留, 维1, 维2…)：各维上限值即该维成员数（易语言语义：重定义数组(a,假,5) → 5 个成员，
// 不是 0..5 共 6 个），多维成员总数=各维乘积、行主序扁平存储，维度进登记表供 取数组下标/链式下标折算。
extern "C" void krnln_ReDimEx(void* arrayVar, int keepOld, const long long* dims, int dimCount) {
  if (!arrayVar || !dims || dimCount <= 0) return;
  long long total = 1;
  for (int i = 0; i < dimCount; i++) {
    if (dims[i] <= 0) { total = 0; break; }
    total *= dims[i];
  }
  auto* arr = reinterpret_cast<std::vector<long long>*>(arrayVar);
  if (keepOld) arr->resize(static_cast<size_t>(total), 0);
  else arr->assign(static_cast<size_t>(total), 0);
  if (dimCount > 1 && total > 0) g_ycAryDims[arrayVar] = std::vector<long long>(dims, dims + dimCount);
  else g_ycAryDims.erase(arrayVar);
}

// 旧一维形态（兼容既有转译缓存产物；此前实现按 上限+1 多分配了一个成员，已按易语言对齐）。
extern "C" void krnln_ReDim(void* arrayVar, int keepOld, int upperBound) {
  if (upperBound < 0) return;
  long long d = upperBound;
  krnln_ReDimEx(arrayVar, keepOld, &d, 1);
}

// 静态声明多维数组（如 .局部变量 矩阵, 整数型, , "3,4"）的维度登记：转译器在声明语句后发出。
extern "C" void krnln_AryRegDims(void* arrayVar, const long long* dims, int dimCount) {
  if (!arrayVar || !dims || dimCount <= 1) return;
  g_ycAryDims[arrayVar] = std::vector<long long>(dims, dims + dimCount);
}

// 多维链式下标 → 一基线性下标（行主序）。维度未知（一维/已退化）或组数与维数不符时，按首个下标当线性下标。
extern "C" long long krnln_AryLinIdx(void* arrayVar, const long long* idx, int n) {
  if (!arrayVar || !idx || n <= 0) return 0;
  std::vector<long long> dims;
  if (!yc_ary_dims_fetch(arrayVar, dims) || static_cast<int>(dims.size()) != n) return idx[0];
  long long lin = 0;
  for (int i = 0; i < n; i++) {
    long long stride = 1;
    for (size_t d = static_cast<size_t>(i) + 1; d < dims.size(); d++) stride *= dims[d];
    lin += (i == n - 1) ? idx[i] : (idx[i] - 1) * stride;
  }
  return lin;
}

extern "C" int krnln_GetAryElementCount(void* arrayVar) {
  if (!arrayVar) return 0;
  auto* arr = reinterpret_cast<std::vector<long long>*>(arrayVar);
  return static_cast<int>(arr->size());
}

// 取数组下标(数组, 维)：易语言返回该维的成员数（如 重定义数组(a,假,6) 后 取数组下标(a,1)=6）。
// 多维查登记表；一维=成员总数（加入成员后随成员数增长）；维序号超界返回 0。
extern "C" int krnln_UBound(void* arrayVar, int dimension) {
  if (!arrayVar) return 0;
  if (dimension < 1) dimension = 1;
  std::vector<long long> dims;
  if (yc_ary_dims_fetch(arrayVar, dims) && dims.size() >= 2) {
    if (dimension > static_cast<int>(dims.size())) return 0;
    return static_cast<int>(dims[static_cast<size_t>(dimension) - 1]);
  }
  if (dimension > 1) return 0;
  return krnln_GetAryElementCount(arrayVar);
}

extern "C" void krnln_CopyAry(void* dstArrayVar, void* srcArrayVar) {
  if (!dstArrayVar || !srcArrayVar) return;
  auto* dst = reinterpret_cast<std::vector<long long>*>(dstArrayVar);
  auto* src = reinterpret_cast<std::vector<long long>*>(srcArrayVar);
  *dst = *src;
  // 维度随数据一起复制（源无多维登记则目标也清除，保持一致）
  std::vector<long long> dims;
  if (yc_ary_dims_fetch(srcArrayVar, dims) && dims.size() >= 2) g_ycAryDims[dstArrayVar] = dims;
  else g_ycAryDims.erase(dstArrayVar);
}

extern "C" void krnln_AddElement(void* arrayVar, long long value) {
  if (!arrayVar) return;
  auto* arr = reinterpret_cast<std::vector<long long>*>(arrayVar);
  arr->push_back(value);
}

// 插入成员(数组, 位置, 值)：「欲插入的位置」为一基（易语言：插入成员(a,3,x) 把 x 插成第 3 个成员）。
// 此前按 0 基处理，插到了后一位。位置越界钳位到首/尾。
extern "C" void krnln_InsElement(void* arrayVar, int index, long long value) {
  if (!arrayVar) return;
  auto* arr = reinterpret_cast<std::vector<long long>*>(arrayVar);
  int pos0 = index - 1;
  if (pos0 < 0) pos0 = 0;
  if (static_cast<size_t>(pos0) > arr->size()) pos0 = static_cast<int>(arr->size());
  arr->insert(arr->begin() + pos0, value);
}

// 删除成员(数组, 位置, 数目)：「欲删除的位置」为一基（易语言：删除成员(a,3,1) 删第 3 个成员）。
extern "C" int krnln_RemoveElement(void* arrayVar, int index, int removeCount) {
  if (!arrayVar) return 0;
  auto* arr = reinterpret_cast<std::vector<long long>*>(arrayVar);
  int pos0 = index - 1;
  if (pos0 < 0 || static_cast<size_t>(pos0) >= arr->size()) return 0;
  if (removeCount <= 0) removeCount = 1;

  size_t begin = static_cast<size_t>(pos0);
  size_t end = std::min(arr->size(), begin + static_cast<size_t>(removeCount));
  arr->erase(arr->begin() + begin, arr->begin() + end);
  return 1;
}

extern "C" void krnln_RemoveAll(void* arrayVar) {
  if (!arrayVar) return;
  auto* arr = reinterpret_cast<std::vector<long long>*>(arrayVar);
  arr->clear();
}

extern "C" void krnln_SortAry(void* arrayVar, int asc) {
  if (!arrayVar) return;
  auto* arr = reinterpret_cast<std::vector<long long>*>(arrayVar);
  if (asc) {
    std::sort(arr->begin(), arr->end());
  } else {
    std::sort(arr->begin(), arr->end(), std::greater<long long>());
  }
}

extern "C" void krnln_ZeroAry(void* arrayVar) {
  if (!arrayVar) return;
  auto* arr = reinterpret_cast<std::vector<long long>*>(arrayVar);
  std::fill(arr->begin(), arr->end(), 0);
}

extern "C" const char* krnln_QJCase(const char* text) {
  std::wstring in = utf8ToWide(text ? text : "");
  std::wstring out;
  out.reserve(in.size());
  for (wchar_t ch : in) {
    if (ch == L' ') {
      out.push_back(0x3000);
    } else if (ch >= 0x21 && ch <= 0x7E) {
      out.push_back(static_cast<wchar_t>(ch + 0xFEE0));
    } else {
      out.push_back(ch);
    }
  }
  return keepWideAsUtf8(out);
}

extern "C" const char* krnln_BJCase(const char* text) {
  std::wstring in = utf8ToWide(text ? text : "");
  std::wstring out;
  out.reserve(in.size());
  for (wchar_t ch : in) {
    if (ch == 0x3000) {
      out.push_back(L' ');
    } else if (ch >= 0xFF01 && ch <= 0xFF5E) {
      out.push_back(static_cast<wchar_t>(ch - 0xFEE0));
    } else {
      out.push_back(ch);
    }
  }
  return keepWideAsUtf8(out);
}

extern "C" const char* krnln_str(const char* value) {
  return keepUtf8(value ? value : "");
}

extern "C" const char* krnln_RpSubText(const char* text,
                                        const char* oldSub,
                                        const char* newSub,
                                        int startPos,
                                        int replaceCount,
                                        int caseSensitive) {
  std::string src = text ? text : "";
  std::string needle = oldSub ? oldSub : "";
  std::string repl = newSub ? newSub : "";

  if (needle.empty()) return keepUtf8(src);
  size_t pos = startPos > 0 ? static_cast<size_t>(startPos - 1) : 0;
  if (pos > src.size()) return keepUtf8(src);

  auto findNext = [&](size_t from) -> size_t {
    if (caseSensitive) return src.find(needle, from);

    std::string srcLower = src;
    std::string needleLower = needle;
    std::transform(srcLower.begin(), srcLower.end(), srcLower.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    std::transform(needleLower.begin(), needleLower.end(), needleLower.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return srcLower.find(needleLower, from);
  };

  int replaced = 0;
  while (pos <= src.size()) {
    size_t at = findNext(pos);
    if (at == std::string::npos) break;

    src.replace(at, needle.size(), repl);
    pos = at + repl.size();
    ++replaced;
    if (replaceCount > 0 && replaced >= replaceCount) break;
  }

  return keepUtf8(src);
}

extern "C" const char* krnln_space(int count) {
  if (count <= 0) return keepUtf8("");
  return keepUtf8(std::string(static_cast<size_t>(count), ' '));
}

extern "C" const char* krnln_string(int count, const char* value) {
  if (count <= 0) return keepUtf8("");
  std::string s = value ? value : "";
  if (s.empty()) return keepUtf8("");

  std::string out;
  out.reserve(static_cast<size_t>(count) * s.size());
  for (int i = 0; i < count; ++i) {
    out += s;
  }
  return keepUtf8(out);
}

// ============================ 数组返回 ABI ============================
// 运行时数组统一是 std::vector<long long>（与 krnln_AddElement/krnln_CopyAry 等收 void* 的既定契约
// 同一个）。「返回数组」的命令在堆上 new 一个填好的 vector 并以 void* 交回，调用处生成的
// yc_ary_take 接管所有权（移走内容后 delete）——impl 只管 new，不管回收。
// 文本元素存「堆上宽串的指针位模式」，与生成侧 yc_ary_lit_text 的存法、
// ((wchar_t*)(intptr_t)元素) 的读法一致；元素串本身不回收（同 yc_ary_lit_text，全程序生命期）。
static void* ycMakeTextArray(const std::vector<std::wstring>& items) {
  auto* out = new std::vector<long long>();
  out->reserve(items.size());
  for (const std::wstring& s : items) {
    wchar_t* p = new wchar_t[s.size() + 1];
    wmemcpy(p, s.c_str(), s.size() + 1);
    out->push_back(static_cast<long long>(reinterpret_cast<intptr_t>(p)));
  }
  return out;
}

// 分割文本〈文本型数组〉（文本型 待分割文本，［文本型 用作分割的文本］，［整数型 要返回的子文本数目］）
// 帮助语义（逐条对齐）：
//  · 待分割文本为空 → 返回空数组（没有任何成员）
//  · 用作分割的文本「省略」→ 默认半角逗号；「显式空文本」→ 不分割、整段作唯一成员
//    （两者转译期就已区分：省略发 nullptr、显式空文本发 ""；见 YCMD_NULL_WHEN_OMITTED_PARAMS）
//  · 要返回的子文本数目 省略/≤0 → 全部；给 n>0 → 最多 n 段，末段为剩余全文（含其中的分隔符）
extern "C" void* krnln_split(const char* text, const char* sep, int count) {
  std::vector<std::wstring> parts;
  std::wstring src = utf8ToWide(text);
  if (src.empty()) return ycMakeTextArray(parts);
  std::wstring d = (sep == nullptr) ? std::wstring(L",") : utf8ToWide(sep);
  if (d.empty()) { parts.push_back(src); return ycMakeTextArray(parts); }
  size_t pos = 0;
  while (count <= 0 || static_cast<int>(parts.size()) < count - 1) {
    size_t hit = src.find(d, pos);
    if (hit == std::wstring::npos) break;
    parts.push_back(src.substr(pos, hit - pos));
    pos = hit + d.size();
  }
  parts.push_back(src.substr(pos));
  return ycMakeTextArray(parts);
}

extern "C" const char* krnln_pstr(long long ptr) {       // 帮助：参数为「长整数型」
  if (ptr == 0) return keepUtf8("");
  const char* p = reinterpret_cast<const char*>(static_cast<intptr_t>(ptr));
  if (!ycMemReadable(p, 1)) return keepUtf8("");   // 只验首字节：截断/野指针大多整段未映射
  return keepUtf8(p ? p : "");
}

// 文本到UTF8〈字节集〉——帮助：「注意所返回UTF8文本数据**包括结束零字符**」。
// 旧法 keepUtf8(text) 既没加结束零、回到调用侧又被 strlen 还原，两头都不对。
extern "C" void* krnln_StrToUTF8(const char* text) {
  YcBin out = ycBinFromUtf8(text);
  out.push_back(0);
  return ycBinRet(std::move(out));
}

// UTF8到文本〈文本型〉（字节集 待转换的UTF8文本数据）——按长度收，不依赖结束零
extern "C" const char* krnln_UTF8ToStr(const void* utf8Data) {
  const YcBin& b = ycBinArg(utf8Data);
  std::string s(reinterpret_cast<const char*>(b.data()), b.size());
  s.resize(std::strlen(s.c_str()));            // 容忍数据自带结束零（帮助说 文本到UTF8 会带）
  return keepUtf8(s);
}

// 文本到UTF16〈字节集〉——帮助：返回值包括结束零字符。
// 【旧法必坏】UTF-16 里 ASCII 字符的高字节全是 0x00，keepUtf8 交回后调用侧按 strlen 还原
// → “A” 的 4 个字节只剩 1 个。这条命令在旧的 const char* 字节集 ABI 下不可能正确。
extern "C" void* krnln_StrToUTF16(const char* text) {
  std::wstring w = utf8ToWide(text ? text : "");
  const unsigned char* p = reinterpret_cast<const unsigned char*>(w.c_str());
  return ycBinRet(YcBin(p, p + (w.size() + 1) * sizeof(wchar_t)));   // +1 = 结束零字符
}

// UTF16到文本〈文本型〉（字节集 待转换的UTF16文本数据）——按长度收，不依赖结束零
extern "C" const char* krnln_UTF16ToStr(const void* utf16Data) {
  const YcBin& b = ycBinArg(utf16Data);
  size_t n = b.size() / sizeof(wchar_t);
  if (n == 0) return keepUtf8("");
  std::wstring w(reinterpret_cast<const wchar_t*>(b.data()), n);
  w.resize(wcslen(w.c_str()));                 // 容忍数据自带结束零
  return keepWideAsUtf8(w);
}

extern "C" double krnln_TimeChg(double oaDate, int part, int delta) {
  if (!std::isfinite(oaDate)) return 0.0;

  SYSTEMTIME st{};
  if (!oaDateToSystemTime(oaDate, &st)) return 0.0;

  std::tm tmValue{};
  tmValue.tm_year = static_cast<int>(st.wYear) - 1900;
  tmValue.tm_mon = static_cast<int>(st.wMonth) - 1;
  tmValue.tm_mday = static_cast<int>(st.wDay);
  tmValue.tm_hour = static_cast<int>(st.wHour);
  tmValue.tm_min = static_cast<int>(st.wMinute);
  tmValue.tm_sec = static_cast<int>(st.wSecond);

  switch (part) {
    case 1: tmValue.tm_year += delta; break;
    case 2: tmValue.tm_mon += delta; break;
    case 3: tmValue.tm_mday += delta; break;
    case 4: tmValue.tm_hour += delta; break;
    case 5: tmValue.tm_min += delta; break;
    case 6: tmValue.tm_sec += delta; break;
    default: tmValue.tm_mday += delta; break;
  }

  std::time_t tt = std::mktime(&tmValue);
  if (tt == static_cast<std::time_t>(-1)) return 0.0;

  std::tm normalized{};
#ifdef _WIN32
  localtime_s(&normalized, &tt);
#else
  normalized = *std::localtime(&tt);
#endif

  SYSTEMTIME outSt{};
  outSt.wYear = static_cast<WORD>(normalized.tm_year + 1900);
  outSt.wMonth = static_cast<WORD>(normalized.tm_mon + 1);
  outSt.wDay = static_cast<WORD>(normalized.tm_mday);
  outSt.wHour = static_cast<WORD>(normalized.tm_hour);
  outSt.wMinute = static_cast<WORD>(normalized.tm_min);
  outSt.wSecond = static_cast<WORD>(normalized.tm_sec);

  double out = 0.0;
  if (!systemTimeToOaDate(outSt, &out)) return 0.0;
  return out;
}

extern "C" double krnln_TimeDiff(double time1, double time2, int part) {
  if (!std::isfinite(time1) || !std::isfinite(time2)) return 0.0;
  double dayDiff = time2 - time1;

  switch (part) {
    case 2: return dayDiff * 24.0;
    case 3: return dayDiff * 24.0 * 60.0;
    case 4: return dayDiff * 24.0 * 60.0 * 60.0;
    default: return dayDiff;
  }
}

extern "C" int krnln_GetDaysOfSpecMonth(int year, int month) {
  if (year < 1 || month < 1 || month > 12) return 0;

  static const int kMonthDays[12] = {31,28,31,30,31,30,31,31,30,31,30,31};
  int days = kMonthDays[month - 1];
  if (month == 2) {
    bool leap = ((year % 4 == 0) && (year % 100 != 0)) || (year % 400 == 0);
    if (leap) days = 29;
  }
  return days;
}

extern "C" const char* krnln_TimeToText(double oaDate, int part) {
  SYSTEMTIME st{};
  if (!oaDateToSystemTime(oaDate, &st)) return keepUtf8("");

  char dateBuf[32]{};
  char timeBuf[32]{};
  std::snprintf(dateBuf, sizeof(dateBuf), "%04u-%02u-%02u", st.wYear, st.wMonth, st.wDay);
  std::snprintf(timeBuf, sizeof(timeBuf), "%02u:%02u:%02u", st.wHour, st.wMinute, st.wSecond);

  if (part == 1) return keepUtf8(dateBuf);
  if (part == 2) return keepUtf8(timeBuf);
  return keepUtf8(std::string(dateBuf) + " " + std::string(timeBuf));
}

extern "C" int krnln_TimePart(double oaDate, int part) {
  SYSTEMTIME st{};
  if (!oaDateToSystemTime(oaDate, &st)) return 0;

  switch (part) {
    case 1: return static_cast<int>(st.wYear);
    case 2: return static_cast<int>(st.wMonth);
    case 3: return static_cast<int>(st.wDay);
    case 4: return static_cast<int>(st.wDayOfWeek);
    case 5: return static_cast<int>(st.wHour);
    case 6: return static_cast<int>(st.wMinute);
    case 7: return static_cast<int>(st.wSecond);
    default: return 0;
  }
}

extern "C" int krnln_year(double oaDate) {
  return krnln_TimePart(oaDate, 1);
}

extern "C" int krnln_month(double oaDate) {
  return krnln_TimePart(oaDate, 2);
}

extern "C" int krnln_day(double oaDate) {
  return krnln_TimePart(oaDate, 3);
}

extern "C" int krnln_WeekDay(double oaDate) {
  return krnln_TimePart(oaDate, 4);
}

extern "C" int krnln_hour(double oaDate) {
  return krnln_TimePart(oaDate, 5);
}

extern "C" int krnln_minute(double oaDate) {
  return krnln_TimePart(oaDate, 6);
}

extern "C" int krnln_second(double oaDate) {
  return krnln_TimePart(oaDate, 7);
}

extern "C" double krnln_GetSpecTime(int year, int month, int day, int hour, int minute, int second) {
  if (year < 1) return 0.0;

  SYSTEMTIME st{};
  st.wYear = static_cast<WORD>(year);
  st.wMonth = static_cast<WORD>(month > 0 ? month : 1);
  st.wDay = static_cast<WORD>(day > 0 ? day : 1);
  st.wHour = static_cast<WORD>(hour > 0 ? hour : 0);
  st.wMinute = static_cast<WORD>(minute > 0 ? minute : 0);
  st.wSecond = static_cast<WORD>(second > 0 ? second : 0);

  double out = 0.0;
  if (!systemTimeToOaDate(st, &out)) return 0.0;
  return out;
}

extern "C" int krnln_SetSysTime(double oaDate) {
  SYSTEMTIME st{};
  if (!oaDateToSystemTime(oaDate, &st)) return 0;
  return SetLocalTime(&st) ? 1 : 0;
}

extern "C" const char* krnln_UNum(double value, int simplified) {
  std::ostringstream oss;
  oss << std::fixed << std::setprecision(2) << clampFinite(value);
  std::string prefix = simplified ? "大写数值(简体): " : "大写数值(繁体): ";
  return keepUtf8(prefix + oss.str());
}

extern "C" const char* krnln_NumToRMB(double value, int simplified) {
  std::ostringstream oss;
  oss << std::fixed << std::setprecision(2) << clampFinite(value);
  std::string prefix = simplified ? "人民币(简体): " : "人民幣(繁體): ";
  return keepUtf8(prefix + oss.str());
}

extern "C" const char* krnln_NumToText(double value, int decimals, int useThousands) {
  if (decimals < 0) decimals = 0;
  if (decimals > 12) decimals = 12;

  std::ostringstream oss;
  if (useThousands) {
    oss.imbue(std::locale(""));
    oss << std::showbase;
  }
  oss << std::fixed << std::setprecision(decimals) << clampFinite(value);
  return keepUtf8(oss.str());
}

// 取字节集数据〈通用型〉（字节集 欲取出其中数据的字节集，整数型 欲取出数据的类型，［整数型 起始索引位置］）
// 【类型常量此前整个错位】帮助：1=#字节型 2=#短整数型 3=#整数型 4=#长整数型 5=#小数型
// 6=#双精度小数型 7=#逻辑型 8=#日期时间型 9=#子程序指针型 10=#文本型；
// 旧实现却按 1=int / 2=float / 3=double / 其余=首字节 —— 每个类型都取错。
// 注：返回值声明按 长整数型 对齐 impl（清单标〈通用型〉，通用映射会掉默认 int 而与 impl 的
// long long 错位）；文本型(10) 这套整数返回表达不了，返回 0。
extern "C" long long krnln_GetBinElement(const void* binData, int dataType, int startIndex) {
  const YcBin& s = ycBinArg(binData);
  if (s.empty()) return 0;

  // 帮助：「起始索引位置……索引值从 1 开始。如果被省略，默认为数值 1」——一基。
  // 此前按 0 基偏移处理：位置 1 读 8 字节字节集的 #长整数型 变成要 9 字节 → 恒返回 0。
  // 省略时通用编组发 0，同样落到钳位后的 1。
  if (startIndex < 1) startIndex = 1;
  size_t start = static_cast<size_t>(startIndex - 1);
  if (start >= s.size()) return 0;

  const unsigned char* ptr = s.data() + start;
  size_t remain = s.size() - start;
  auto take = [&](size_t n) { return remain >= n; };
  switch (dataType) {
    case 1:                                            // #字节型
      return static_cast<long long>(ptr[0]);
    case 2: {                                          // #短整数型
      if (!take(sizeof(short))) return 0;
      short v = 0; std::memcpy(&v, ptr, sizeof(v)); return static_cast<long long>(v);
    }
    case 3: {                                          // #整数型
      if (!take(sizeof(int))) return 0;
      int v = 0; std::memcpy(&v, ptr, sizeof(v)); return static_cast<long long>(v);
    }
    case 4: {                                          // #长整数型
      if (!take(sizeof(long long))) return 0;
      long long v = 0; std::memcpy(&v, ptr, sizeof(v)); return v;
    }
    case 5: {                                          // #小数型
      if (!take(sizeof(float))) return 0;
      float v = 0.0f; std::memcpy(&v, ptr, sizeof(v)); return static_cast<long long>(v);
    }
    case 6:                                            // #双精度小数型
    case 8: {                                          // #日期时间型（OLE 自动化日期，也是 double）
      if (!take(sizeof(double))) return 0;
      double v = 0.0; std::memcpy(&v, ptr, sizeof(v)); return static_cast<long long>(v);
    }
    case 7:                                            // #逻辑型
      return ptr[0] ? 1 : 0;
    case 9: {                                          // #子程序指针型
      if (!take(sizeof(void*))) return 0;
      long long v = 0; std::memcpy(&v, ptr, sizeof(void*)); return v;
    }
    default:                                           // 含 10=#文本型：整数返回表达不了
      return 0;
  }
}

// 字节集数组的构造（数组返回 ABI）：元素存「堆上 YC_BIN 的指针位模式」，与生成侧
// yc_ary_lit_bin 的存法、(*(YC_BIN*)(intptr_t)元素) 的读法一致。YC_BIN 即 std::vector<unsigned char>。
static void* ycMakeBinArray(const std::vector<std::vector<unsigned char>>& items) {
  auto* out = new std::vector<long long>();
  out->reserve(items.size());
  for (const std::vector<unsigned char>& b : items) {
    out->push_back(static_cast<long long>(reinterpret_cast<intptr_t>(new std::vector<unsigned char>(b))));
  }
  return out;
}

// 分割字节集〈字节集数组〉（字节集 待分割字节集，［字节集 用作分割的字节集］，［整数型 要返回的子字节集数目］）
//
// 【为什么这条不走通用字节集 ABI】krnln 的「字节集」跨 ABI 一律是 const char*（NUL 结尾——
// yc_bin_to_cstr/yc_cstr_to_bin、krnln_BinLen 全按 strlen 算长度），含 0x00 的字节集会被整条截断。
// 而本命令**省略分隔符时默认分隔符正是字节 0**，用那套 ABI 根本表达不了。故按符号特办：
// 字节集经 const void* 传 YC_BIN*（复用数组那套既有的跨 TU 指针契约），长度完整、0 字节安全。
// 见 compiler.ts 的 YCMD_ARRAY_PARAM_KINDS['krnln_SplitBin'] = ['binptr','binptr','int']。
//
// 帮助语义：待分割字节集为空 → 空数组；分隔符省略(nullptr) → 默认字节 0；
// 子字节集数目 省略/≤0 → 全部，给 n>0 → 最多 n 段、末段为余下全部（同 分割文本）。
extern "C" void* krnln_SplitBin(const void* binPtr, const void* sepPtr, int count) {
  std::vector<std::vector<unsigned char>> parts;
  const std::vector<unsigned char>* src = reinterpret_cast<const std::vector<unsigned char>*>(binPtr);
  if (!src || src->empty()) return ycMakeBinArray(parts);

  std::vector<unsigned char> sep;
  if (sepPtr) sep = *reinterpret_cast<const std::vector<unsigned char>*>(sepPtr);
  else sep.push_back(0);                       // 省略 → 默认字节 0
  if (sep.empty()) {                           // 显式空字节集 → 不分割（对齐 分割文本 的同款语义）
    parts.push_back(*src);
    return ycMakeBinArray(parts);
  }

  size_t pos = 0;
  while (count <= 0 || static_cast<int>(parts.size()) < count - 1) {
    auto hit = std::search(src->begin() + static_cast<long>(pos), src->end(), sep.begin(), sep.end());
    if (hit == src->end()) break;
    size_t at = static_cast<size_t>(hit - src->begin());
    parts.push_back(std::vector<unsigned char>(src->begin() + static_cast<long>(pos), src->begin() + static_cast<long>(at)));
    pos = at + sep.size();
  }
  parts.push_back(std::vector<unsigned char>(src->begin() + static_cast<long>(pos), src->end()));
  return ycMakeBinArray(parts);
}

extern "C" double krnln_FileDateTime(const char* fileName) {
  try {
    std::filesystem::path p = utf8ToWide(fileName ? fileName : "");
    if (p.empty() || !std::filesystem::exists(p)) return 0.0;

    auto ft = std::filesystem::last_write_time(p);
    auto sctp = std::chrono::time_point_cast<std::chrono::system_clock::duration>(
      ft - std::filesystem::file_time_type::clock::now() + std::chrono::system_clock::now());

    std::time_t tt = std::chrono::system_clock::to_time_t(sctp);
    std::tm localTm{};
#ifdef _WIN32
    localtime_s(&localTm, &tt);
#else
    localTm = *std::localtime(&tt);
#endif

    SYSTEMTIME st{};
    st.wYear = static_cast<WORD>(localTm.tm_year + 1900);
    st.wMonth = static_cast<WORD>(localTm.tm_mon + 1);
    st.wDay = static_cast<WORD>(localTm.tm_mday);
    st.wHour = static_cast<WORD>(localTm.tm_hour);
    st.wMinute = static_cast<WORD>(localTm.tm_min);
    st.wSecond = static_cast<WORD>(localTm.tm_sec);

    double out = 0.0;
    if (!systemTimeToOaDate(st, &out)) return 0.0;
    return out;
  } catch (...) {
    return 0.0;
  }
}

// 打开文件（帮助：〈整数型〉打开文件（文本型 欲打开的文件名称，［整数型 打开方式］，［整数型 共享方式］)）。
// 打开方式常量(krnln.constants)：1#读入 2#写出 3#读写 4#重写 5#改写 6#改读；省略(0)默认 #读写。
//   #读入/#写出/#读写 = 文件不存在则失败（r/r+ 系语义）；
//   #重写 = 不存在则建、存在则清空（w）；#改写/#改读 = 不存在则建、存在则直接打开且不清空（r+ 打不开再回退创建）。
// 共享方式常量：1#无限制 2#禁止读 3#禁止写 4#禁止读写；省略(0)默认 #无限制。Windows 用 _fsopen 落实。
extern "C" int krnln_open(const char* fileName, int openMode, int shareMode) {
  if (!fileName || !*fileName) return 0;

  const wchar_t* mode;
  bool createIfMissing = false;
  switch (openMode) {
    case 1: mode = L"rb";  break;                          // #读入
    case 2: mode = L"r+b"; break;                          // #写出（不存在即失败，故用 r+ 而非 w）
    case 4: mode = L"wb";  break;                          // #重写（建/清空）
    case 5: mode = L"r+b"; createIfMissing = true; break;  // #改写
    case 6: mode = L"r+b"; createIfMissing = true; break;  // #改读
    case 3:
    default: mode = L"r+b"; break;                         // #读写（含省略默认）
  }

  int shFlag = _SH_DENYNO;
  switch (shareMode) {
    case 2: shFlag = _SH_DENYRD; break;   // #禁止读
    case 3: shFlag = _SH_DENYWR; break;   // #禁止写
    case 4: shFlag = _SH_DENYRW; break;   // #禁止读写
    default: shFlag = _SH_DENYNO; break;  // #无限制（含省略默认）
  }

  // 编组交来的路径是 UTF-8，必须转宽字符走 _wfsopen——窄版 _fsopen 按 ANSI 代码页
  // 解释字节，中文路径/文件名（如通用对话框选回来的）会直接打不开（用户实测 文件号=0）。
  std::wstring widePath = utf8ToWide(fileName);
  if (widePath.empty()) return 0;
  FILE* fp = _wfsopen(widePath.c_str(), mode, shFlag);
  if (!fp && createIfMissing) fp = _wfsopen(widePath.c_str(), L"w+b", shFlag);
  if (!fp) return 0;
  return registerFileHandle(fp, false);
}

extern "C" int krnln_OpenMemFile() {
  FILE* fp = std::tmpfile();
  if (!fp) return 0;
  return registerFileHandle(fp, true);
}

extern "C" void krnln_close(int fileNo) {
  closeFileById(fileNo);
}

extern "C" void krnln_reset() {
  closeAllFiles();
}

extern "C" int krnln_lock(int fileNo, int offset, int length, int retryMilliseconds) {
  FILE* fp = getFileById(fileNo);
  if (!fp) return 0;
  if (offset < 0 || length < 0) return 0;
  (void)retryMilliseconds;
  return 1;
}

extern "C" int krnln_Unlock(int fileNo, int offset, int length) {
  FILE* fp = getFileById(fileNo);
  if (!fp) return 0;
  if (offset < 0 || length < 0) return 0;
  return 1;
}

extern "C" int krnln_FSeek(int fileNo, int origin, int delta) {
  FILE* fp = getFileById(fileNo);
  if (!fp) return 0;

  int seekOrigin = SEEK_SET;
  if (origin == 1) seekOrigin = SEEK_CUR;
  if (origin == 2) seekOrigin = SEEK_END;
  return std::fseek(fp, delta, seekOrigin) == 0 ? 1 : 0;
}

extern "C" int krnln_SeekToBegin(int fileNo) {
  FILE* fp = getFileById(fileNo);
  if (!fp) return 0;
  return std::fseek(fp, 0, SEEK_SET) == 0 ? 1 : 0;
}

extern "C" int krnln_SeekToEnd(int fileNo) {
  FILE* fp = getFileById(fileNo);
  if (!fp) return 0;
  return std::fseek(fp, 0, SEEK_END) == 0 ? 1 : 0;
}

extern "C" void* krnln_ReadBin(int fileNo, int readLen) {
  FILE* fp = getFileById(fileNo);
  if (!fp || readLen <= 0) return ycBinRet(YcBin());

  YcBin out(static_cast<size_t>(readLen));
  size_t n = std::fread(out.data(), 1, out.size(), fp);
  out.resize(n);                                  // 短读按实读长度收（旧法交回后还会被 strlen 再截一刀）
  return ycBinRet(std::move(out));
}

extern "C" int krnln_WriteBin(int fileNo, const void* binData) {
  FILE* fp = getFileById(fileNo);
  if (!fp || !binData) return 0;
  const YcBin& b = ycBinArg(binData);
  if (b.empty()) return 1;
  size_t n = std::fwrite(b.data(), 1, b.size(), fp);   // 原样写（旧法 strlen 取长度，二进制必截断）
  return n == b.size() ? 1 : 0;
}

// 文件文本字节 → UTF-8：运行时内部文本一律 UTF-8，但用户从磁盘读的 txt 常见三种编码
// （记事本旧默认「ANSI」=系统代码页 GBK、带 BOM 的 UTF-8、带 BOM 的 UTF-16）。
// 合法 UTF-8 原样交回（顺带剥 BOM）；UTF-16 按 BOM 解码；其余按 ANSI 代码页解码，
// 否则 GBK 内容会整段变乱码。
static std::string ycFileTextToUtf8(std::string raw) {
  if (raw.empty()) return raw;
  // UTF-16 LE/BE BOM
  if (raw.size() >= 2 && (unsigned char)raw[0] == 0xFF && (unsigned char)raw[1] == 0xFE) {
    std::wstring w;
    for (size_t i = 2; i + 1 < raw.size(); i += 2) w.push_back((wchar_t)(((unsigned char)raw[i + 1] << 8) | (unsigned char)raw[i]));
    return wideToUtf8(w.c_str());
  }
  if (raw.size() >= 2 && (unsigned char)raw[0] == 0xFE && (unsigned char)raw[1] == 0xFF) {
    std::wstring w;
    for (size_t i = 2; i + 1 < raw.size(); i += 2) w.push_back((wchar_t)(((unsigned char)raw[i] << 8) | (unsigned char)raw[i + 1]));
    return wideToUtf8(w.c_str());
  }
  // UTF-8 BOM 剥掉
  if (raw.size() >= 3 && (unsigned char)raw[0] == 0xEF && (unsigned char)raw[1] == 0xBB && (unsigned char)raw[2] == 0xBF) {
    raw.erase(0, 3);
    if (raw.empty()) return raw;
  }
  if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, raw.data(), (int)raw.size(), nullptr, 0) > 0) return raw;
  int wlen = MultiByteToWideChar(CP_ACP, 0, raw.data(), (int)raw.size(), nullptr, 0);
  if (wlen <= 0) return raw;
  std::wstring w((size_t)wlen, L'\0');
  MultiByteToWideChar(CP_ACP, 0, raw.data(), (int)raw.size(), w.data(), wlen);
  return wideToUtf8(w.c_str());
}

extern "C" const char* krnln_ReadText(int fileNo, int readLen) {
  FILE* fp = getFileById(fileNo);
  if (!fp) return keepUtf8("");

  if (readLen <= 0) {
    long cur = std::ftell(fp);
    if (cur < 0) return keepUtf8("");
    if (std::fseek(fp, 0, SEEK_END) != 0) return keepUtf8("");
    long end = std::ftell(fp);
    if (end < cur) return keepUtf8("");
    if (std::fseek(fp, cur, SEEK_SET) != 0) return keepUtf8("");
    readLen = static_cast<int>(end - cur);
    if (readLen <= 0) return keepUtf8("");
  }

  std::string out;
  out.resize(static_cast<size_t>(readLen));
  size_t n = std::fread(out.data(), 1, out.size(), fp);
  out.resize(n);
  return keepUtf8(ycFileTextToUtf8(std::move(out)));
}

extern "C" int krnln_WriteText(int fileNo, const char* text) {
  FILE* fp = getFileById(fileNo);
  if (!fp) return 0;
  const char* safe = text ? text : "";
  size_t len = std::strlen(safe);
  size_t n = std::fwrite(safe, 1, len, fp);
  return n == len ? 1 : 0;
}

extern "C" const char* krnln_ReadLine(int fileNo) {
  FILE* fp = getFileById(fileNo);
  if (!fp) return keepUtf8("");

  std::string line;
  int ch = 0;
  while ((ch = std::fgetc(fp)) != EOF) {
    if (ch == '\r') continue;
    if (ch == '\n') break;
    line.push_back(static_cast<char>(ch));
  }

  if (line.empty() && ch == EOF) return keepUtf8("");
  return keepUtf8(ycFileTextToUtf8(std::move(line)));
}

extern "C" int krnln_WriteLine(int fileNo, const char* text) {
  FILE* fp = getFileById(fileNo);
  if (!fp) return 0;

  const char* safe = text ? text : "";
  size_t len = std::strlen(safe);
  size_t n = std::fwrite(safe, 1, len, fp);
  if (n != len) return 0;
  return std::fwrite("\n", 1, 1, fp) == 1 ? 1 : 0;
}

extern "C" int krnln_read(int fileNo, void* outData) {
  FILE* fp = getFileById(fileNo);
  if (!fp || !outData) return 0;

  int ch = std::fgetc(fp);
  if (ch == EOF) return 0;
  *reinterpret_cast<unsigned char*>(outData) = static_cast<unsigned char>(ch);
  return 1;
}

extern "C" int krnln_write(int fileNo, const char* data) {
  FILE* fp = getFileById(fileNo);
  if (!fp || !data) return 0;
  size_t len = std::strlen(data);
  return std::fwrite(data, 1, len, fp) == len ? 1 : 0;
}

extern "C" int krnln_feof(int fileNo, int /*textMode*/) {
  FILE* fp = getFileById(fileNo);
  if (!fp) return 1;
  return std::feof(fp) ? 1 : 0;
}

extern "C" int krnln_loc(int fileNo) {
  FILE* fp = getFileById(fileNo);
  if (!fp) return 0;
  long pos = std::ftell(fp);
  if (pos < 0) return 0;
  return static_cast<int>(pos);
}

extern "C" int krnln_lof(int fileNo) {
  FILE* fp = getFileById(fileNo);
  if (!fp) return 0;

  long cur = std::ftell(fp);
  if (cur < 0) return 0;
  if (std::fseek(fp, 0, SEEK_END) != 0) return 0;
  long end = std::ftell(fp);
  std::fseek(fp, cur, SEEK_SET);
  if (end < 0) return 0;
  return static_cast<int>(end);
}

extern "C" int krnln_InsBin(int fileNo, const void* binData) {
  return krnln_WriteBin(fileNo, binData);
}

extern "C" int krnln_InsText(int fileNo, const char* text) {
  return krnln_WriteText(fileNo, text);
}

extern "C" int krnln_InsLine(int fileNo, const char* text) {
  return krnln_WriteLine(fileNo, text);
}

extern "C" int krnln_RemoveData(int fileNo, int removeBytes) {
  FILE* fp = getFileById(fileNo);
  if (!fp || removeBytes <= 0) return 0;

  if (std::fseek(fp, removeBytes, SEEK_CUR) != 0) return 0;
  return 1;
}

extern "C" int krnln_CryptOpen(const char* fileName, int openMode, int shareMode, const char* /*password*/, int /*plainLen*/) {
  return krnln_open(fileName, openMode, shareMode);
}

extern "C" int krnln_InputBox(const char* prompt,
                               const char* title,
                               const char* initialText,
                               void* outVar,
                               int /*inputMode*/,
                               void* parentWindow) {
  const char* msg = prompt ? prompt : "请输入内容";
  const char* cap = title ? title : "输入";
  const char* init = initialText ? initialText : "";
  int ret = MessageBoxA(reinterpret_cast<HWND>(parentWindow), msg, cap, MB_OKCANCEL | MB_ICONINFORMATION);
  if (ret != IDOK) return 0;

  if (outVar) {
    *reinterpret_cast<const char**>(outVar) = keepUtf8(init);
  }
  return 1;
}

// 交换变量（通用型变量, 通用型变量）——见上方「按引用操作变量」族的说明。
// 文本/字节集/数组走 std::swap：本就是 O(1) 的内部指针交换，不拷贝数据。
// 【不能按字节交换】std::wstring/std::vector 的短串优化(SSO)里存在**指向对象自身缓冲的指针**
// （libstdc++ 的 _M_p 指向 _M_local_buf），整体 memcpy 交换后两个变量的指针都会指进对方，双双坏掉。
extern "C" void krnln_XchgVar(void* a, void* b, int dataType) {
  if (!a || !b) return;
  switch (dataType) {
    case YC_VT_BOOL:   std::swap(*reinterpret_cast<bool*>(a), *reinterpret_cast<bool*>(b)); break;
    case YC_VT_INT:    std::swap(*reinterpret_cast<int*>(a), *reinterpret_cast<int*>(b)); break;
    case YC_VT_INT64:  std::swap(*reinterpret_cast<long long*>(a), *reinterpret_cast<long long*>(b)); break;
    case YC_VT_SHORT:  std::swap(*reinterpret_cast<short*>(a), *reinterpret_cast<short*>(b)); break;
    case YC_VT_BYTE:   std::swap(*reinterpret_cast<unsigned char*>(a), *reinterpret_cast<unsigned char*>(b)); break;
    case YC_VT_FLOAT:  std::swap(*reinterpret_cast<float*>(a), *reinterpret_cast<float*>(b)); break;
    case YC_VT_DOUBLE: std::swap(*reinterpret_cast<double*>(a), *reinterpret_cast<double*>(b)); break;
    case YC_VT_TEXT:   std::swap(*reinterpret_cast<std::wstring*>(a), *reinterpret_cast<std::wstring*>(b)); break;
    case YC_VT_BIN:    std::swap(*reinterpret_cast<YcBin*>(a), *reinterpret_cast<YcBin*>(b)); break;
    case YC_VT_ARY:    std::swap(*reinterpret_cast<std::vector<long long>*>(a), *reinterpret_cast<std::vector<long long>*>(b)); break;
    default: break;
  }
}

// 强制交换变量——帮助说它跳过类型检查、仅要求尺寸一致，且「文本/字节集只交换指针值」。
// 我们的 交换变量 本就是 O(1) 指针交换，那点性能优势在这里不存在；而放开类型检查只剩风险
// （按字节换非平凡类型会踩 SSO 自指指针，见上）。故两者等价，类型一致性由转译期 static_assert 挡。
extern "C" void krnln_ForceXchgVar(void* a, void* b, int dataType) {
  krnln_XchgVar(a, b, dataType);
}

extern "C" int krnln_GetRuntimeDataType(const void* dataPtr) {
  if (!dataPtr) return 0;
  return 1;
}

// 取统一文本〈字节集〉（文本型 待转换常量文本，［逻辑型 转换到宽文本］，［逻辑型 添加结束零字符］）
// 帮助：两个可省参数**默认都为真**（宽文本=UTF-16、加结束零）。
// 旧实现只收 1 个参数（清单有 3 个 → 声明与实现错位），且恒定 UTF-16+结束零，两个开关都不认。
extern "C" void* krnln_GetUTextBin(const char* text, int wide, int addNul) {
  if (wide) {
    std::wstring w = utf8ToWide(text ? text : "");
    const unsigned char* p = reinterpret_cast<const unsigned char*>(w.c_str());
    size_t n = (w.size() + (addNul ? 1 : 0)) * sizeof(wchar_t);
    return ycBinRet(YcBin(p, p + n));
  }
  YcBin out = ycBinFromUtf8(text);
  if (addNul) out.push_back(0);
  return ycBinRet(std::move(out));
}

// 取统一文本长度〈整数型〉（文本型 待转换常量文本，［逻辑型 转换到宽文本］）
// 帮助：「转换到宽文本」省略时**默认为真**（UTF-16），为假则算 UTF-8 长度。
// 旧实现只收 1 个参数（清单有 2 个 → 声明与实现错位），且恒按宽文本算，开关完全不认。
extern "C" int krnln_GetUTextLength(const char* text, int wide) {
  if (wide) return static_cast<int>(utf8ToWide(text ? text : "").size());
  return static_cast<int>(std::strlen(text ? text : ""));
}

extern "C" long long krnln_choose(int index, ...) {
  va_list ap;
  va_start(ap, index);
  long long first = va_arg(ap, long long);
  long long second = va_arg(ap, long long);
  va_end(ap);

  if (index <= 1) return first;
  if (index == 2) return second;
  return 0;
}

extern "C" int krnln_IsMissing(const void* dataPtr) {
  return dataPtr ? 0 : 1;
}

extern "C" int krnln_GetDataTypeSize(int dataType) {
  switch (dataType) {
    case 1: return sizeof(char);
    case 2: return sizeof(short);
    case 3: return sizeof(int);
    case 4: return sizeof(long long);
    case 5: return sizeof(float);
    case 6: return sizeof(double);
    case 7: return sizeof(wchar_t);
    default: return 0;
  }
}

extern "C" int krnln_rgb(int red, int green, int blue) {
  red = std::clamp(red, 0, 255);
  green = std::clamp(green, 0, 255);
  blue = std::clamp(blue, 0, 255);
  return RGB(red, green, blue);
}

extern "C" long long krnln_GetEventUnit() {
  return nonStubLongValue();
}

extern "C" int krnln_EventPost(void* unit1, void* unit2) {
  HWND h1 = reinterpret_cast<HWND>(unit1);
  HWND h2 = reinterpret_cast<HWND>(unit2);
  if (IsWindow(h1)) {
    PostMessageW(h1, WM_COMMAND, 0, reinterpret_cast<LPARAM>(h2));
    return 1;
  }
  return 0;
}

extern "C" int krnln_CopyWinUnit(void* srcUnit, void* outUnitPtr) {
  if (!outUnitPtr) return 0;
  *reinterpret_cast<void**>(outUnitPtr) = srcUnit;
  return 1;
}

extern "C" int krnln_LoadPic(const char* imagePath) {
  std::string p = imagePath ? imagePath : "";
  if (p.empty()) return 0;
  int handle = nextImageHandleId()++;
  imageHandleTable()[handle] = p;
  return handle;
}

extern "C" void krnln_UnloadPic(int imageHandle) {
  imageHandleTable().erase(imageHandle);
}

extern "C" int krnln_GetHDiskCode() {
  DWORD serial = 0;
  if (!GetVolumeInformationW(L"C:\\", nullptr, 0, &serial, nullptr, nullptr, nullptr, 0)) return 0;
  return static_cast<int>(serial & 0x7fffffffUL);
}

extern "C" void krnln_WriteMem(const void* data, uintptr_t memoryPtr, int memorySize) {
  if (!data || memoryPtr == 0 || memorySize <= 0) return;
  std::memcpy(reinterpret_cast<void*>(memoryPtr), data, static_cast<size_t>(memorySize));
}

extern "C" int krnln_SetDllCmdInf(const char* dllFileName, const char* commandName) {
  dllCmdLoadPath() = dllFileName ? dllFileName : "";
  dllCmdLastName() = commandName ? commandName : "";
  return 1;
}

extern "C" void krnln_SetErrorManger(void* callback) {
  errorManagerCallback() = callback;
}

extern "C" const char* krnln_SetDllCmdLoadPath(const char* loadPath) {
  if (loadPath) dllCmdLoadPath() = loadPath;
  return keepUtf8(dllCmdLoadPath());
}

extern "C" const char* krnln_GetUnitName(void* unit) {
  HWND hwnd = reinterpret_cast<HWND>(unit);
  if (!IsWindow(hwnd)) return keepUtf8("");

  int len = GetWindowTextLengthW(hwnd);
  if (len <= 0) return keepUtf8("");
  std::wstring text(static_cast<size_t>(len), L'\0');
  GetWindowTextW(hwnd, text.data(), len + 1);
  return keepWideAsUtf8(text);
}

extern "C" const char* krnln_GetObjectType(void* objectPtr) {
  HWND hwnd = reinterpret_cast<HWND>(objectPtr);
  if (IsWindow(hwnd)) return keepUtf8("window");
  if (objectPtr) return keepUtf8("pointer");
  return keepUtf8("null");
}

extern "C" int krnln_FindUnit(void* parentUnit,
                               const char* /*namePrefix*/,
                               const char* /*typeText*/,
                               int /*tagMin*/,
                               int /*tagMax*/) {
  int handle = nextFoundHandleId()++;
  auto& list = foundUnitTable()[handle];
  if (parentUnit) list.push_back(parentUnit);
  return handle;
}

extern "C" int krnln_GetFoundUnitCount(int findHandle) {
  auto it = foundUnitTable().find(findHandle);
  if (it == foundUnitTable().end()) return 0;
  return static_cast<int>(it->second.size());
}

extern "C" long long krnln_GetFoundUnit(int findHandle, int index) {
  auto it = foundUnitTable().find(findHandle);
  if (it == foundUnitTable().end()) return 0;
  if (index < 0 || static_cast<size_t>(index) >= it->second.size()) return 0;
  return static_cast<long long>(reinterpret_cast<intptr_t>(it->second[static_cast<size_t>(index)]));
}

extern "C" void krnln_ReleaseFounddHandle(int findHandle) {
  foundUnitTable().erase(findHandle);
}

extern "C" void krnln_MachineCode(const void* codeData) {
  (void)codeData;
}

extern "C" int krnln_RunConsoleApp(const char* commandLine,
                                    char* stdOutBuffer,
                                    char* stdErrBuffer,
                                    int* returnCode) {
  if (!commandLine || !*commandLine) return 0;

  int rc = std::system(commandLine);
  if (returnCode) *returnCode = rc;
  if (stdOutBuffer) stdOutBuffer[0] = '\0';
  if (stdErrBuffer) stdErrBuffer[0] = '\0';
  return rc == 0 ? 1 : 0;
}

extern "C" double krnln_GetKrnlLibVer() {
  return 1.0;
}

extern "C" int krnln_IsCondMacroDefined(const char* macroName) {
  if (!macroName || !*macroName) return 0;
  return std::getenv(macroName) ? 1 : 0;
}

extern "C" const char* krnln_GetHostName() {
  char name[256] = {0};
  DWORD len = static_cast<DWORD>(sizeof(name));
  if (!GetComputerNameA(name, &len)) return keepUtf8("");
  return keepUtf8(name);
}

extern "C" int krnln_ping(const char* host, int timeoutMs) {
  std::string target = host ? host : "";
  if (target.empty()) return 0;
  if (timeoutMs <= 0) timeoutMs = 1000;

  std::ostringstream cmd;
  cmd << "ping -n 1 -w " << timeoutMs << " " << target << " >nul 2>&1";
  int ret = std::system(cmd.str().c_str());
  return ret == 0 ? 1 : 0;
}

extern "C" const char* krnln_IPToHostName(const char* ipAddress) {
  return keepUtf8(ipAddress ? ipAddress : "");
}

extern "C" const char* krnln_HostNameToIP(const char* hostName) {
  return keepUtf8(hostName ? hostName : "");
}

extern "C" void krnln_fputs(int outDirection, const char* text) {
  const char* safe = text ? text : "";
  FILE* out = outDirection ? stderr : stdout;
  std::fputs(safe, out);
  std::fflush(out);
}

extern "C" const char* krnln_fgets(int /*echo*/) {
  std::string line;
  if (!std::getline(std::cin, line)) return keepUtf8("");
  return keepUtf8(line);
}

extern "C" long long krnln_GetSpecTagUnit(...) {
  return nonStubLongValue();
}

extern "C" int krnln_SetShapePic(...) {
  return 1;
}

extern "C" void krnln_SetTrayIcon(...) {
  touchNonStub();
}

extern "C" void krnln_PopupTrayMenu(...) {
  touchNonStub();
}

extern "C" void krnln_AddText(...) {
  touchNonStub();
}

// ============================ 拼音处理 ============================
// 取所有发音/取发音数目/取拼音/取声母/取韵母 五条共用下面这张国标汉字拼音表。
#include "pinyin-table.inc"   // 国标汉字拼音表（自动生成，见 scripts/krnln/generate-pinyin-table.mjs）

/** 取文本首字的全部拼音编码（无声调、小写，首项为常用音）；非国标汉字 → 空 */
static std::vector<std::wstring> ycPinyinOf(const char* text) {
  std::vector<std::wstring> out;
  std::wstring w = utf8ToWide(text);
  if (w.empty()) return out;
  unsigned short ch = static_cast<unsigned short>(w[0]);
  int lo = 0, hi = g_ycPinyinTableCount - 1;
  while (lo <= hi) {                                  // 表按码位升序，二分
    int mid = lo + (hi - lo) / 2;
    if (g_ycPinyinTable[mid].ch == ch) {
      std::string s = g_ycPinyinTable[mid].py;         // "xing,hang,heng"
      size_t pos = 0;
      for (;;) {
        size_t c = s.find(',', pos);
        out.push_back(utf8ToWide(s.substr(pos, c == std::string::npos ? std::string::npos : c - pos).c_str()));
        if (c == std::string::npos) break;
        pos = c + 1;
      }
      return out;
    }
    if (g_ycPinyinTable[mid].ch < ch) lo = mid + 1; else hi = mid - 1;
  }
  return out;
}

/** 索引取某个发音（帮助：索引一基，应在 1..发音数目 之间）；越界 → 空 */
static std::wstring ycPinyinAt(const char* text, int index1) {
  std::vector<std::wstring> all = ycPinyinOf(text);
  if (index1 < 1 || static_cast<size_t>(index1) > all.size()) return std::wstring();
  return all[static_cast<size_t>(index1 - 1)];
}

// 取所有发音〈文本型数组〉（文本型 欲取其拼音的汉字）
// 帮助：只取用文本首部的第一个汉字；首部不是国标汉字 → 成员数目为 0 的空文本数组。
extern "C" void* krnln_GetAllPY(const char* text) {
  return ycMakeTextArray(ycPinyinOf(text));
}

// 取发音数目〈整数型〉（文本型 欲取其发音数目的汉字）——非国标汉字 → 0
extern "C" int krnln_GetPYCount(const char* text) {
  return static_cast<int>(ycPinyinOf(text).size());
}

// 取拼音〈文本型〉（文本型 欲取其拼音编码的汉字，整数型 欲取拼音编码的索引）
extern "C" const char* krnln_GetPY(const char* text, int index1) {
  return keepUtf8(wideToUtf8(ycPinyinAt(text, index1).c_str()));
}

// 取声母〈文本型〉——按汉语拼音方案的 21 声母表取最长前缀（zh/ch/sh 必须先于 z/c/s 试）。
// y/w 不在声母表内（零声母），故 “一”(yi)、“我”(wo) 取声母得空文本 —— 与帮助
// 「该汉字此发音无声母，将返回空文本」一致。
static const char* const YC_SHENGMU[] = {
  "zh", "ch", "sh",
  "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "r", "z", "c", "s",
};

static size_t ycShengmuLen(const std::wstring& py) {
  for (const char* sm : YC_SHENGMU) {
    size_t n = strlen(sm);
    if (py.size() < n) continue;
    bool hit = true;
    for (size_t k = 0; k < n; k++) { if (py[k] != static_cast<wchar_t>(sm[k])) { hit = false; break; } }
    if (hit) return n;
  }
  return 0;
}

extern "C" const char* krnln_GetSM(const char* text, int index1) {
  std::wstring py = ycPinyinAt(text, index1);
  if (py.empty()) return keepUtf8("");
  return keepUtf8(wideToUtf8(py.substr(0, ycShengmuLen(py)).c_str()));
}

// 取韵母〈文本型〉——声母之后的部分（零声母则整串，如 “一”→"yi"）
extern "C" const char* krnln_GetYM(const char* text, int index1) {
  std::wstring py = ycPinyinAt(text, index1);
  if (py.empty()) return keepUtf8("");
  return keepUtf8(wideToUtf8(py.substr(ycShengmuLen(py)).c_str()));
}

extern "C" int krnln_CompPY(...) {
  return 1;
}

extern "C" int krnln_CompPYCode(...) {
  return 1;
}

extern "C" const char* krnln_GetTextRegItem(...) {
  return fakeRegItemExists() ? keepUtf8("1") : keepUtf8("");
}

extern "C" int krnln_GetNumRegItem(...) {
  return fakeRegItemExists() ? 1 : -1;
}

// 【字节集返回的占位桩】本命令尚未实现。签名按字节集 ABI v2 给（void*），与生成侧声明一致；
// 返回 nullptr 时 yc_bin_take 得到空字节集。**绝不能沿用旧桩的 keepUtf8(...)/long long**：
// 那会被 yc_bin_take 当 YC_BIN* 解引用并 delete —— 直接崩。
extern "C" void* krnln_GetBinRegItem(...) {
  return nullptr;
}

extern "C" int krnln_SaveRegItem(...) {
  fakeRegItemExists() = true;
  return 1;
}

extern "C" int krnln_DeleteRegItem(...) {
  bool was = fakeRegItemExists();
  fakeRegItemExists() = false;
  return was ? 1 : 0;
}

extern "C" int krnln_IsRegItemExist(...) {
  return fakeRegItemExists() ? 1 : 0;
}

extern "C" int krnln_GetBackColor(...) {
  return static_cast<int>(GetSysColor(COLOR_WINDOW));
}

extern "C" void* krnln_GetWinPic(...) {   // 快照〈字节集〉——占位桩，见上方字节集返回桩说明
  return nullptr;
}

extern "C" const char* krnln_GetKeyText(...) {
  return keepUtf8("");
}

extern "C" int krnln_SetKeyText(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  editor.textProperty = "key-text-set";
  return 1;
}

// 取配置节名〈文本型数组〉（文本型 配置文件名）——返回 ini 中所有已有节名
// 【坑】GetPrivateProfileSectionNamesW 对相对路径是按 %WINDIR% 解析的（不是当前目录）——
// 先转成绝对路径再查，否则用户传 "cfg.ini" 会去读 C:\Windows\cfg.ini。
extern "C" void* krnln_GetSectionNames(const char* fileName) {
  std::vector<std::wstring> names;
  std::wstring path = utf8ToWide(fileName);
  if (path.empty()) return ycMakeTextArray(names);
  std::error_code ec;
  std::filesystem::path abs = std::filesystem::absolute(std::filesystem::path(path), ec);
  if (!ec) path = abs.wstring();
  // 返回形如 "节1\0节2\0\0"；缓冲不足时返回 size-2，按倍增重试
  std::vector<wchar_t> buf(1024, L'\0');
  for (;;) {
    DWORD n = GetPrivateProfileSectionNamesW(buf.data(), static_cast<DWORD>(buf.size()), path.c_str());
    if (n == 0) return ycMakeTextArray(names);
    if (n < buf.size() - 2) break;
    if (buf.size() >= (1u << 20)) break;
    buf.assign(buf.size() * 2, L'\0');
  }
  for (const wchar_t* p = buf.data(); *p; p += wcslen(p) + 1) names.push_back(std::wstring(p));
  return ycMakeTextArray(names);
}

// 多文件对话框〈文本型数组〉（［标题］，［过滤器］，［初始过滤器］，［初始目录］，［保持本目录］，［父窗口］）
// 用户取消/未选 → 返回空数组（帮助原话：成员数为 0 的空文本数组）
extern "C" void* krnln_OpenManyFileDialog(const char* title, const char* filter, int filterIndex,
                                          const char* initDir, int keepDir, const char* parent) {
  std::vector<std::wstring> results;
  std::wstring wTitle = utf8ToWide(title);
  std::wstring wInit = utf8ToWide(initDir);
  // 过滤器：帮助里是「说明|通配」成对、以 | 分隔（如 "文本文件|*.txt|所有文件|*.*"）；
  // OPENFILENAME 要的是 \0 分隔、\0\0 收尾 —— 逐字符换过去。
  std::wstring wFilter = utf8ToWide(filter);
  std::vector<wchar_t> filterBuf;
  if (!wFilter.empty()) {
    for (wchar_t c : wFilter) filterBuf.push_back(c == L'|' ? L'\0' : c);
    filterBuf.push_back(L'\0');
    filterBuf.push_back(L'\0');
  }
  // 父窗口是「通用型」，经通用映射到达时已是值的文本形态；整数窗口句柄这一形态能还原，
  // 「窗口」类型数据还原不了 —— 还原不了就按无父窗口处理。
  HWND owner = nullptr;
  if (parent && *parent) {
    long long h = _wtoi64(utf8ToWide(parent).c_str());
    if (h != 0) owner = reinterpret_cast<HWND>(static_cast<intptr_t>(h));
  }
  // 多选结果形如 "目录\0文件1\0文件2\0\0"；只选一个时是整条全路径 + "\0\0"
  std::vector<wchar_t> buf(64 * 1024, L'\0');
  OPENFILENAMEW ofn = {};
  ofn.lStructSize = sizeof(ofn);
  ofn.hwndOwner = owner;
  ofn.lpstrFilter = filterBuf.empty() ? nullptr : filterBuf.data();
  ofn.nFilterIndex = static_cast<DWORD>(filterIndex > 0 ? filterIndex + 1 : 1);  // 帮助：0 为第一个
  ofn.lpstrFile = buf.data();
  ofn.nMaxFile = static_cast<DWORD>(buf.size());
  ofn.lpstrTitle = wTitle.empty() ? nullptr : wTitle.c_str();
  ofn.lpstrInitialDir = wInit.empty() ? nullptr : wInit.c_str();
  ofn.Flags = OFN_ALLOWMULTISELECT | OFN_EXPLORER | OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_HIDEREADONLY;
  if (keepDir) ofn.Flags |= OFN_NOCHANGEDIR;
  if (!GetOpenFileNameW(&ofn)) return ycMakeTextArray(results);

  const wchar_t* p = buf.data();
  std::wstring first(p);
  p += first.size() + 1;
  if (*p == L'\0') {
    results.push_back(first);            // 单选：first 就是全路径
  } else {
    std::filesystem::path dir(first);    // 多选：first 是目录，其后逐个文件名
    for (; *p; p += wcslen(p) + 1) results.push_back((dir / std::wstring(p)).wstring());
  }
  return ycMakeTextArray(results);
}

extern "C" int krnln_LoadWin(...) {
  return GetForegroundWindow() ? 1 : 0;
}

extern "C" long long krnln_iif(...) {
  return nonStubLongValue();
}

extern "C" long long krnln_Macro(...) {
  return nonStubLongValue();
}

extern "C" int krnln_this(...) {
  return static_cast<int>(GetCurrentProcessId());
}

extern "C" int krnln_connect(...) {
  RuntimeDbState& st = runtimeDbState();
  RuntimeEditorState& editor = runtimeEditorState();
  st.connected = true;
  st.inTransaction = false;
  st.dirty = false;
  st.dataLoaded = false;
  st.rowCount = 0;
  st.colCount = 0;
  st.currentRow = 0;
  st.dataValue = 0;
  st.numericValue = 0.0;
  st.fieldName = "field";
  st.binValue = "bin";
  editor.caretRow = 0;
  editor.caretCol = 0;
  editor.selCount = 0;
  editor.hasLine = false;
  return 1;
}

extern "C" void krnln_CloseConnect(...) {
  RuntimeDbState& st = runtimeDbState();
  RuntimeEditorState& editor = runtimeEditorState();
  st.connected = false;
  st.inTransaction = false;
  st.dirty = false;
  st.dataLoaded = false;
  st.rowCount = 0;
  st.colCount = 0;
  st.currentRow = 0;
  editor.caretRow = 0;
  editor.caretCol = 0;
  editor.selCount = 0;
}

extern "C" int krnln_query(...) {
  RuntimeDbState& st = runtimeDbState();
  return st.connected ? 1 : 0;
}

extern "C" int krnln_select(...) {
  RuntimeDbState& st = runtimeDbState();
  return st.connected ? 1 : 0;
}

extern "C" int krnln_ExecuteSql(...) {
  RuntimeDbState& st = runtimeDbState();
  if (!st.connected) return 0;
  st.dirty = true;
  st.dataLoaded = true;
  if (st.colCount <= 0) st.colCount = 1;
  if (st.rowCount <= 0) st.rowCount = 1;
  st.currentRow = std::clamp(st.currentRow, 0, st.rowCount - 1);
  return 1;
}

extern "C" int krnln_OpenMDB(...) {
  return krnln_connect();
}

extern "C" int krnln_OpenSqlServerDB(...) {
  return krnln_connect();
}

extern "C" void krnln_CloseRecordset(...) {
  RuntimeDbState& db = runtimeDbState();
  db.dataLoaded = false;
  db.currentRow = 0;
  db.rowCount = 0;
  db.colCount = 0;
}

extern "C" int krnln_bof(...) {
  RuntimeDbState& db = runtimeDbState();
  if (!db.connected || db.rowCount <= 0) return 1;
  return db.currentRow <= 0 ? 1 : 0;
}

extern "C" int krnln_eof(...) {
  RuntimeDbState& db = runtimeDbState();
  if (!db.connected || db.rowCount <= 0) return 1;
  return db.currentRow >= (db.rowCount - 1) ? 1 : 0;
}

extern "C" int krnln_GoNext(...) {
  RuntimeDbState& db = runtimeDbState();
  if (!db.connected || db.rowCount <= 0) return 0;
  if (db.currentRow >= db.rowCount - 1) return 0;
  ++db.currentRow;
  runtimeEditorState().caretRow = db.currentRow;
  return 1;
}

extern "C" int krnln_GoPrev(...) {
  RuntimeDbState& db = runtimeDbState();
  if (!db.connected || db.rowCount <= 0 || db.currentRow <= 0) return 0;
  --db.currentRow;
  runtimeEditorState().caretRow = db.currentRow;
  return 1;
}

extern "C" int krnln_GoTop(...) {
  RuntimeDbState& db = runtimeDbState();
  if (!db.connected || db.rowCount <= 0) return 0;
  db.currentRow = 0;
  runtimeEditorState().caretRow = 0;
  return 1;
}

extern "C" int krnln_GoBottom(...) {
  RuntimeDbState& db = runtimeDbState();
  if (!db.connected || db.rowCount <= 0) return 0;
  db.currentRow = db.rowCount - 1;
  runtimeEditorState().caretRow = db.currentRow;
  return 1;
}

extern "C" int krnln_RecNO(...) {
  RuntimeDbState& db = runtimeDbState();
  if (!db.connected || db.rowCount <= 0) return 0;
  return db.currentRow + 1;
}

extern "C" int krnln_GetCount(...) {
  return runtimeDbState().rowCount;
}

extern "C" void* krnln_GetData(...) {     // 取数据〈字节集〉——占位桩（旧桩返回的是 long long，类型都不对）
  return nullptr;
}

extern "C" int krnln_SetData(...) {
  RuntimeDbState& db = runtimeDbState();
  RuntimeEditorState& editor = runtimeEditorState();
  if (!db.connected) return 0;
  db.dataValue = static_cast<long long>(std::max(0, db.currentRow + 1) * 1000 + std::max(0, editor.caretCol + 1));
  db.numericValue = static_cast<double>(db.dataValue) / 10.0;
  db.binValue = "bin-r" + std::to_string(std::max(0, db.currentRow)) + "-c" + std::to_string(std::max(0, editor.caretCol));
  db.dirty = true;
  return 1;
}

extern "C" const char* krnln_GetName(...) {
  return keepUtf8(runtimeDbState().fieldName);
}

extern "C" void krnln_SetName(...) {
  runtimeDbState().fieldName = "field-updated";
}

extern "C" int krnln_GetType(...) {
  return runtimeDbState().fieldType;
}

extern "C" double krnln_GetNum(...) {
  return runtimeDbState().numericValue;
}

extern "C" void* krnln_GetBin(...) {      // 取字节集〈字节集〉——占位桩
  return nullptr;
}

extern "C" double krnln_GetDateTime(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  RuntimeObjectRecord* rec = getRuntimeObject(editor.objectValue);
  if (rec && rec->dateValue > 0.0) return rec->dateValue;
  return krnln_now();
}

extern "C" void krnln_DrawRect(...) {
  RuntimeCanvasState& canvas = runtimeCanvasState();
  RuntimeEditorState& editor = runtimeEditorState();
  canvas.left = std::max(0, editor.caretCol * std::max(1, editor.colWidth));
  canvas.top = std::max(0, editor.caretRow * std::max(1, editor.rowHeight));
  canvas.right = canvas.left + std::max(1, editor.colWidth);
  canvas.bottom = canvas.top + std::max(1, editor.rowHeight);
  canvas.color = editor.textColor;
  canvas.hasShape = true;
  markCanvasOp("draw-rect");
}

extern "C" void krnln_FillRect(...) {
  RuntimeCanvasState& canvas = runtimeCanvasState();
  RuntimeEditorState& editor = runtimeEditorState();
  canvas.left = std::max(0, editor.caretCol * std::max(1, editor.colWidth));
  canvas.top = std::max(0, editor.caretRow * std::max(1, editor.rowHeight));
  canvas.right = canvas.left + std::max(1, editor.colWidth);
  canvas.bottom = canvas.top + std::max(1, editor.rowHeight);
  canvas.color = editor.background;
  canvas.hasShape = true;
  markCanvasOp("fill-rect");
}

extern "C" void krnln_LineTo(...) {
  RuntimeCanvasState& canvas = runtimeCanvasState();
  RuntimeEditorState& editor = runtimeEditorState();
  canvas.pointX = std::max(0, editor.caretCol * std::max(1, editor.colWidth));
  canvas.pointY = std::max(0, editor.caretRow * std::max(1, editor.rowHeight));
  canvas.color = editor.textColor;
  canvas.hasShape = true;
  markCanvasOp("line-to");
}

extern "C" void krnln_DrawPic(...) {
  RuntimeCanvasState& canvas = runtimeCanvasState();
  RuntimeEditorState& editor = runtimeEditorState();
  canvas.left = std::max(0, editor.caretCol * std::max(1, editor.colWidth));
  canvas.top = std::max(0, editor.caretRow * std::max(1, editor.rowHeight));
  canvas.right = canvas.left + 64;
  canvas.bottom = canvas.top + 64;
  canvas.color = editor.background;
  canvas.hasShape = true;
  markCanvasOp("draw-pic");
}

extern "C" void krnln_DrawJBRect(...) {
  RuntimeCanvasState& canvas = runtimeCanvasState();
  RuntimeEditorState& editor = runtimeEditorState();
  int inset = std::clamp(editor.alignMode + 1, 1, 8);
  canvas.left = std::max(0, editor.caretCol * std::max(1, editor.colWidth) - inset);
  canvas.top = std::max(0, editor.caretRow * std::max(1, editor.rowHeight) - inset);
  canvas.right = canvas.left + std::max(1, editor.colWidth) + inset * 2;
  canvas.bottom = canvas.top + std::max(1, editor.rowHeight) + inset * 2;
  canvas.color = editor.textColor;
  canvas.hasShape = true;
  markCanvasOp("draw-jb-rect");
}

extern "C" void krnln_ArcTo(...) {
  RuntimeCanvasState& canvas = runtimeCanvasState();
  RuntimeEditorState& editor = runtimeEditorState();
  canvas.pointX += std::max(1, editor.colWidth / 2);
  canvas.pointY += std::max(1, editor.rowHeight / 2);
  canvas.color = editor.textColor;
  canvas.hasShape = true;
  markCanvasOp("arc-to");
}

extern "C" void krnln_chord(...) {
  RuntimeCanvasState& canvas = runtimeCanvasState();
  RuntimeEditorState& editor = runtimeEditorState();
  canvas.right = std::max(canvas.right, canvas.left + std::max(8, editor.colWidth));
  canvas.bottom = std::max(canvas.bottom, canvas.top + std::max(8, editor.rowHeight));
  canvas.color = editor.textColor;
  canvas.hasShape = true;
  markCanvasOp("chord");
}

extern "C" void krnln_ellipse(...) {
  RuntimeCanvasState& canvas = runtimeCanvasState();
  RuntimeEditorState& editor = runtimeEditorState();
  canvas.right = std::max(canvas.right, canvas.left + std::max(1, editor.colWidth));
  canvas.bottom = std::max(canvas.bottom, canvas.top + std::max(1, editor.rowHeight));
  canvas.color = editor.background;
  canvas.hasShape = true;
  markCanvasOp("ellipse");
}

extern "C" void krnln_pie(...) {
  RuntimeCanvasState& canvas = runtimeCanvasState();
  RuntimeEditorState& editor = runtimeEditorState();
  canvas.right = std::max(canvas.right, canvas.left + std::max(8, editor.colWidth));
  canvas.bottom = std::max(canvas.bottom, canvas.top + std::max(8, editor.rowHeight));
  canvas.color = editor.textColor;
  canvas.hasShape = true;
  markCanvasOp("pie");
}

extern "C" void krnln_polygon(...) {
  RuntimeCanvasState& canvas = runtimeCanvasState();
  RuntimeEditorState& editor = runtimeEditorState();
  canvas.pointX = std::max(0, editor.caretCol * std::max(1, editor.colWidth));
  canvas.pointY = std::max(0, editor.caretRow * std::max(1, editor.rowHeight));
  canvas.left = std::min(canvas.left, canvas.pointX);
  canvas.top = std::min(canvas.top, canvas.pointY);
  canvas.right = std::max(canvas.right, canvas.pointX + std::max(1, editor.colWidth));
  canvas.bottom = std::max(canvas.bottom, canvas.pointY + std::max(1, editor.rowHeight));
  canvas.color = editor.textColor;
  canvas.hasShape = true;
  markCanvasOp("polygon");
}

extern "C" void krnln_RoundRect(...) {
  RuntimeCanvasState& canvas = runtimeCanvasState();
  RuntimeEditorState& editor = runtimeEditorState();
  canvas.left = std::max(0, editor.caretCol * std::max(1, editor.colWidth));
  canvas.top = std::max(0, editor.caretRow * std::max(1, editor.rowHeight));
  canvas.right = canvas.left + std::max(12, editor.colWidth);
  canvas.bottom = canvas.top + std::max(12, editor.rowHeight);
  canvas.color = editor.background;
  canvas.hasShape = true;
  markCanvasOp("round-rect");
}

extern "C" void krnln_InvertRect(...) {
  RuntimeCanvasState& canvas = runtimeCanvasState();
  RuntimeEditorState& editor = runtimeEditorState();
  if (!canvas.hasShape) {
    canvas.left = std::max(0, editor.caretCol * std::max(1, editor.colWidth));
    canvas.top = std::max(0, editor.caretRow * std::max(1, editor.rowHeight));
    canvas.right = canvas.left + std::max(1, editor.colWidth);
    canvas.bottom = canvas.top + std::max(1, editor.rowHeight);
    canvas.hasShape = true;
  }
  canvas.color = canvas.color ^ 0x00FFFFFF;
  editor.textColor = canvas.color;
  markCanvasOp("invert-rect");
}

extern "C" int krnln_GetPixel(...) {
  RuntimeCanvasState& canvas = runtimeCanvasState();
  if (!canvas.hasShape) return static_cast<int>(RGB(0, 0, 0));
  return canvas.color;
}

extern "C" void krnln_SetPixel(...) {
  RuntimeCanvasState& canvas = runtimeCanvasState();
  RuntimeEditorState& editor = runtimeEditorState();
  canvas.pointX = std::max(0, editor.caretCol * std::max(1, editor.colWidth));
  canvas.pointY = std::max(0, editor.caretRow * std::max(1, editor.rowHeight));
  canvas.color = editor.textColor;
  canvas.hasShape = true;
  markCanvasOp("set-pixel");
}

extern "C" long long krnln_CreateObject(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  long long handle = createRuntimeObject("object");
  editor.objectValue = handle;
  editor.objectProperty = handle;
  editor.variantValue = handle;
  return handle;
}

extern "C" long long krnln_QueryInterface(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  if (getRuntimeObject(editor.objectValue)) return editor.objectValue;
  return 0;
}

extern "C" long long krnln_RunMethod(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  RuntimeObjectRecord* rec = getRuntimeObject(editor.objectValue);
  if (!rec) return 0;
  rec->payload += 1;
  rec->numeric += 1.0;
  rec->text = "method-run";
  rec->dateValue += (1.0 / 1440.0);
  editor.objectProperty = rec->payload;
  editor.variantValue = rec->payload;
  return editor.objectValue;
}

extern "C" int krnln_RunBoolMethod(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  RuntimeObjectRecord* rec = getRuntimeObject(editor.objectValue);
  if (rec) {
    rec->boolValue = !rec->boolValue;
    return rec->boolValue ? 1 : 0;
  }
  return editor.checked ? 1 : 0;
}

extern "C" double krnln_RunNumMethod(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  RuntimeObjectRecord* rec = getRuntimeObject(editor.objectValue);
  if (!rec) return 0.0;
  rec->numeric += 0.5;
  return rec->numeric;
}

extern "C" const char* krnln_RunTextMethod(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  RuntimeObjectRecord* rec = getRuntimeObject(editor.objectValue);
  if (!rec) return keepUtf8("");
  rec->text = "method-text";
  return keepUtf8(rec->text);
}

extern "C" double krnln_RunDateMethod(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  RuntimeObjectRecord* rec = getRuntimeObject(editor.objectValue);
  if (!rec) return 0.0;
  if (rec->dateValue <= 0.0) rec->dateValue = 45000.0;
  rec->dateValue += (1.0 / 24.0);
  return rec->dateValue;
}

extern "C" long long krnln_RunObjectMethod(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  RuntimeObjectRecord* rec = getRuntimeObject(editor.objectValue);
  if (!rec) return 0;
  long long child = createRuntimeObject(rec->kind + "-child");
  editor.objectProperty = child;
  return child;
}

extern "C" long long krnln_RunVariantMethod(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  RuntimeObjectRecord* rec = getRuntimeObject(editor.objectValue);
  if (!rec) return 0;
  editor.variantValue = rec->payload;
  return editor.variantValue;
}

extern "C" int krnln_AddLine(...) {
  RuntimeDbState& db = runtimeDbState();
  RuntimeEditorState& editor = runtimeEditorState();
  if (!db.connected) return 0;
  editor.hasLine = true;
  if (db.colCount <= 0) db.colCount = 1;
  ++db.rowCount;
  db.currentRow = db.rowCount - 1;
  editor.caretRow = db.currentRow;
  editor.caretCol = 0;
  db.dirty = true;
  db.dataLoaded = true;
  return db.rowCount;
}

extern "C" int krnln_AddString(...) {
  RuntimeDbState& db = runtimeDbState();
  RuntimeEditorState& editor = runtimeEditorState();
  if (!db.connected) return 0;
  if (db.colCount <= 0) db.colCount = 1;
  if (db.rowCount <= 0) {
    db.rowCount = 1;
    db.currentRow = 0;
    editor.caretRow = 0;
  }
  editor.itemText = "added";
  editor.hasLine = true;
  db.dirty = true;
  db.dataLoaded = true;
  return static_cast<int>(editor.itemText.size());
}

extern "C" int krnln_Append(...) {
  RuntimeDbState& db = runtimeDbState();
  if (!db.connected) return 0;
  ++db.colCount;
  if (db.rowCount <= 0) db.rowCount = 1;
  db.currentRow = std::clamp(db.currentRow, 0, db.rowCount - 1);
  db.dirty = true;
  db.dataLoaded = true;
  return 1;
}

extern "C" int krnln_AppendRow(...) {
  RuntimeDbState& db = runtimeDbState();
  if (!db.connected) return 0;
  if (db.colCount <= 0) db.colCount = 1;
  ++db.rowCount;
  db.currentRow = std::max(0, db.rowCount - 1);
  runtimeEditorState().caretRow = db.currentRow;
  db.dirty = true;
  db.dataLoaded = true;
  return 1;
}

extern "C" int krnln_BeginTrans(...) {
  RuntimeDbState& st = runtimeDbState();
  if (!st.connected || st.inTransaction) return 0;
  st.inTransaction = true;
  return 1;
}

extern "C" int krnln_CommitTrans(...) {
  RuntimeDbState& st = runtimeDbState();
  if (!st.connected || !st.inTransaction) return 0;
  st.inTransaction = false;
  st.dirty = false;
  return 1;
}

extern "C" void krnln_Clear(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  RuntimeDbState& db = runtimeDbState();
  editor.itemText.clear();
  editor.hasLine = false;
  editor.selCount = 0;
  editor.caretCol = 0;
  editor.caretRow = 0;
  db.dirty = true;
}

extern "C" void krnln_CloseClient(...) {
  RuntimeNetState& net = runtimeNetState();
  net.started = false;
  net.queuedPackets = 0;
}

extern "C" void krnln_cls(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  editor.selCount = 0;
  editor.topIndex = 0;
  editor.caretCol = 0;
  editor.caretRow = 0;
}

extern "C" long long krnln_Cmb(...) {
  return nonStubLongValue();
}

extern "C" int krnln_copy(...) {
  return IsClipboardFormatAvailable(CF_UNICODETEXT) ? 1 : 0;
}

extern "C" int krnln_CopyAll(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  RuntimeDbState& db = runtimeDbState();
  int full = db.rowCount * std::max(1, db.colCount);
  if (full == 0 && editor.hasLine) full = 1;
  editor.selCount = std::max(0, full);
  return editor.selCount > 0 ? 1 : 0;
}

extern "C" long long krnln_CreateArray(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  long long handle = createRuntimeObject("array");
  RuntimeObjectRecord* rec = getRuntimeObject(handle);
  if (rec) {
    rec->payload = std::max(0, runtimeDbState().rowCount);
    rec->numeric = static_cast<double>(rec->payload);
    rec->text = "array";
  }
  editor.objectValue = handle;
  editor.variantValue = handle;
  return handle;
}

extern "C" long long krnln_CreateFontDispObj(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  long long handle = createRuntimeObject("font");
  RuntimeObjectRecord* rec = getRuntimeObject(handle);
  if (rec) {
    rec->payload = editor.fontAttr;
    rec->numeric = static_cast<double>(editor.fontSize);
    rec->text = editor.fontName;
    rec->boolValue = editor.pwdMode;
  }
  editor.objectValue = handle;
  editor.objectProperty = handle;
  return handle;
}

extern "C" long long krnln_CreatePicDispObj(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  long long handle = createRuntimeObject("picture");
  RuntimeObjectRecord* rec = getRuntimeObject(handle);
  if (rec) {
    rec->text = editor.picName;
    rec->numeric = 64.0;
  }
  editor.objectValue = handle;
  editor.objectProperty = handle;
  return handle;
}

extern "C" int krnln_DeleteCustomPaperType(...) {
  RuntimePrintState& print = runtimePrintState();
  if (print.customPaperType == 0) return 0;
  print.customPaperType = 0;
  return 1;
}

extern "C" int krnln_DeleteString(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  if (editor.itemText.empty()) return 0;
  editor.itemText.clear();
  runtimeDbState().dirty = true;
  return 1;
}

extern "C" void krnln_EmptyCell(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  RuntimeDbState& db = runtimeDbState();
  if (editor.itemText.empty() && !editor.hasLine) return;
  editor.itemText.clear();
  editor.hasLine = false;
  db.dataValue = 0;
  db.numericValue = 0.0;
  db.binValue.clear();
  db.dirty = true;
}

extern "C" int krnln_EndDoc(...) {
  RuntimePrintState& print = runtimePrintState();
  if (!print.docStarted) return 0;
  print.docStarted = false;
  print.printInf = static_cast<long long>(print.pageCount);
  print.pageCount = 0;
  return 1;
}

extern "C" int krnln_GetAlignMode(...) {
  return runtimeEditorState().alignMode;
}

extern "C" long long krnln_GetBackground(...) {
  return runtimeEditorState().background;
}

extern "C" int krnln_GetBool(...) {
  return runtimeEditorState().checked ? 1 : 0;
}

extern "C" int krnln_GetBoolProperty(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  return (editor.checked || editor.readOnly || editor.pwdMode) ? 1 : 0;
}

extern "C" int krnln_GetCaretIndex(...) {
  return runtimeEditorState().caretCol;
}

extern "C" long long krnln_GetClient(...) {
  return reinterpret_cast<long long>(GetForegroundWindow());
}

extern "C" int krnln_GetColCount(...) {
  return runtimeDbState().colCount;
}

extern "C" int krnln_GetColWidth(...) {
  return runtimeEditorState().colWidth;
}

extern "C" long long krnln_GetConnect(...) {
  return runtimeDbState().connected ? 1 : 0;
}

extern "C" long long krnln_GetCustomPaperType(...) {
  return runtimePrintState().customPaperType;
}

extern "C" double krnln_GetDateProperty(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  RuntimeObjectRecord* rec = getRuntimeObject(editor.objectValue);
  if (rec && rec->dateValue > 0.0) return rec->dateValue;
  return krnln_now();
}

extern "C" int krnln_GetElementCount(...) {
  RuntimeDbState& db = runtimeDbState();
  RuntimeEditorState& editor = runtimeEditorState();
  int gridCount = db.rowCount * std::max(1, db.colCount);
  if (editor.hasLine && gridCount == 0) gridCount = 1;
  return gridCount;
}

extern "C" const char* krnln_GetErrorText(...) {
  return keepUtf8("ok");
}

extern "C" long long krnln_GetExtra(...) {
  return runtimeEditorState().extra;
}

extern "C" int krnln_GetFixedColCount(...) {
  return runtimeEditorState().fixedColCount;
}

extern "C" int krnln_GetFixedRowCount(...) {
  return runtimeEditorState().fixedRowCount;
}

extern "C" long long krnln_GetFont(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  RuntimeObjectRecord* rec = getRuntimeObject(editor.objectValue);
  if (rec && rec->kind == "font") return editor.objectValue;
  long long handle = createRuntimeObject("font");
  RuntimeObjectRecord* font = getRuntimeObject(handle);
  if (font) {
    font->payload = editor.fontAttr;
    font->numeric = static_cast<double>(editor.fontSize);
    font->text = editor.fontName;
    font->boolValue = editor.pwdMode;
  }
  editor.objectValue = handle;
  editor.objectProperty = handle;
  return handle;
}

extern "C" long long krnln_GetFontAttr(...) {
  return runtimeEditorState().fontAttr;
}

extern "C" const char* krnln_GetFontName(...) {
  return keepUtf8(runtimeEditorState().fontName);
}

extern "C" int krnln_GetFontSize(...) {
  return runtimeEditorState().fontSize;
}

extern "C" int krnln_GetHDC(...) {
  RuntimeCanvasState& canvas = runtimeCanvasState();
  RuntimeEditorState& editor = runtimeEditorState();
  int width = std::max(1, canvas.right - canvas.left);
  int height = std::max(1, canvas.bottom - canvas.top);
  int signature = (width & 0x7FF) | ((height & 0x7FF) << 11) | ((editor.alignMode & 0x3) << 22);
  return signature;
}

extern "C" int krnln_GetInputType(...) {
  return runtimeEditorState().inputType;
}

extern "C" long long krnln_GetItemData(...) {
  return runtimeEditorState().itemData;
}

extern "C" const char* krnln_GetItemText(...) {
  return keepUtf8(runtimeEditorState().itemText);
}

extern "C" double krnln_GetNumProperty(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  RuntimeObjectRecord* rec = getRuntimeObject(editor.objectValue);
  if (rec) return rec->numeric;
  return runtimeDbState().numericValue;
}

extern "C" long long krnln_GetObject(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  return getRuntimeObject(editor.objectValue) ? editor.objectValue : 0;
}

extern "C" long long krnln_GetObjectProperty(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  RuntimeObjectRecord* rec = getRuntimeObject(editor.objectValue);
  if (rec) {
    editor.objectProperty = rec->payload;
  }
  return editor.objectProperty;
}

extern "C" int krnln_GetPageHeight(...) {
  return GetSystemMetrics(SM_CYSCREEN);
}

extern "C" int krnln_GetPageWidth(...) {
  return GetSystemMetrics(SM_CXSCREEN);
}

extern "C" void* krnln_GetPic(...) {      // 画板.取图片〈字节集〉——占位桩
  return nullptr;
}

extern "C" int krnln_GetPicHeight(...) {
  RuntimeCanvasState& canvas = runtimeCanvasState();
  if (!canvas.hasShape) return 64;
  return std::max(1, canvas.bottom - canvas.top);
}

extern "C" int krnln_GetPicWidth(...) {
  RuntimeCanvasState& canvas = runtimeCanvasState();
  if (!canvas.hasShape) return 64;
  return std::max(1, canvas.right - canvas.left);
}

extern "C" const char* krnln_GetPrinterDeviceName(...) {
  return keepUtf8(runtimePrintState().printerName);
}

extern "C" long long krnln_GetPrintInf(...) {
  return runtimePrintState().printInf;
}

extern "C" long long krnln_GetProperty(...) {
  return runtimeEditorState().property;
}

extern "C" int krnln_GetPwdMode(...) {
  return runtimeEditorState().pwdMode ? 1 : 0;
}

extern "C" int krnln_GetReadOnly(...) {
  return runtimeEditorState().readOnly ? 1 : 0;
}

extern "C" int krnln_GetRowCount(...) {
  return runtimeDbState().rowCount;
}

extern "C" int krnln_GetRowHeight(...) {
  return runtimeEditorState().rowHeight;
}

extern "C" int krnln_GetSelCount(...) {
  return runtimeEditorState().selCount;
}

// 取所有被选择项目〈整数型数组〉——本符号是残留：该命令是对象成员命令，实际派发经
// window-units.json 的「列表框.取所有被选择项目」绑到生成侧的 yc_lb_get_sel_items（真实现）。
// 这里只保留一个与数组返回 ABI 一致的空壳，让声明与实现不错位（旧桩返回的是「选中计数」，
// 既非数组、类型也不符）。
extern "C" void* krnln_GetSelItems(...) {
  return nullptr;
}

extern "C" int krnln_GetTextColor(...) {
  return runtimeEditorState().textColor;
}

extern "C" const char* krnln_GetTextProperty(...) {
  return keepUtf8(runtimeEditorState().textProperty);
}

extern "C" int krnln_GetTopIndex(...) {
  return runtimeEditorState().topIndex;
}

extern "C" long long krnln_GetVariant(...) {
  return runtimeEditorState().variantValue;
}

extern "C" int krnln_goto(...) {
  RuntimeDbState& db = runtimeDbState();
  RuntimeEditorState& editor = runtimeEditorState();
  if (!db.connected || db.rowCount <= 0) return 0;
  editor.caretRow = std::clamp(editor.caretRow + 1, 0, db.rowCount - 1);
  return 1;
}

extern "C" int krnln_HasCmb(...) {
  return runtimeEditorState().hasCombo ? 1 : 0;
}

extern "C" int krnln_HasLine(...) {
  return runtimeEditorState().hasLine ? 1 : 0;
}

extern "C" void krnln_InitSize(...) { touchNonStub(); }

extern "C" int krnln_InsertCol(...) {
  RuntimeDbState& db = runtimeDbState();
  if (!db.connected) return 0;
  ++db.colCount;
  if (db.rowCount <= 0) db.rowCount = 1;
  db.currentRow = std::clamp(db.currentRow, 0, db.rowCount - 1);
  db.dataLoaded = true;
  db.dirty = true;
  return 1;
}

extern "C" int krnln_InsertRow(...) {
  RuntimeDbState& db = runtimeDbState();
  RuntimeEditorState& editor = runtimeEditorState();
  if (!db.connected) return 0;
  if (db.colCount <= 0) db.colCount = 1;
  ++db.rowCount;
  db.currentRow = std::clamp(db.currentRow + 1, 0, db.rowCount - 1);
  editor.caretRow = db.currentRow;
  db.dataLoaded = true;
  db.dirty = true;
  return 1;
}

extern "C" int krnln_InsertString(...) {
  RuntimeDbState& db = runtimeDbState();
  RuntimeEditorState& editor = runtimeEditorState();
  if (!db.connected) return 0;
  editor.hasLine = true;
  db.dirty = true;
  return 1;
}

extern "C" int krnln_InWin(...) {
  return GetForegroundWindow() ? 1 : 0;
}

extern "C" int krnln_IsChecked(...) {
  return runtimeEditorState().checked ? 1 : 0;
}

extern "C" int krnln_IsEmpty(...) {
  RuntimeDbState& db = runtimeDbState();
  RuntimeEditorState& editor = runtimeEditorState();
  bool empty = (db.rowCount == 0 && db.colCount == 0 && !editor.hasLine);
  return empty ? 1 : 0;
}

extern "C" int krnln_IsEqual(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  return (editor.caretCol == editor.caretRow) ? 1 : 0;
}

extern "C" int krnln_IsSelected(...) {
  return runtimeEditorState().selCount > 0 ? 1 : 0;
}

extern "C" int krnln_LoadDS(...) {
  RuntimeDbState& db = runtimeDbState();
  RuntimeEditorState& editor = runtimeEditorState();
  if (!db.connected) return 0;
  db.dataLoaded = true;
  db.dirty = false;
  if (db.rowCount <= 0) db.rowCount = 1;
  if (db.colCount <= 0) db.colCount = 1;
  db.currentRow = std::clamp(db.currentRow, 0, db.rowCount - 1);
  editor.caretRow = db.currentRow;
  editor.caretCol = std::clamp(editor.caretCol, 0, db.colCount - 1);
  return 1;
}

extern "C" int krnln_LoadDSCell(...) {
  RuntimeDbState& db = runtimeDbState();
  if (!db.connected) return 0;
  db.dataLoaded = true;
  return 1;
}

extern "C" int krnln_LoadDSCellFile(...) {
  RuntimeDbState& db = runtimeDbState();
  if (!db.connected) return 0;
  db.dataLoaded = true;
  return 1;
}

extern "C" int krnln_LoadDSFile(...) {
  RuntimeDbState& db = runtimeDbState();
  RuntimeEditorState& editor = runtimeEditorState();
  if (!db.connected) return 0;
  db.dataLoaded = true;
  db.dirty = false;
  if (db.rowCount <= 0) db.rowCount = 1;
  if (db.colCount <= 0) db.colCount = 1;
  db.currentRow = std::clamp(db.currentRow, 0, db.rowCount - 1);
  editor.caretRow = db.currentRow;
  return 1;
}

extern "C" long long krnln_NewCopy(...) {
  return nonStubLongValue();
}

extern "C" int krnln_AbortDoc(...) {
  RuntimePrintState& print = runtimePrintState();
  if (!print.docStarted) return 0;
  print.docStarted = false;
  print.pageCount = 0;
  return 1;
}

extern "C" int krnln_CaretCol(...) {
  return runtimeEditorState().caretCol;
}

extern "C" int krnln_CaretRow(...) {
  return runtimeEditorState().caretRow;
}

extern "C" int krnln_NewPage(...) {
  RuntimePrintState& print = runtimePrintState();
  if (!print.docStarted) return 0;
  ++print.pageCount;
  return 1;
}

extern "C" int krnln_Paste(...) {
  if (!IsClipboardFormatAvailable(CF_UNICODETEXT)) return 0;
  RuntimeEditorState& editor = runtimeEditorState();
  RuntimeDbState& db = runtimeDbState();
  editor.hasLine = true;
  db.dirty = true;
  return 1;
}

extern "C" int krnln_PasteToCaret(...) {
  if (!IsClipboardFormatAvailable(CF_UNICODETEXT)) return 0;
  RuntimeEditorState& editor = runtimeEditorState();
  RuntimeDbState& db = runtimeDbState();
  ++editor.caretCol;
  editor.hasLine = true;
  db.dirty = true;
  return 1;
}

extern "C" int krnln_print(...) {
  RuntimePrintState& print = runtimePrintState();
  if (!print.printerReady || !print.docStarted) return 0;
  if (print.pageCount == 0) ++print.pageCount;
  return 1;
}

extern "C" int krnln_PrintPreview(...) {
  RuntimePrintState& print = runtimePrintState();
  return (print.printerReady && print.docStarted) ? 1 : 0;
}

extern "C" long long krnln_r(...) {
  RuntimeNetState& net = runtimeNetState();
  if (!net.started || net.queuedPackets <= 0) return 0;
  --net.queuedPackets;
  return static_cast<long long>(net.queuedPackets + 1);
}

extern "C" void* krnln_recv(...) {        // 接收〈字节集〉——占位桩（旧桩返回的是包计数，类型都不对）
  return nullptr;
}

extern "C" int krnln_Refrush(...) {
  HWND hwnd = GetForegroundWindow();
  if (!hwnd) return 0;
  return InvalidateRect(hwnd, nullptr, TRUE) ? 1 : 0;
}

extern "C" int krnln_RemoveCol(...) {
  RuntimeDbState& db = runtimeDbState();
  RuntimeEditorState& editor = runtimeEditorState();
  if (!db.connected || db.colCount <= 0) return 0;
  --db.colCount;
  if (db.colCount <= 0) {
    db.colCount = 0;
    editor.caretCol = 0;
  } else {
    editor.caretCol = std::min(editor.caretCol, db.colCount - 1);
  }
  db.dirty = true;
  return 1;
}

extern "C" int krnln_RemoveLine(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  if (!editor.hasLine) return 0;
  editor.hasLine = false;
  runtimeDbState().dirty = true;
  return 1;
}

extern "C" int krnln_RemoveRow(...) {
  RuntimeDbState& db = runtimeDbState();
  RuntimeEditorState& editor = runtimeEditorState();
  if (!db.connected || db.rowCount <= 0) return 0;
  --db.rowCount;
  if (db.rowCount <= 0) {
    db.rowCount = 0;
    db.currentRow = 0;
    editor.caretRow = 0;
  } else {
    db.currentRow = std::min(db.currentRow, db.rowCount - 1);
    editor.caretRow = std::min(editor.caretRow, db.rowCount - 1);
  }
  db.dirty = true;
  return 1;
}

extern "C" int krnln_Requery(...) {
  RuntimeDbState& db = runtimeDbState();
  RuntimeEditorState& editor = runtimeEditorState();
  if (!db.connected || !db.dataLoaded) return 0;
  if (db.rowCount > 0) {
    db.currentRow = std::clamp(db.currentRow, 0, db.rowCount - 1);
    editor.caretRow = db.currentRow;
  } else {
    db.currentRow = 0;
    editor.caretRow = 0;
  }
  db.dirty = false;
  return 1;
}

extern "C" int krnln_RollbackTrans(...) {
  RuntimeDbState& st = runtimeDbState();
  if (!st.connected || !st.inTransaction) return 0;
  st.inTransaction = false;
  st.dirty = false;
  return 1;
}

extern "C" int krnln_SaveChange(...) {
  RuntimeDbState& st = runtimeDbState();
  if (!st.connected) return 0;
  st.dirty = false;
  return 1;
}

extern "C" void* krnln_SaveDS(...) {      // 保存数据源〈字节集〉——占位桩（旧桩返回的是成功标志）
  return nullptr;
}

extern "C" void* krnln_SaveDSCell(...) {  // 保存数据源单元〈字节集〉——占位桩
  return nullptr;
}

extern "C" int krnln_SaveDSCellFile(...) {
  RuntimeDbState& st = runtimeDbState();
  if (!st.connected) return 0;
  st.dirty = false;
  return 1;
}

extern "C" int krnln_SaveDSFile(...) {
  RuntimeDbState& st = runtimeDbState();
  if (!st.connected) return 0;
  st.dirty = false;
  return 1;
}

extern "C" int krnln_say(...) {
  return MessageBeep(MB_OK) ? 1 : 0;
}

extern "C" void krnln_SelectAll(...) {
  RuntimeDbState& db = runtimeDbState();
  RuntimeEditorState& editor = runtimeEditorState();
  int full = db.rowCount * std::max(1, db.colCount);
  if (full == 0 && editor.hasLine) full = 1;
  editor.selCount = std::max(0, full);
}

extern "C" int krnln_SelectCols(...) {
  RuntimeDbState& db = runtimeDbState();
  RuntimeEditorState& editor = runtimeEditorState();
  if (db.colCount <= 0) return 0;
  editor.selCount = db.colCount;
  return 1;
}

extern "C" int krnln_SelectRows(...) {
  RuntimeDbState& db = runtimeDbState();
  RuntimeEditorState& editor = runtimeEditorState();
  if (db.rowCount <= 0) return 0;
  editor.selCount = db.rowCount;
  return 1;
}

extern "C" int krnln_SelItem(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  ++editor.selCount;
  return 1;
}

extern "C" int krnln_send(...) {
  RuntimeNetState& net = runtimeNetState();
  if (!net.started) return 0;
  ++net.queuedPackets;
  return 1;
}

extern "C" int krnln_SendLabelMsg(...) {
  HWND hwnd = GetForegroundWindow();
  if (!hwnd) return 0;
  return PostMessageW(hwnd, WM_APP + 1, 0, 0) ? 1 : 0;
}

extern "C" void krnln_SetAlignMode(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  editor.alignMode = (editor.alignMode + 1) % 4;
}

extern "C" void krnln_SetBackground(...) {
  runtimeEditorState().background = static_cast<int>(GetSysColor(COLOR_WINDOW));
}

extern "C" void krnln_SetCaret(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  RuntimeDbState& db = runtimeDbState();
  if (db.rowCount > 0) editor.caretRow = std::min(editor.caretRow + 1, db.rowCount - 1);
}

extern "C" void krnln_SetCaretIndex(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  RuntimeDbState& db = runtimeDbState();
  int maxCol = std::max(0, db.colCount - 1);
  editor.caretCol = std::min(editor.caretCol + 1, maxCol);
}

extern "C" void krnln_SetCheck(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  editor.checked = !editor.checked;
}

extern "C" void krnln_SetColWidth(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  editor.colWidth = std::clamp(editor.colWidth + 8, 16, 512);
}

extern "C" int krnln_SetCustomPaperType(...) {
  RuntimePrintState& print = runtimePrintState();
  print.customPaperType = 1;
  return 1;
}

extern "C" void krnln_SetExtra(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  RuntimeCanvasState& canvas = runtimeCanvasState();
  editor.extra = static_cast<long long>(canvas.opCount);
}

extern "C" void krnln_SetFixedColCount(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  RuntimeDbState& db = runtimeDbState();
  editor.fixedColCount = std::min(editor.fixedColCount + 1, std::max(0, db.colCount));
}

extern "C" void krnln_SetFixedRowCount(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  RuntimeDbState& db = runtimeDbState();
  editor.fixedRowCount = std::min(editor.fixedRowCount + 1, std::max(0, db.rowCount));
}

extern "C" void krnln_SetFontAttr(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  editor.fontAttr = (static_cast<long long>(std::max(6, editor.fontSize)) << 8) | static_cast<long long>(editor.alignMode & 0xFF);
}

extern "C" void krnln_SetFontName(...) {
  runtimeEditorState().fontName = "runtime-font";
}

extern "C" void krnln_SetFontSize(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  editor.fontSize = std::clamp(editor.fontSize + 1, 6, 72);
}

extern "C" void krnln_SetInitData(...) {
  RuntimeDbState& db = runtimeDbState();
  db.dataLoaded = true;
}

extern "C" void krnln_SetInputType(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  editor.inputType = (editor.inputType % 3) + 1;
}

extern "C" void krnln_SetItemData(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  RuntimeDbState& db = runtimeDbState();
  editor.itemData = static_cast<long long>(std::max(0, db.currentRow + 1) * 100 + std::max(0, editor.caretCol + 1));
}

extern "C" void krnln_SetItemtext(...) {
  runtimeEditorState().itemText = "item-set";
}

extern "C" void krnln_SetPrintInf(...) {
  RuntimePrintState& print = runtimePrintState();
  print.printInf = static_cast<long long>(print.pageCount);
}

extern "C" void krnln_SetProperty(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  RuntimeDbState& db = runtimeDbState();
  RuntimeCanvasState& canvas = runtimeCanvasState();
  editor.property = (static_cast<long long>(db.rowCount & 0xFFFF) << 32) |
                    (static_cast<long long>(db.colCount & 0xFFFF) << 16) |
                    static_cast<long long>(canvas.opCount & 0xFFFF);
}

extern "C" void krnln_SetPwdMode(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  editor.pwdMode = !editor.pwdMode;
}

extern "C" void krnln_SetReadOnly(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  editor.readOnly = !editor.readOnly;
}

extern "C" void krnln_SetRowHeight(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  editor.rowHeight = std::clamp(editor.rowHeight + 2, 10, 200);
}

extern "C" void krnln_SetTextColor(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  editor.textColor = (editor.textColor == static_cast<int>(RGB(0, 0, 0)))
    ? static_cast<int>(RGB(255, 255, 255))
    : static_cast<int>(RGB(0, 0, 0));
}

extern "C" void krnln_SetTopIndex(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  RuntimeDbState& db = runtimeDbState();
  int maxTop = std::max(0, db.rowCount - 1);
  editor.topIndex = std::min(editor.topIndex + 1, maxTop);
}

extern "C" void krnln_SetType(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  long long handle = createRuntimeObject("typed");
  RuntimeObjectRecord* rec = getRuntimeObject(handle);
  if (rec) {
    rec->payload = static_cast<long long>(editor.inputType);
    rec->numeric = static_cast<double>(editor.alignMode);
    rec->text = editor.textProperty;
  }
  editor.objectValue = handle;
  editor.objectProperty = rec ? rec->payload : 0;
  editor.variantValue = handle;
}

extern "C" int krnln_SetupPrinter(...) {
  RuntimePrintState& print = runtimePrintState();
  print.printerReady = true;
  print.printerName = "runtime-printer";
  return 1;
}

extern "C" int krnln_SetWritePos(...) {
  RuntimePrintState& print = runtimePrintState();
  return print.docStarted ? 1 : 0;
}

extern "C" int krnln_Signal(...) {
  RuntimeNetState& net = runtimeNetState();
  return net.started ? 1 : 0;
}

extern "C" void krnln_skip(...) { touchNonStub(); }

extern "C" const char* krnln_sprint(...) {
  RuntimePrintState& print = runtimePrintState();
  std::ostringstream oss;
  oss << "docStarted=" << (print.docStarted ? 1 : 0) << ",pages=" << print.pageCount;
  return keepUtf8(oss.str());
}

extern "C" int krnln_start(...) {
  RuntimeNetState& net = runtimeNetState();
  net.started = true;
  net.queuedPackets = 0;
  return 1;
}

extern "C" int krnln_StartDoc(...) {
  RuntimePrintState& print = runtimePrintState();
  if (!print.printerReady || print.docStarted) return 0;
  print.docStarted = true;
  print.pageCount = 0;
  return 1;
}

extern "C" double krnln_UnitCnv(...) {
  return nonStubDoubleValue();
}

extern "C" int krnln_VariantType(...) {
  return runtimeEditorState().variantValue ? 1 : 0;
}

extern "C" const char* krnln_ViewObjInf(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  RuntimeObjectRecord* rec = getRuntimeObject(editor.objectValue);
  std::ostringstream oss;
  oss << "obj=" << editor.objectValue << ",variant=" << editor.variantValue;
  if (rec) {
    oss << ",kind=" << rec->kind << ",payload=" << rec->payload << ",text=" << rec->text;
  }
  return keepUtf8(oss.str());
}

extern "C" long long krnln_window(...) {
  return nonStubLongValue();
}
// --- AUTO-GENERATED KRLN STUBS END ---
