#include <windows.h>

static DWORD spec_strlen(const char* value) {
  if (!value) return 0;
  const char* current = value;
  while (*current) ++current;
  return static_cast<DWORD>(current - value);
}

extern "C" void spec_Trace(const char* value) {
  const char* text = value ? value : "";
  DWORD written = 0;
  HANDLE output = GetStdHandle(STD_OUTPUT_HANDLE);
  if (output != INVALID_HANDLE_VALUE && output != nullptr) {
    WriteFile(output, text, spec_strlen(text), &written, nullptr);
    WriteFile(output, "\n", 1, &written, nullptr);
  }
  OutputDebugStringA(text);
  OutputDebugStringA("\n");
}

extern "C" void spec_Verify(const char* value) {
  if (value && value[0]) return;
  OutputDebugStringA("spec.Verify failed\n");
  if (IsDebuggerPresent()) {
    DebugBreak();
  }
}

extern "C" void spec_Delay(int milliseconds) {
  if (milliseconds < 0) milliseconds = 0;
  Sleep(static_cast<DWORD>(milliseconds));
}
