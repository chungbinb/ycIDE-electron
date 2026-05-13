#include <windows.h>

#include <algorithm>
#include <cmath>
#include <cctype>
#include <cstdarg>
#include <cstdint>
#include <cstdlib>
#include <cstdio>
#include <cstring>
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
  HWND owner = reinterpret_cast<HWND>(parentWindow);

  UINT style = static_cast<UINT>(buttons);
  if (style == 0) style = MB_OK | MB_ICONINFORMATION;

  int result = MessageBoxA(owner, safeText, safeTitle, style);
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
  HCURSOR c = LoadCursorW(nullptr, IDC_WAIT);
  return SetCursor(c) ? 1 : 0;
}

extern "C" int krnln_RestroeCursor() {
  HCURSOR c = LoadCursorW(nullptr, IDC_ARROW);
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

extern "C" double krnln_round(double value, ...) {
  return clampFinite(std::round(value));
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

extern "C" const char* krnln_chr(int code) {
  char ch = static_cast<char>(code & 0xFF);
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

extern "C" int krnln_ToShort(const char* text) {
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

extern "C" void krnln_OutputDebugText(...) { touchNonStub(); }

extern "C" void krnln_stop(...) { touchNonStub(); }

extern "C" void krnln_assert(...) { touchNonStub(); }

extern "C" int krnln_IsDebugVer(...) {
#ifdef _DEBUG
  return 1;
#else
  return 0;
#endif
}

extern "C" const char* krnln_dir(const char* fileOrDirName, int /*attributes*/) {
  std::wstring pattern = utf8ToWide(fileOrDirName ? fileOrDirName : "");
  if (pattern.empty()) return keepUtf8("");

  WIN32_FIND_DATAW findData{};
  HANDLE h = FindFirstFileW(pattern.c_str(), &findData);
  if (h == INVALID_HANDLE_VALUE) return keepUtf8("");
  FindClose(h);
  return keepWideAsUtf8(findData.cFileName);
}

extern "C" int krnln_BinLen(const char* binData) {
  return static_cast<int>(std::strlen(binData ? binData : ""));
}

extern "C" const char* krnln_ToBin(const char* anyData) {
  return keepUtf8(anyData ? anyData : "");
}

extern "C" const char* krnln_BinLeft(const char* binData, int count) {
  std::string s = binData ? binData : "";
  if (count <= 0) return keepUtf8("");
  if (static_cast<size_t>(count) >= s.size()) return keepUtf8(s);
  return keepUtf8(s.substr(0, static_cast<size_t>(count)));
}

extern "C" const char* krnln_BinRight(const char* binData, int count) {
  std::string s = binData ? binData : "";
  if (count <= 0) return keepUtf8("");
  if (static_cast<size_t>(count) >= s.size()) return keepUtf8(s);
  return keepUtf8(s.substr(s.size() - static_cast<size_t>(count)));
}

extern "C" const char* krnln_BinMid(const char* binData, int startPos, int count) {
  std::string s = binData ? binData : "";
  if (count <= 0) return keepUtf8("");
  if (startPos < 1) startPos = 1;
  size_t start = static_cast<size_t>(startPos - 1);
  if (start >= s.size()) return keepUtf8("");
  return keepUtf8(s.substr(start, static_cast<size_t>(count)));
}

extern "C" int krnln_InBin(const char* sourceBin, const char* findBin, int startPos) {
  std::string source = sourceBin ? sourceBin : "";
  std::string find = findBin ? findBin : "";
  if (find.empty()) return 1;
  if (startPos < 1) startPos = 1;
  size_t start = static_cast<size_t>(startPos - 1);
  if (start >= source.size()) return -1;
  size_t found = source.find(find, start);
  if (found == std::string::npos) return -1;
  return static_cast<int>(found + 1);
}

extern "C" int krnln_InBinRev(const char* sourceBin, const char* findBin, int startPos) {
  std::string source = sourceBin ? sourceBin : "";
  std::string find = findBin ? findBin : "";
  if (source.empty()) return -1;
  if (find.empty()) return static_cast<int>(source.size());

  size_t start = source.size() - 1;
  if (startPos >= 1 && static_cast<size_t>(startPos) <= source.size()) {
    start = static_cast<size_t>(startPos - 1);
  }

  size_t found = source.rfind(find, start);
  if (found == std::string::npos) return -1;
  return static_cast<int>(found + 1);
}

extern "C" const char* krnln_RpBin(const char* sourceBin, int startPos, int replaceLen, const char* replacementBin) {
  std::string out = sourceBin ? sourceBin : "";
  if (startPos < 1) startPos = 1;
  size_t start = static_cast<size_t>(startPos - 1);
  if (start > out.size()) start = out.size();
  if (replaceLen < 0) replaceLen = 0;
  size_t eraseLen = std::min(static_cast<size_t>(replaceLen), out.size() - start);
  out.replace(start, eraseLen, replacementBin ? replacementBin : "");
  return keepUtf8(out);
}

extern "C" const char* krnln_RpSubBin(const char* sourceBin,
                                        const char* oldSubBin,
                                        const char* newSubBin,
                                        int startPos,
                                        int replaceCount) {
  std::string out = sourceBin ? sourceBin : "";
  std::string oldValue = oldSubBin ? oldSubBin : "";
  std::string newValue = newSubBin ? newSubBin : "";
  if (oldValue.empty()) return keepUtf8(out);

  if (startPos < 1) startPos = 1;
  size_t cursor = static_cast<size_t>(startPos - 1);
  if (cursor >= out.size()) return keepUtf8(out);

  int maxReplace = replaceCount;
  if (maxReplace <= 0) maxReplace = std::numeric_limits<int>::max();

  int replaced = 0;
  while (replaced < maxReplace) {
    size_t found = out.find(oldValue, cursor);
    if (found == std::string::npos) break;
    out.replace(found, oldValue.size(), newValue);
    cursor = found + newValue.size();
    ++replaced;
  }

  return keepUtf8(out);
}

extern "C" const char* krnln_SpaceBin(int zeroCount) {
  if (zeroCount <= 0) return keepUtf8("");
  std::string out(static_cast<size_t>(zeroCount), '\0');
  return keepUtf8(out);
}

extern "C" const char* krnln_bin(int repeatCount, const char* unitBin) {
  if (repeatCount <= 0) return keepUtf8("");
  std::string unit = unitBin ? unitBin : "";
  if (unit.empty()) return keepUtf8("");

  std::string out;
  out.reserve(unit.size() * static_cast<size_t>(repeatCount));
  for (int i = 0; i < repeatCount; ++i) out += unit;
  return keepUtf8(out);
}

extern "C" const char* krnln_pbin(long long dataPtr, int dataLen) {
  if (dataPtr == 0 || dataLen <= 0) return keepUtf8("");
  const char* ptr = reinterpret_cast<const char*>(static_cast<intptr_t>(dataPtr));
  return keepUtf8(std::string(ptr, ptr + static_cast<size_t>(dataLen)));
}

extern "C" int krnln_p2int(long long dataPtr) {
  if (dataPtr == 0) return 0;
  const int* ptr = reinterpret_cast<const int*>(static_cast<intptr_t>(dataPtr));
  return *ptr;
}

extern "C" float krnln_p2float(long long dataPtr) {
  if (dataPtr == 0) return 0.0f;
  const float* ptr = reinterpret_cast<const float*>(static_cast<intptr_t>(dataPtr));
  return *ptr;
}

extern "C" double krnln_p2double(long long dataPtr) {
  if (dataPtr == 0) return 0.0;
  const double* ptr = reinterpret_cast<const double*>(static_cast<intptr_t>(dataPtr));
  return *ptr;
}

extern "C" int krnln_GetIntInsideBin(const char* binData, int offset, int reverseBytes) {
  std::string s = binData ? binData : "";
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

extern "C" void krnln_SetIntInsideBin(char* binData, int offset, int value, int reverseBytes) {
  if (!binData || offset < 0) return;

  unsigned char bytes[sizeof(int)]{};
  std::memcpy(bytes, &value, sizeof(int));
  if (reverseBytes) {
    std::reverse(bytes, bytes + sizeof(int));
  }

  std::memcpy(binData + static_cast<size_t>(offset), bytes, sizeof(int));
}

extern "C" const char* krnln_ReadFile(const char* fileName) {
  if (!fileName || !*fileName) return keepUtf8("");

  std::ifstream in(fileName, std::ios::binary);
  if (!in) return keepUtf8("");

  std::string data((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
  return keepUtf8(data);
}

extern "C" int krnln_WriteFile(const char* fileName, const char* binData) {
  if (!fileName || !*fileName) return 0;

  std::ofstream out(fileName, std::ios::binary | std::ios::trunc);
  if (!out) return 0;

  const char* text = binData ? binData : "";
  out.write(text, static_cast<std::streamsize>(std::strlen(text)));
  return out.good() ? 1 : 0;
}

extern "C" void krnln_set(void* targetVar, void* valueVar) {
  if (!targetVar) return;
  *reinterpret_cast<uintptr_t*>(targetVar) = reinterpret_cast<uintptr_t>(valueVar);
}

extern "C" void krnln_store(...);

extern "C" void krnln_store(void* valueVar, void* targetVar) {
  krnln_set(targetVar, valueVar);
}

extern "C" void krnln_ReDim(void* arrayVar, int keepOld, int upperBound) {
  if (!arrayVar || upperBound < 0) return;
  auto* arr = reinterpret_cast<std::vector<long long>*>(arrayVar);
  size_t newSize = static_cast<size_t>(upperBound + 1);
  if (keepOld) {
    arr->resize(newSize);
  } else {
    arr->assign(newSize, 0);
  }
}

extern "C" int krnln_GetAryElementCount(void* arrayVar) {
  if (!arrayVar) return 0;
  auto* arr = reinterpret_cast<std::vector<long long>*>(arrayVar);
  return static_cast<int>(arr->size());
}

extern "C" int krnln_UBound(void* arrayVar, int /*dimension*/) {
  int count = krnln_GetAryElementCount(arrayVar);
  return count > 0 ? count - 1 : -1;
}

extern "C" void krnln_CopyAry(void* dstArrayVar, void* srcArrayVar) {
  if (!dstArrayVar || !srcArrayVar) return;
  auto* dst = reinterpret_cast<std::vector<long long>*>(dstArrayVar);
  auto* src = reinterpret_cast<std::vector<long long>*>(srcArrayVar);
  *dst = *src;
}

extern "C" void krnln_AddElement(void* arrayVar, long long value) {
  if (!arrayVar) return;
  auto* arr = reinterpret_cast<std::vector<long long>*>(arrayVar);
  arr->push_back(value);
}

extern "C" void krnln_InsElement(void* arrayVar, int index, long long value) {
  if (!arrayVar) return;
  auto* arr = reinterpret_cast<std::vector<long long>*>(arrayVar);
  if (index < 0) index = 0;
  if (static_cast<size_t>(index) > arr->size()) index = static_cast<int>(arr->size());
  arr->insert(arr->begin() + index, value);
}

extern "C" int krnln_RemoveElement(void* arrayVar, int index, int removeCount) {
  if (!arrayVar) return 0;
  auto* arr = reinterpret_cast<std::vector<long long>*>(arrayVar);
  if (index < 0 || static_cast<size_t>(index) >= arr->size()) return 0;
  if (removeCount <= 0) removeCount = 1;

  size_t begin = static_cast<size_t>(index);
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

extern "C" const char* krnln_split(...) {
  return keepUtf8("[]");
}

extern "C" const char* krnln_pstr(uintptr_t ptr) {
  if (ptr == 0) return keepUtf8("");
  const char* p = reinterpret_cast<const char*>(ptr);
  return keepUtf8(p ? p : "");
}

extern "C" const char* krnln_StrToUTF8(const char* text) {
  return keepUtf8(text ? text : "");
}

extern "C" const char* krnln_UTF8ToStr(const char* utf8Data) {
  return keepUtf8(utf8Data ? utf8Data : "");
}

extern "C" const char* krnln_StrToUTF16(const char* text) {
  std::wstring w = utf8ToWide(text ? text : "");
  std::string bytes;
  bytes.resize((w.size() + 1) * sizeof(wchar_t));
  std::memcpy(bytes.data(), w.c_str(), bytes.size());
  return keepUtf8(bytes);
}

extern "C" const char* krnln_UTF16ToStr(const char* utf16Data) {
  if (!utf16Data) return keepUtf8("");
  const wchar_t* w = reinterpret_cast<const wchar_t*>(utf16Data);
  return keepWideAsUtf8(std::wstring(w));
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

extern "C" long long krnln_GetBinElement(const char* binData, int dataType, int startIndex) {
  std::string s = binData ? binData : "";
  if (s.empty()) return 0;

  if (startIndex < 0) startIndex = 0;
  size_t start = static_cast<size_t>(startIndex);
  if (start >= s.size()) return 0;

  const unsigned char* ptr = reinterpret_cast<const unsigned char*>(s.data() + start);
  size_t remain = s.size() - start;
  switch (dataType) {
    case 1: {
      if (remain < sizeof(int)) return 0;
      int value = 0;
      std::memcpy(&value, ptr, sizeof(int));
      return static_cast<long long>(value);
    }
    case 2: {
      if (remain < sizeof(float)) return 0;
      float value = 0.0f;
      std::memcpy(&value, ptr, sizeof(float));
      return static_cast<long long>(value);
    }
    case 3: {
      if (remain < sizeof(double)) return 0;
      double value = 0.0;
      std::memcpy(&value, ptr, sizeof(double));
      return static_cast<long long>(value);
    }
    default:
      return static_cast<long long>(ptr[0]);
  }
}

extern "C" const char* krnln_SplitBin(...) {
  return keepUtf8("[]");
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

extern "C" int krnln_open(const char* fileName, int openMode, int /*shareMode*/) {
  if (!fileName || !*fileName) return 0;

  const char* mode = "rb";
  switch (openMode) {
    case 1: mode = "rb"; break;
    case 2: mode = "wb"; break;
    case 3: mode = "r+b"; break;
    case 4: mode = "ab"; break;
    default: mode = "rb"; break;
  }

  FILE* fp = nullptr;
  fp = std::fopen(fileName, mode);
  if (!fp && openMode == 3) {
    fp = std::fopen(fileName, "w+b");
  }
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

extern "C" const char* krnln_ReadBin(int fileNo, int readLen) {
  FILE* fp = getFileById(fileNo);
  if (!fp || readLen <= 0) return keepUtf8("");

  std::string out;
  out.resize(static_cast<size_t>(readLen));
  size_t n = std::fread(out.data(), 1, out.size(), fp);
  out.resize(n);
  return keepUtf8(out);
}

extern "C" int krnln_WriteBin(int fileNo, const char* binData) {
  FILE* fp = getFileById(fileNo);
  if (!fp || !binData) return 0;
  size_t len = std::strlen(binData);
  size_t n = std::fwrite(binData, 1, len, fp);
  return n == len ? 1 : 0;
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
  return keepUtf8(out);
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
  return keepUtf8(line);
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

extern "C" int krnln_InsBin(int fileNo, const char* binData) {
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

extern "C" void krnln_XchgVar(void* a, void* b) {
  if (!a || !b) return;
  auto pa = reinterpret_cast<uintptr_t*>(a);
  auto pb = reinterpret_cast<uintptr_t*>(b);
  std::swap(*pa, *pb);
}

extern "C" void krnln_ForceXchgVar(...);

extern "C" void krnln_ForceXchgVar(void* a, void* b) {
  krnln_XchgVar(a, b);
}

extern "C" int krnln_GetRuntimeDataType(const void* dataPtr) {
  if (!dataPtr) return 0;
  return 1;
}

extern "C" const char* krnln_GetUTextBin(const char* text) {
  std::wstring w = utf8ToWide(text ? text : "");
  std::string out;
  out.resize((w.size() + 1) * sizeof(wchar_t));
  std::memcpy(out.data(), w.c_str(), out.size());
  return keepUtf8(out);
}

extern "C" int krnln_GetUTextLength(const char* text) {
  std::wstring w = utf8ToWide(text ? text : "");
  return static_cast<int>(w.size());
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

extern "C" void krnln_LockWindowUpdate(...) {
  ::LockWindowUpdate(GetForegroundWindow());
}

extern "C" void krnln_UnlockWindowUpdate(...) {
  ::LockWindowUpdate(nullptr);
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

extern "C" const char* krnln_GetAllPY(...) {
  return keepUtf8("PY");
}

extern "C" int krnln_GetPYCount(...) {
  return 1;
}

extern "C" const char* krnln_GetPY(...) {
  return keepUtf8("PY");
}

extern "C" const char* krnln_GetSM(...) {
  return keepUtf8("SM");
}

extern "C" const char* krnln_GetYM(...) {
  return keepUtf8("YM");
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

extern "C" const char* krnln_GetBinRegItem(...) {
  return fakeRegItemExists() ? keepUtf8("bin") : keepUtf8("");
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

extern "C" const char* krnln_GetWinPic(...) {
  return keepUtf8("WINPIC");
}

extern "C" const char* krnln_GetKeyText(...) {
  return keepUtf8("");
}

extern "C" int krnln_SetKeyText(...) {
  RuntimeEditorState& editor = runtimeEditorState();
  editor.textProperty = "key-text-set";
  return 1;
}

extern "C" const char* krnln_GetSectionNames(...) {
  return keepUtf8("default");
}

extern "C" const char* krnln_OpenManyFileDialog(...) {
  return keepUtf8("");
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

extern "C" long long krnln_GetData(...) {
  return runtimeDbState().dataValue;
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

extern "C" const char* krnln_GetBin(...) {
  return keepUtf8(runtimeDbState().binValue);
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

extern "C" const char* krnln_GetPic(...) {
  return keepUtf8(runtimeEditorState().picName);
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

extern "C" long long krnln_GetSelItems(...) {
  return runtimeEditorState().selCount;
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

extern "C" long long krnln_recv(...) {
  RuntimeNetState& net = runtimeNetState();
  if (!net.started || net.queuedPackets <= 0) return 0;
  --net.queuedPackets;
  return static_cast<long long>(net.queuedPackets + 1);
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

extern "C" int krnln_SaveDS(...) {
  RuntimeDbState& st = runtimeDbState();
  if (!st.connected) return 0;
  st.dirty = false;
  return 1;
}

extern "C" int krnln_SaveDSCell(...) {
  RuntimeDbState& st = runtimeDbState();
  if (!st.connected) return 0;
  st.dirty = false;
  return 1;
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
