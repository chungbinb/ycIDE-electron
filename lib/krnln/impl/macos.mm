#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>

#include <chrono>
#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <filesystem>
#include <limits>
#include <string>
#include <thread>
#include <unordered_set>

#include <errno.h>
#include <fcntl.h>
#include <mach/mach_time.h>
#include <mach-o/dyld.h>
#include <sys/wait.h>
#include <sys/statvfs.h>
#include <unistd.h>

namespace {

constexpr int MB_TYPEMASK = 0x0000000F;
constexpr int MB_OK = 0x00000000;
constexpr int MB_OKCANCEL = 0x00000001;
constexpr int MB_YESNOCANCEL = 0x00000003;
constexpr int MB_YESNO = 0x00000004;
constexpr int MB_RETRYCANCEL = 0x00000005;
constexpr int MB_ICONHAND = 0x00000010;
constexpr int MB_ICONQUESTION = 0x00000020;
constexpr int MB_ICONEXCLAMATION = 0x00000030;
constexpr int MB_ICONINFORMATION = 0x00000040;

constexpr int IDOK = 1;
constexpr int IDCANCEL = 2;
constexpr int IDRETRY = 4;
constexpr int IDYES = 6;
constexpr int IDNO = 7;

const char* keepUtf8(const std::string& input) {
  static thread_local std::string buffer;
  buffer = input;
  return buffer.c_str();
}

std::string getExecutablePath() {
  uint32_t size = 0;
  _NSGetExecutablePath(nullptr, &size);
  if (size == 0) return std::string();

  std::string path(static_cast<size_t>(size), '\0');
  if (_NSGetExecutablePath(path.data(), &size) != 0) return std::string();
  path.resize(std::strlen(path.c_str()));
  return path;
}

int runCommand(const char* commandLine, int waitForExit, int showMode) {
  if (!commandLine || !*commandLine) return 0;

  pid_t pid = fork();
  if (pid < 0) return 0;

  if (pid == 0) {
    if (!waitForExit || showMode == 0) {
      int nullFd = open("/dev/null", O_RDWR);
      if (nullFd >= 0) {
        dup2(nullFd, STDIN_FILENO);
        dup2(nullFd, STDOUT_FILENO);
        dup2(nullFd, STDERR_FILENO);
        if (nullFd > STDERR_FILENO) close(nullFd);
      }
    }
    execl("/bin/sh", "sh", "-c", commandLine, static_cast<char*>(nullptr));
    _exit(127);
  }

  if (!waitForExit) return 1;

  int status = 0;
  if (waitpid(pid, &status, 0) < 0) return 0;
  if (WIFEXITED(status)) return WEXITSTATUS(status) == 0 ? 1 : 0;
  return 0;
}

int parseVersionMajor() {
  NSOperatingSystemVersion version = [[NSProcessInfo processInfo] operatingSystemVersion];
  return static_cast<int>(version.majorVersion);
}

int parseVersionMajorMinor() {
  NSOperatingSystemVersion version = [[NSProcessInfo processInfo] operatingSystemVersion];
  return static_cast<int>(version.majorVersion * 100 + version.minorVersion);
}

int clampKbToInt(unsigned long long kb) {
  if (kb > static_cast<unsigned long long>(std::numeric_limits<int>::max())) {
    return std::numeric_limits<int>::max();
  }
  return static_cast<int>(kb);
}

std::string normalizeDiskPath(const char* driveText) {
  if (driveText && *driveText) {
    return std::string(driveText);
  }
  return std::string("/");
}

int movePathReplace(const std::filesystem::path& src, const std::filesystem::path& dst) {
  try {
    if (!std::filesystem::exists(src)) return 0;
    if (std::filesystem::exists(dst)) {
      std::error_code ec;
      std::filesystem::remove_all(dst, ec);
    }

    std::error_code ec;
    std::filesystem::rename(src, dst, ec);
    if (!ec) return 1;

    if (std::filesystem::is_directory(src)) {
      std::filesystem::copy(src, dst, std::filesystem::copy_options::recursive | std::filesystem::copy_options::overwrite_existing, ec);
    } else {
      std::filesystem::copy_file(src, dst, std::filesystem::copy_options::overwrite_existing, ec);
    }
    if (ec) return 0;
    std::filesystem::remove_all(src, ec);
    return ec ? 0 : 1;
  } catch (...) {
    return 0;
  }
}

struct RuntimeWindowUnit {
  std::string className;
  std::string text;
  int style = 0;
  int exStyle = 0;
  int x = 0;
  int y = 0;
  int width = 0;
  int height = 0;
  RuntimeWindowUnit* parent = nullptr;
  int controlId = 0;
  int zOrder = 0;
  int lastMessage = 0;
  long long lastWParam = 0;
  long long lastLParam = 0;
  long long lastMessageResult = 0;
  std::deque<std::array<long long, 3>> postedMessages;
  bool enabled = true;
  bool created = true;
};

unsigned int lowWord(long long value) {
  return static_cast<unsigned int>(static_cast<unsigned long long>(value) & 0xFFFFULL);
}

unsigned int highWord(long long value) {
  return static_cast<unsigned int>((static_cast<unsigned long long>(value) >> 16) & 0xFFFFULL);
}

long long dispatchRuntimeMessage(RuntimeWindowUnit* h, int message, long long wParam, long long lParam, bool fromPostQueue) {
  if (!h) return 0;
  h->lastMessage = message;
  h->lastWParam = wParam;
  h->lastLParam = lParam;

  switch (message) {
    case 0x0006:  // WM_ACTIVATE
      if (wParam != 0) activeWindowUnit() = h;
      h->lastMessageResult = 1;
      break;
    case 0x0007:  // WM_SETFOCUS
      focusedWindowUnit() = h;
      h->lastMessageResult = 0;
      break;
    case 0x0008:  // WM_KILLFOCUS
      if (focusedWindowUnit() == h) focusedWindowUnit() = nullptr;
      h->lastMessageResult = 0;
      break;
    case 0x000A:  // WM_ENABLE
      h->enabled = (wParam != 0);
      h->lastMessageResult = 0;
      break;
    case 0x0005:  // WM_SIZE
      h->width = static_cast<int>(lowWord(lParam));
      h->height = static_cast<int>(highWord(lParam));
      h->lastMessageResult = 0;
      break;
    case 0x0003:  // WM_MOVE
      h->x = static_cast<int>(static_cast<short>(lowWord(lParam)));
      h->y = static_cast<int>(static_cast<short>(highWord(lParam)));
      h->lastMessageResult = 0;
      break;
    case 0x0010:  // WM_CLOSE
      h->created = false;
      h->enabled = false;
      if (focusedWindowUnit() == h) focusedWindowUnit() = nullptr;
      if (activeWindowUnit() == h) activeWindowUnit() = nullptr;
      h->lastMessageResult = 1;
      break;
    case 0x000C:  // WM_SETTEXT
      if (lParam != 0) {
        const char* text = reinterpret_cast<const char*>(static_cast<uintptr_t>(lParam));
        h->text = text ? text : "";
      }
      h->lastMessageResult = 1;
      break;
    case 0x000D:  // WM_GETTEXT
      if (lParam != 0 && wParam > 0) {
        char* outText = reinterpret_cast<char*>(static_cast<uintptr_t>(lParam));
        const size_t cap = static_cast<size_t>(wParam);
        const size_t n = std::min(cap - 1, h->text.size());
        if (n > 0) std::memcpy(outText, h->text.data(), n);
        outText[n] = '\0';
        h->lastMessageResult = static_cast<long long>(n);
      } else {
        h->lastMessageResult = static_cast<long long>(h->text.size());
      }
      break;
    case 0x000E:  // WM_GETTEXTLENGTH
      h->lastMessageResult = static_cast<long long>(h->text.size());
      break;
    default:
      h->lastMessageResult = fromPostQueue ? 1 : 0;
      break;
  }

  return h->lastMessageResult;
}

void drainPostedMessages(RuntimeWindowUnit* h) {
  if (!h) return;
  while (!h->postedMessages.empty()) {
    const auto msg = h->postedMessages.front();
    h->postedMessages.pop_front();
    dispatchRuntimeMessage(h, static_cast<int>(msg[0]), msg[1], msg[2], true);
  }
}

int processPostedMessagesOnce() {
  int count = 0;
  for (RuntimeWindowUnit* h : runtimeWindowUnits()) {
    if (!h || h->postedMessages.empty()) continue;
    const auto msg = h->postedMessages.front();
    h->postedMessages.pop_front();
    dispatchRuntimeMessage(h, static_cast<int>(msg[0]), msg[1], msg[2], true);
    ++count;
  }
  return count;
}

std::unordered_set<RuntimeWindowUnit*>& runtimeWindowUnits() {
  static std::unordered_set<RuntimeWindowUnit*> s;
  return s;
}

RuntimeWindowUnit*& focusedWindowUnit() {
  static RuntimeWindowUnit* s = nullptr;
  return s;
}

RuntimeWindowUnit*& activeWindowUnit() {
  static RuntimeWindowUnit* s = nullptr;
  return s;
}

RuntimeWindowUnit* asWindowUnit(void* hwnd) {
  if (!hwnd) return nullptr;
  auto* p = reinterpret_cast<RuntimeWindowUnit*>(hwnd);
  return runtimeWindowUnits().count(p) ? p : nullptr;
}

NSAlertStyle alertStyleFromButtons(int buttons) {
  int iconBits = buttons & 0x000000F0;
  if (iconBits == MB_ICONHAND) return NSAlertStyleCritical;
  if (iconBits == MB_ICONEXCLAMATION) return NSAlertStyleWarning;
  if (iconBits == MB_ICONQUESTION) return NSAlertStyleInformational;
  if (iconBits == MB_ICONINFORMATION) return NSAlertStyleInformational;
  return NSAlertStyleInformational;
}

int runAlertWithButtons(const char* text, const char* title, int buttons, void* parentWindow) {
  @autoreleasepool {
        if (parentWindow) {
          NSWindow* owner = reinterpret_cast<NSWindow*>(parentWindow);
          if (owner) {
            [owner makeKeyAndOrderFront:nil];
          }
        }

    int style = buttons == 0 ? (MB_OK | MB_ICONINFORMATION) : buttons;
    int type = style & MB_TYPEMASK;

    NSString* nsText = [NSString stringWithUTF8String:(text ? text : "")];
    NSString* nsTitle = [NSString stringWithUTF8String:(title && *title ? title : "提示")];

    NSAlert* alert = [[NSAlert alloc] init];
    [alert setMessageText:nsTitle ?: @"提示"];
    [alert setInformativeText:nsText ?: @""];
    [alert setAlertStyle:alertStyleFromButtons(style)];

    if (type == MB_OKCANCEL) {
      [alert addButtonWithTitle:@"确定"];
      [alert addButtonWithTitle:@"取消"];
      NSModalResponse response = [alert runModal];
      return response == NSAlertFirstButtonReturn ? IDOK : IDCANCEL;
    }

    if (type == MB_YESNO) {
      [alert addButtonWithTitle:@"是"];
      [alert addButtonWithTitle:@"否"];
      NSModalResponse response = [alert runModal];
      return response == NSAlertFirstButtonReturn ? IDYES : IDNO;
    }

    if (type == MB_RETRYCANCEL) {
      [alert addButtonWithTitle:@"重试"];
      [alert addButtonWithTitle:@"取消"];
      NSModalResponse response = [alert runModal];
      return response == NSAlertFirstButtonReturn ? IDRETRY : IDCANCEL;
    }

    if (type == MB_YESNOCANCEL) {
      [alert addButtonWithTitle:@"是"];
      [alert addButtonWithTitle:@"否"];
      [alert addButtonWithTitle:@"取消"];
      NSModalResponse response = [alert runModal];
      if (response == NSAlertFirstButtonReturn) return IDYES;
      if (response == NSAlertSecondButtonReturn) return IDNO;
      return IDCANCEL;
    }

    [alert addButtonWithTitle:@"确定"];
    [alert runModal];
    return IDOK;
  }
}

}  // namespace

