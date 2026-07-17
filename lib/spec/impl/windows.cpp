#include <windows.h>
#include <stdint.h>
#include <string>
#include <vector>

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
    // 照易语言调试输出：每行文本之前自动加上一个星号
    WriteFile(output, "* ", 2, &written, nullptr);
    WriteFile(output, text, spec_strlen(text), &written, nullptr);
    WriteFile(output, "\n", 1, &written, nullptr);
  }
  OutputDebugStringA("* ");
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

// ==== 取变量地址 / 取变量数据地址 ====
// 转译器按引用编组（YCMD_VARREF_EXPRS）：交来「变量地址 + 类型标签」，标签值与生成侧
// yc_vt_of 的 YC_VT_* 一致（krnln_set 一族同款契约）。返回 长整数型——x64 地址 32 位装不下，
// 与 指针到整数/指针到字节集 等命令收 长整数型 指针的约定对齐。
#define SPEC_VT_TEXT 7
#define SPEC_VT_BIN  8
#define SPEC_VT_ARY  9

extern "C" long long spec_GetVarAddress(const void* var) {
  return static_cast<long long>(reinterpret_cast<intptr_t>(var));
}

// 文本/字节集/数组给**数据缓冲区**地址（长度/成员数为 0 时照帮助返回 0）；其余类型与 取变量地址 相同。
// 注意：ycIDE 文本型是 UTF-16（std::wstring），数据地址指向宽字符缓冲，不是易语言的 GBK char*。
extern "C" long long spec_GetVarDataAddr(const void* var, int dataType) {
  if (!var) return 0;
  switch (dataType) {
    case SPEC_VT_TEXT: {
      const std::wstring* s = reinterpret_cast<const std::wstring*>(var);
      return s->empty() ? 0 : static_cast<long long>(reinterpret_cast<intptr_t>(s->c_str()));
    }
    case SPEC_VT_BIN: {
      const std::vector<unsigned char>* b = reinterpret_cast<const std::vector<unsigned char>*>(var);
      return b->empty() ? 0 : static_cast<long long>(reinterpret_cast<intptr_t>(b->data()));
    }
    case SPEC_VT_ARY: {
      const std::vector<long long>* a = reinterpret_cast<const std::vector<long long>*>(var);
      return a->empty() ? 0 : static_cast<long long>(reinterpret_cast<intptr_t>(a->data()));
    }
    default:
      return static_cast<long long>(reinterpret_cast<intptr_t>(var));
  }
}
