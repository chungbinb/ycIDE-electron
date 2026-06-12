// EventToken.h 最小替代：zig/mingw 工具链不带此 Windows SDK 头。
// WebView2.h 仅需要 EventRegistrationToken 一个类型定义。
#ifndef __EVENTTOKEN_H__
#define __EVENTTOKEN_H__

typedef struct EventRegistrationToken {
  __int64 value;
} EventRegistrationToken;

#endif  // __EVENTTOKEN_H__