extern "C" int krnln_message_box(const char* text, const char* title);

extern "C" int krnln_MsgBox(const char* text, int buttons, const char* title, void* parentWindow) {
  return runAlertWithButtons(text, title, buttons, parentWindow);
}

extern "C" int krnln_msgbox(const char* text, int buttons, const char* title, void* parentWindow) {
  return runAlertWithButtons(text, title, buttons, parentWindow);
}

extern "C" int krnln_message_box(const char* text, const char* title) {
  return runAlertWithButtons(text, title, MB_OK | MB_ICONINFORMATION, nullptr);
}

extern "C" int krnln_beep() {
  NSBeep();
  return 1;
}

extern "C" int krnln_GetTickCount() {
  static mach_timebase_info_data_t timeBase = {0, 0};
  if (timeBase.denom == 0) mach_timebase_info(&timeBase);

  uint64_t tick = mach_absolute_time();
  uint64_t nano = tick * timeBase.numer / timeBase.denom;
  uint64_t ms = nano / 1000000ULL;
  return static_cast<int>(ms & 0x7fffffffULL);
}

extern "C" void krnln_sleep(int milliseconds) {
  if (milliseconds < 0) milliseconds = 0;
  std::this_thread::sleep_for(std::chrono::milliseconds(milliseconds));
}

extern "C" int krnln_GetLastError() {
  return errno;
}

extern "C" const char* krnln_GetRunFileName() {
  std::string path = getExecutablePath();
  if (path.empty()) return "";
  return keepUtf8(path);
}

extern "C" const char* krnln_GetRunPath() {
  std::string path = getExecutablePath();
  if (path.empty()) return "";
  std::filesystem::path p(path);
  return keepUtf8(p.parent_path().string());
}

extern "C" const char* krnln_GetCmdLine() {
  @autoreleasepool {
    NSArray<NSString*>* args = [[NSProcessInfo processInfo] arguments];
    NSString* joined = [args componentsJoinedByString:@" "];
    return keepUtf8(joined ? std::string([joined UTF8String]) : std::string());
  }
}

extern "C" const char* krnln_GetEnv(const char* name) {
  if (!name || !*name) return "";
  const char* value = std::getenv(name);
  return value ? value : "";
}

extern "C" int krnln_PutEnv(const char* name, const char* value) {
  if (!name || !*name) return 0;
  const char* val = value ? value : "";
  return setenv(name, val, 1) == 0 ? 1 : 0;
}

extern "C" int krnln_run(const char* commandLine, int waitForExit, int showMode) {
  return runCommand(commandLine, waitForExit, showMode);
}

extern "C" int krnln_GetScreenWidth() {
  @autoreleasepool {
    NSScreen* mainScreen = [NSScreen mainScreen];
    if (!mainScreen) return 0;
    NSRect frame = [mainScreen frame];
    return static_cast<int>(frame.size.width);
  }
}

extern "C" int krnln_GetScreenHeight() {
  @autoreleasepool {
    NSScreen* mainScreen = [NSScreen mainScreen];
    if (!mainScreen) return 0;
    NSRect frame = [mainScreen frame];
    return static_cast<int>(frame.size.height);
  }
}

extern "C" int krnln_GetCursorHorzPos() {
  @autoreleasepool {
    NSPoint point = [NSEvent mouseLocation];
    return static_cast<int>(point.x);
  }
}

extern "C" int krnln_GetCursorVertPos() {
  @autoreleasepool {
    NSPoint point = [NSEvent mouseLocation];
    return static_cast<int>(point.y);
  }
}

extern "C" int krnln_GetSysLang() {
  @autoreleasepool {
    NSString* lang = [[NSLocale preferredLanguages] firstObject];
    return (lang && [lang length] > 0) ? 1 : 0;
  }
}

extern "C" int krnln_GetSysVer() {
  @autoreleasepool {
    return parseVersionMajor();
  }
}

extern "C" int krnln_GetSysVer2() {
  @autoreleasepool {
    return parseVersionMajorMinor();
  }
}

extern "C" const char* krnln_GetAppName(int type) {
  std::string path = getExecutablePath();
  if (path.empty()) return "";

  std::filesystem::path p(path);
  switch (type) {
    case 1:
      return keepUtf8(p.stem().string());
    case 2:
      return keepUtf8(p.filename().string());
    default:
      return keepUtf8(path);
  }
}

extern "C" int krnln_SetWaitCursor() {
  @autoreleasepool {
    [NSCursor disappearingItemCursor].set;
  }
  return 1;
}

extern "C" int krnln_RestroeCursor() {
  @autoreleasepool {
    [NSCursor arrowCursor].set;
  }
  return 1;
}

extern "C" int krnln_DoEvents() {
  int total = 0;
  while (true) {
    int processed = processPostedMessagesOnce();
    if (processed <= 0) break;
    total += processed;
  }
  return total;
}

extern "C" const char* krnln_CurDir() {
  try {
    return keepUtf8(std::filesystem::current_path().string());
  } catch (...) {
    return "";
  }
}

extern "C" int krnln_ChDir(const char* dirPath) {
  if (!dirPath || !*dirPath) return 0;
  std::error_code ec;
  std::filesystem::current_path(std::filesystem::path(dirPath), ec);
  return ec ? 0 : 1;
}

extern "C" int krnln_MkDir(const char* dirPath) {
  if (!dirPath || !*dirPath) return 0;
  try {
    std::filesystem::path p(dirPath);
    if (std::filesystem::exists(p)) return std::filesystem::is_directory(p) ? 1 : 0;
    return std::filesystem::create_directories(p) ? 1 : 0;
  } catch (...) {
    return 0;
  }
}

extern "C" int krnln_RmDir(const char* dirPath) {
  if (!dirPath || !*dirPath) return 0;
  try {
    std::filesystem::path p(dirPath);
    if (!std::filesystem::exists(p)) return 1;
    if (!std::filesystem::is_directory(p)) return 0;
    std::error_code ec;
    std::filesystem::remove_all(p, ec);
    if (ec) return 0;
    return std::filesystem::exists(p) ? 0 : 1;
  } catch (...) {
    return 0;
  }
}

extern "C" int krnln_FileCopy(const char* sourceFile, const char* targetFile) {
  if (!sourceFile || !*sourceFile || !targetFile || !*targetFile) return 0;
  std::error_code ec;
  std::filesystem::copy_file(
    std::filesystem::path(sourceFile),
    std::filesystem::path(targetFile),
    std::filesystem::copy_options::overwrite_existing,
    ec);
  return ec ? 0 : 1;
}

extern "C" int krnln_FileMove(const char* sourceFile, const char* targetFile) {
  if (!sourceFile || !*sourceFile || !targetFile || !*targetFile) return 0;
  return movePathReplace(std::filesystem::path(sourceFile), std::filesystem::path(targetFile));
}

extern "C" int krnln_kill(const char* filePath) {
  if (!filePath || !*filePath) return 0;
  std::error_code ec;
  bool removed = std::filesystem::remove(std::filesystem::path(filePath), ec);
  if (!ec) return removed ? 1 : 1;
  return ec == std::errc::no_such_file_or_directory ? 1 : 0;
}

extern "C" int krnln_name(const char* sourcePath, const char* targetPath) {
  if (!sourcePath || !*sourcePath || !targetPath || !*targetPath) return 0;
  return movePathReplace(std::filesystem::path(sourcePath), std::filesystem::path(targetPath));
}

extern "C" int krnln_IsFileExist(const char* filePath) {
  if (!filePath || !*filePath) return 0;
  std::error_code ec;
  bool exists = std::filesystem::exists(std::filesystem::path(filePath), ec);
  if (ec || !exists) return 0;
  return std::filesystem::is_regular_file(std::filesystem::path(filePath), ec) && !ec ? 1 : 0;
}

extern "C" int krnln_FileLen(const char* filePath) {
  if (!filePath || !*filePath) return -1;
  std::error_code ec;
  std::filesystem::path p(filePath);
  if (!std::filesystem::exists(p, ec) || ec) return -1;
  if (!std::filesystem::is_regular_file(p, ec) || ec) return -1;
  auto sz = std::filesystem::file_size(p, ec);
  if (ec) return -1;
  if (sz > static_cast<uintmax_t>(std::numeric_limits<int>::max())) return std::numeric_limits<int>::max();
  return static_cast<int>(sz);
}

extern "C" int krnln_GetAttr(const char* pathText) {
  if (!pathText || !*pathText) return -1;
  std::error_code ec;
  auto st = std::filesystem::status(std::filesystem::path(pathText), ec);
  if (ec || st.type() == std::filesystem::file_type::not_found) return -1;
  int attr = 0;
  if (std::filesystem::is_directory(st)) attr |= 0x10;
  if ((st.permissions() & std::filesystem::perms::owner_write) == std::filesystem::perms::none) attr |= 0x1;
  return attr;
}

extern "C" int krnln_SetAttr(const char* pathText, int attr) {
  if (!pathText || !*pathText) return 0;
  std::filesystem::path p(pathText);
  std::error_code ec;
  auto current = std::filesystem::status(p, ec).permissions();
  if (ec) return 0;
  bool readOnly = (attr & 0x1) != 0;
  auto next = current;
  if (readOnly) {
    next &= ~std::filesystem::perms::owner_write;
    next &= ~std::filesystem::perms::group_write;
    next &= ~std::filesystem::perms::others_write;
  } else {
    next |= std::filesystem::perms::owner_write;
  }
  std::filesystem::permissions(p, next, ec);
  return ec ? 0 : 1;
}

extern "C" const char* krnln_GetTempFileName(const char* dirPath) {
  std::string baseDir = (dirPath && *dirPath) ? std::string(dirPath) : std::string("/tmp");
  std::filesystem::path dir(baseDir);
  std::error_code ec;
  if (!std::filesystem::exists(dir, ec)) {
    std::filesystem::create_directories(dir, ec);
    if (ec) return "";
  }

  std::string tmpl = (dir / "yciXXXXXX").string();
  std::vector<char> writable(tmpl.begin(), tmpl.end());
  writable.push_back('\0');
  int fd = mkstemp(writable.data());
  if (fd < 0) return "";
  close(fd);
  unlink(writable.data());
  return keepUtf8(std::string(writable.data()));
}

extern "C" int krnln_ChDrive(const char* driveText) {
  std::string path = normalizeDiskPath(driveText);
  std::error_code ec;
  std::filesystem::current_path(std::filesystem::path(path), ec);
  return ec ? 0 : 1;
}

extern "C" int krnln_GetDiskTotalSpace(const char* driveText) {
  std::string path = normalizeDiskPath(driveText);
  struct statvfs fs{};
  if (statvfs(path.c_str(), &fs) != 0) return -1;
  unsigned long long kb = (static_cast<unsigned long long>(fs.f_blocks) * static_cast<unsigned long long>(fs.f_frsize)) / 1024ULL;
  return clampKbToInt(kb);
}

extern "C" int krnln_GetDiskFreeSpace(const char* driveText) {
  std::string path = normalizeDiskPath(driveText);
  struct statvfs fs{};
  if (statvfs(path.c_str(), &fs) != 0) return -1;
  unsigned long long kb = (static_cast<unsigned long long>(fs.f_bavail) * static_cast<unsigned long long>(fs.f_frsize)) / 1024ULL;
  return clampKbToInt(kb);
}

extern "C" const char* krnln_GetDiskLabel(const char* driveText) {
  std::filesystem::path p(normalizeDiskPath(driveText));
  std::string label = p.filename().string();
  if (label.empty()) label = p.root_path().string();
  return keepUtf8(label);
}

extern "C" int krnln_SetDiskLabel(const char* driveText, const char* labelText) {
  (void)driveText;
  (void)labelText;
  return 0;
}

extern "C" int krnln_IsCreated(void* hwnd) {
  RuntimeWindowUnit* h = asWindowUnit(hwnd);
  return (h && h->created) ? 1 : 0;
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
  auto* h = new (std::nothrow) RuntimeWindowUnit();
  if (!h) return nullptr;
  h->className = className ? className : "";
  h->text = text ? text : "";
  h->style = style;
  h->exStyle = exStyle;
  h->x = x;
  h->y = y;
  h->width = width;
  h->height = height;
  h->parent = asWindowUnit(parent);
  h->controlId = controlId;
  runtimeWindowUnits().insert(h);
  return h;
}

extern "C" int krnln_destroy(void* hwnd, int immediate) {
  (void)immediate;
  RuntimeWindowUnit* h = asWindowUnit(hwnd);
  if (!h) return 0;
  if (focusedWindowUnit() == h) focusedWindowUnit() = nullptr;
  if (activeWindowUnit() == h) activeWindowUnit() = nullptr;
  runtimeWindowUnits().erase(h);
  delete h;
  return 1;
}

extern "C" int krnln_Activate(void* hwnd) {
  RuntimeWindowUnit* h = asWindowUnit(hwnd);
  if (!h) return 0;
  activeWindowUnit() = h;
  return 1;
}

extern "C" void krnln_SetFocus(void* hwnd) {
  RuntimeWindowUnit* h = asWindowUnit(hwnd);
  if (!h) return;
  focusedWindowUnit() = h;
}

extern "C" int krnln_IsFocus(void* hwnd) {
  RuntimeWindowUnit* h = asWindowUnit(hwnd);
  return (h && focusedWindowUnit() == h) ? 1 : 0;
}

extern "C" int krnln_GetClientWidth(void* hwnd) {
  RuntimeWindowUnit* h = asWindowUnit(hwnd);
  return h ? h->width : 0;
}

extern "C" int krnln_GetClientHeight(void* hwnd) {
  RuntimeWindowUnit* h = asWindowUnit(hwnd);
  return h ? h->height : 0;
}

extern "C" int krnln_GetWidth(void* hwnd) {
  RuntimeWindowUnit* h = asWindowUnit(hwnd);
  return h ? h->width : 0;
}

extern "C" int krnln_GetHeight(void* hwnd) {
  RuntimeWindowUnit* h = asWindowUnit(hwnd);
  return h ? h->height : 0;
}

extern "C" int krnln_enable(void* hwnd, int enabled) {
  RuntimeWindowUnit* h = asWindowUnit(hwnd);
  if (!h) return 0;
  h->enabled = enabled ? true : false;
  return 1;
}

extern "C" int krnln_IsEnabled(void* hwnd) {
  RuntimeWindowUnit* h = asWindowUnit(hwnd);
  return (h && h->enabled) ? 1 : 0;
}

extern "C" void krnln_lockwindowupdate(void* hwnd) { (void)hwnd; }
extern "C" void krnln_LockWindowUpdate(void* hwnd) { (void)hwnd; }
extern "C" void krnln_unlockwindowupdate() {}
extern "C" void krnln_UnlockWindowUpdate() {}

extern "C" void krnln_invalidate(void* hwnd) { (void)hwnd; }
extern "C" void krnln_InvalidateRect(void* hwnd, int left, int top, int width, int height) {
  (void)hwnd;
  (void)left;
  (void)top;
  (void)width;
  (void)height;
}
extern "C" void krnln_validate(void* hwnd) { (void)hwnd; }
extern "C" void krnln_UpdateWindow(void* hwnd) { (void)hwnd; }

extern "C" int krnln_move(void* hwnd, int left, int top, int width, int height) {
  RuntimeWindowUnit* h = asWindowUnit(hwnd);
  if (!h) return 0;
  h->x = left;
  h->y = top;
  h->width = width;
  h->height = height;
  return 1;
}

extern "C" int krnln_ZOrder(void* hwnd, int zOrder) {
  RuntimeWindowUnit* h = asWindowUnit(hwnd);
  if (!h) return 0;
  h->zOrder = zOrder;
  return 1;
}

extern "C" long long krnln_SendMessage(void* hwnd, int message, long long wParam, long long lParam) {
  RuntimeWindowUnit* h = asWindowUnit(hwnd);
  if (!h) return 0;
  drainPostedMessages(h);
  return dispatchRuntimeMessage(h, message, wParam, lParam, false);
}

extern "C" int krnln_PostMessage(void* hwnd, int message, long long wParam, long long lParam) {
  RuntimeWindowUnit* h = asWindowUnit(hwnd);
  if (!h) return 0;
  if (h->postedMessages.size() >= 256) {
    h->postedMessages.pop_front();
  }
  h->postedMessages.push_back({static_cast<long long>(message), wParam, lParam});
  return 1;
}

extern "C" int krnln_SetParentWnd(void* hwnd, void* parent) {
  RuntimeWindowUnit* h = asWindowUnit(hwnd);
  if (!h) return 0;
  h->parent = asWindowUnit(parent);
  return 1;
}

extern "C" long long krnln_GetHWnd(void* hwnd) {
  return reinterpret_cast<long long>(hwnd);
}

extern "C" int krnln_PopupMenu(void* hwnd, void* menu, int x, int y) {
  (void)hwnd;
  (void)menu;
  (void)x;
  (void)y;
  return 0;
}

extern "C" int krnln_SetText(void* hwnd, const char* text) {
  RuntimeWindowUnit* h = asWindowUnit(hwnd);
  if (!h) return 0;
  h->text = text ? text : "";
  return 1;
}

extern "C" const char* krnln_GetText(void* hwnd) {
  RuntimeWindowUnit* h = asWindowUnit(hwnd);
  if (!h) return "";
  return keepUtf8(h->text);
}
