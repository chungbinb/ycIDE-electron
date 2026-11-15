#include "runtime.h"
#include "theme-tokens.h"
#include "eui/platform.h"
#include <algorithm>
#include <stdexcept>
#include <iostream>
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <windowsx.h>
#include <commctrl.h>
#include <objidl.h>
#include <propidl.h>
#include <gdiplus.h>
#include <cmath>
#include <cwchar>
#define GLFW_EXPOSE_NATIVE_WIN32
#include <GLFW/glfw3native.h>
#ifdef small
#undef small
#endif

#if defined(YC_EUI_HAS_WEBVIEW2)
extern "C" void webview2_register_window_units(HINSTANCE);
#endif

namespace yc_eui {
std::vector<Form>& forms() {
    static std::vector<Form> value;
    return value;
}
[[noreturn]] void fail(const std::string& message) {
    std::cerr << "EUI runtime error: " << message << '\n';
    const int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, message.c_str(), -1, nullptr, 0);
    std::wstring wide(size > 0 ? size : 0, L'\0');
    if (size > 0) MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, message.c_str(), -1, wide.data(), size);
    MessageBoxW(nullptr, size > 0 ? wide.c_str() : L"EUI runtime error; see the run output.", L"ycIDE EUI runtime error", MB_OK | MB_ICONERROR);
    throw std::runtime_error(message);
}
bool isOpen(Form& form) {
    const auto window = static_cast<HWND>(form.nativeWindow);
    if (window && IsWindow(window) && GetPropW(window, L"ycIDE.EUI.form") == &form && !glfwWindowShouldClose(form.handle)) return true;
    form.handle = nullptr;
    form.nativeWindow = nullptr;
    return false;
}
int outerHeight(int clientHeight) {
    return clientHeight + static_cast<int>(titlebarHeight);
}
static bool handleNativeControlMessage(Form& form, UINT message, WPARAM wparam, LPARAM lparam);
static LRESULT CALLBACK windowChromeProc(HWND window, UINT message, WPARAM wparam, LPARAM lparam, UINT_PTR id, DWORD_PTR data) {
    auto& form = *reinterpret_cast<Form*>(data);
    if (handleNativeControlMessage(form, message, wparam, lparam)) return 0;
    if (message == WM_NCCALCSIZE) return 0;
    if (message == WM_NCHITTEST || message == WM_SYSCOMMAND || message == WM_CLOSE) {
        const bool blocked = std::any_of(forms().begin(), forms().end(), [&](Form& child) {
            return child.owner == &form && child.modal && (child.pending || isOpen(child));
        });
        if (blocked) return message == WM_NCHITTEST ? HTCLIENT : 0;
    }
    if (message == WM_NCHITTEST) {
        RECT bounds{};
        if (!GetWindowRect(window, &bounds)) return DefSubclassProc(window, message, wparam, lparam);
        const int x = GET_X_LPARAM(lparam) - bounds.left;
        const int y = GET_Y_LPARAM(lparam) - bounds.top;
        const int width = bounds.right - bounds.left, height = bounds.bottom - bounds.top;
        const int grip = static_cast<int>(std::ceil(4 * form.windowScale));
        if (!IsZoomed(window)) {
            const bool left = x < grip, right = x >= width - grip, top = y < grip, bottom = y >= height - grip;
            if (top && left) return HTTOPLEFT;
            if (top && right) return HTTOPRIGHT;
            if (bottom && left) return HTBOTTOMLEFT;
            if (bottom && right) return HTBOTTOMRIGHT;
            if (left) return HTLEFT;
            if (right) return HTRIGHT;
            if (top) return HTTOP;
            if (bottom) return HTBOTTOM;
        }
        if (y < titlebarHeight * form.windowScale && x < width - 3 * captionButtonWidth * form.windowScale) return HTCAPTION;
        return HTCLIENT;
    }
    if (message == WM_GETMINMAXINFO) {
        const auto result = DefSubclassProc(window, message, wparam, lparam);
        auto& limits = *reinterpret_cast<MINMAXINFO*>(lparam);
        MONITORINFO monitor{sizeof(MONITORINFO)};
        if (GetMonitorInfoW(MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST), &monitor)) {
            limits.ptMaxPosition = {monitor.rcWork.left - monitor.rcMonitor.left, monitor.rcWork.top - monitor.rcMonitor.top};
            limits.ptMaxSize = {monitor.rcWork.right - monitor.rcWork.left, monitor.rcWork.bottom - monitor.rcWork.top};
        }
        limits.ptMinTrackSize = {static_cast<LONG>((3 * captionButtonWidth + 48) * form.windowScale), static_cast<LONG>((titlebarHeight + 32) * form.windowScale)};
        return result;
    }
    if (message == WM_NCDESTROY) {
        RemoveWindowSubclass(window, windowChromeProc, id);
        if (form.nativeWindow == window) {
            for (auto& item : form.controls) {
                if (item.dispose) item.dispose();
                if (item.nativeBitmap) DeleteObject(static_cast<HBITMAP>(item.nativeBitmap));
                item.nativeWindow = nullptr;
                item.nativeBitmap = nullptr;
            }
            form.handle = nullptr;
            form.nativeWindow = nullptr;
        }
    }
    return DefSubclassProc(window, message, wparam, lparam);
}
static void initializeChrome(Form& form) {
    const auto window = static_cast<HWND>(form.nativeWindow);
    if (GetPropW(window, L"ycIDE.EUI.form") == &form) return;
    int width = 0, height = 0;
    glfwGetWindowSize(form.handle, &width, &height);
    if (!SetPropW(window, L"ycIDE.EUI.form", &form) ||
        !SetWindowSubclass(window, windowChromeProc, 1, reinterpret_cast<DWORD_PTR>(&form))) fail("Cannot register EUI window chrome");
    // Child windows have no decorated option in the SDK; change them before their first visible frame.
    glfwSetWindowAttrib(form.handle, GLFW_DECORATED, GLFW_FALSE);
    SetLastError(0);
    const auto style = (GetWindowLongPtrW(window, GWL_STYLE) & ~WS_CAPTION) | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;
    if (!SetWindowLongPtrW(window, GWL_STYLE, style) && GetLastError()) fail("Cannot remove native EUI window decoration");
    if (!SetWindowPos(window, nullptr, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED)) fail("Cannot update EUI window frame");
    glfwSetWindowSize(form.handle, width, height);
}
static Control& control(const char* name) {
    Control* found = nullptr;
    for (auto& form : forms()) for (auto& item : form.controls) if (item.name == name) {
        if (found) fail("Ambiguous EUI control name: " + std::string(name));
        found = &item;
    }
    if (!found) fail("Unknown EUI control: " + std::string(name));
    if (found->type == "EuiScript") fail("Nonvisual script components require their library property/method API: " + std::string(name));
    return *found;
}
static Form* form(const char* name) {
    for (auto& item : forms()) if (item.name == name) return &item;
    return nullptr;
}
static std::wstring toWide(const std::string& value) {
    if (value.empty()) return {};
    const int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.c_str(), -1, nullptr, 0);
    if (size <= 0) fail("Invalid UTF-8 in EUI control text");
    std::wstring wide(size, L'\0');
    if (!MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.c_str(), -1, wide.data(), size)) fail("Cannot convert EUI control text");
    wide.pop_back();
    return wide;
}
static std::string toUtf8(const wchar_t* value) {
    if (!value || !*value) return {};
    const int size = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value, -1, nullptr, 0, nullptr, nullptr);
    if (size <= 0) fail("Cannot convert native control text to UTF-8");
    std::string result(size, '\0');
    if (!WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value, -1, result.data(), size, nullptr, nullptr))
        fail("Cannot convert native control text to UTF-8");
    result.pop_back();
    return result;
}
static bool isWin32Control(const Control& item) {
    return item.type.rfind("Win32", 0) == 0;
}
static const wchar_t* nativeControlClass(const Control& item) {
    if (item.type == "Win32Button" || item.type == "Win32Checkbox" ||
        item.type == "Win32Radio" || item.type == "Win32Group") return L"BUTTON";
    if (item.type == "Win32Edit") return L"EDIT";
    if (item.type == "Win32Label" || item.type == "Win32Image") return L"STATIC";
    if (item.type == "Win32Slider") return TRACKBAR_CLASSW;
    if (item.type == "Win32Progress") return PROGRESS_CLASSW;
    return nullptr;
}
static DWORD nativeControlStyle(const Control& item) {
    DWORD style = WS_CHILD | WS_CLIPSIBLINGS;
    if (item.type == "Win32Button") return style | WS_TABSTOP | BS_PUSHBUTTON;
    if (item.type == "Win32Checkbox") return style | WS_TABSTOP | BS_AUTOCHECKBOX;
    if (item.type == "Win32Radio") return style | WS_TABSTOP | BS_AUTORADIOBUTTON;
    if (item.type == "Win32Group") return style | BS_GROUPBOX;
    if (item.type == "Win32Edit")
        return style | WS_TABSTOP | ES_LEFT | ES_AUTOHSCROLL |
            (item.multiline ? ES_MULTILINE | ES_AUTOVSCROLL | WS_VSCROLL : 0);
    if (item.type == "Win32Label") return style | SS_LEFT;
    if (item.type == "Win32Image") return style | SS_BITMAP | SS_CENTERIMAGE;
    if (item.type == "Win32Slider") return style | WS_TABSTOP | TBS_AUTOTICKS;
    if (item.type == "Win32Progress") return style;
    return style;
}
static ULONG_PTR gdiplusToken = 0;
static void ensureGdiplus() {
    if (gdiplusToken) return;
    Gdiplus::GdiplusStartupInput input;
    if (Gdiplus::GdiplusStartup(&gdiplusToken, &input, nullptr) != Gdiplus::Ok)
        fail("Cannot initialize GDI+ for the native image control");
}
static void syncNativeImage(Control& item) {
    if (item.type != "Win32Image" || !item.nativeWindow || !IsWindow(static_cast<HWND>(item.nativeWindow)) ||
        item.nativeText == item.text) return;
    if (item.nativeBitmap) {
        SendMessageW(static_cast<HWND>(item.nativeWindow), STM_SETIMAGE, IMAGE_BITMAP, 0);
        DeleteObject(static_cast<HBITMAP>(item.nativeBitmap));
        item.nativeBitmap = nullptr;
    }
    if (!item.text.empty()) {
        ensureGdiplus();
        const auto path = toWide(eui::platform::resolveResourcePath(item.text));
        Gdiplus::Bitmap image(path.c_str());
        if (image.GetLastStatus() != Gdiplus::Ok) fail("Cannot load image for native control: " + item.name);
        HBITMAP bitmap = nullptr;
        if (image.GetHBITMAP(Gdiplus::Color(0, 0, 0, 0), &bitmap) != Gdiplus::Ok || !bitmap)
            fail("Cannot create native bitmap for control: " + item.name);
        item.nativeBitmap = bitmap;
        SendMessageW(static_cast<HWND>(item.nativeWindow), STM_SETIMAGE, IMAGE_BITMAP, reinterpret_cast<LPARAM>(bitmap));
    }
    item.nativeText = item.text;
}
static bool handleNativeControlMessage(Form& form, UINT message, WPARAM wparam, LPARAM lparam) {
    Control* item = nullptr;
    if (message == WM_COMMAND && lparam) {
        const auto child = reinterpret_cast<HWND>(lparam);
        const auto code = HIWORD(wparam);
        const auto found = std::find_if(form.controls.begin(), form.controls.end(), [child](const Control& control) {
            return control.nativeWindow == child && isWin32Control(control);
        });
        if (found == form.controls.end()) return false;
        item = &*found;
        if ((item->type == "Win32Edit" && code != EN_CHANGE) ||
            (item->type != "Win32Edit" && code != BN_CLICKED)) return false;
        if (item->type == "Win32Edit") {
            const int length = GetWindowTextLengthW(child);
            std::wstring text(static_cast<std::size_t>(length) + 1, L'\0');
            GetWindowTextW(child, text.data(), length + 1);
            item->nativeText = toUtf8(text.c_str());
        } else if (item->type == "Win32Checkbox" || item->type == "Win32Radio") {
            item->checked = SendMessageW(child, BM_GETCHECK, 0, 0) == BST_CHECKED;
            if (item->type == "Win32Radio" && item->checked) {
                for (auto& owner : forms()) for (auto& candidate : owner.controls) {
                    if (&candidate != item && candidate.type == "Win32Radio" && candidate.radioGroup == item->radioGroup) {
                        candidate.checked = false;
                        if (candidate.nativeWindow) SendMessageW(static_cast<HWND>(candidate.nativeWindow), BM_SETCHECK, BST_UNCHECKED, 0);
                    }
                }
            }
        }
    } else if (message == WM_HSCROLL && lparam) {
        const auto child = reinterpret_cast<HWND>(lparam);
        const auto found = std::find_if(form.controls.begin(), form.controls.end(), [child](const Control& control) {
            return control.nativeWindow == child && control.type == "Win32Slider";
        });
        if (found == form.controls.end()) return false;
        item = &*found;
        item->value = static_cast<int>(SendMessageW(child, TBM_GETPOS, 0, 0));
    } else {
        return false;
    }
    if (item->event) item->event();
    app::requestUpdate();
    return true;
}
static void composeNativeControl(Form& form, Control& item) {
    if (isWin32Control(item)) {
        static bool initialized = false;
        if (!initialized) {
            INITCOMMONCONTROLSEX controls{sizeof(INITCOMMONCONTROLSEX), ICC_BAR_CLASSES};
            if (!InitCommonControlsEx(&controls)) fail("Cannot initialize native common controls");
            initialized = true;
        }
        auto window = static_cast<HWND>(item.nativeWindow);
        if (!window || !IsWindow(window)) {
            const auto* controlClass = nativeControlClass(item);
            if (!controlClass) fail("Unregistered Win32 control adapter: " + item.type);
            const std::wstring text = item.type == "Win32Image" ? L"" : toWide(item.text);
            window = CreateWindowExW(0, controlClass, text.c_str(), nativeControlStyle(item),
                0, 0, 0, 0, static_cast<HWND>(form.nativeWindow),
                reinterpret_cast<HMENU>(static_cast<INT_PTR>(item.nativeId)), GetModuleHandleW(nullptr), nullptr);
            if (!window) fail("Cannot create Win32 child control: " + item.name);
            item.nativeWindow = window;
            item.nativeText = item.type == "Win32Image" ? std::string() : item.text;
            if (item.type == "Win32Checkbox" || item.type == "Win32Radio")
                SendMessageW(window, BM_SETCHECK, item.checked ? BST_CHECKED : BST_UNCHECKED, 0);
        }
        if (item.type != "Win32Image" && item.nativeText != item.text) {
            if (!SetWindowTextW(window, toWide(item.text).c_str())) fail("Cannot update Win32 control: " + item.name);
            item.nativeText = item.text;
        }
        if (item.type == "Win32Image") syncNativeImage(item);
        if (item.type == "Win32Slider") {
            SendMessageW(window, TBM_SETRANGE, TRUE, MAKELPARAM(item.minimum, item.maximum));
            SendMessageW(window, TBM_SETPOS, TRUE, item.value);
        } else if (item.type == "Win32Progress") {
            SendMessageW(window, PBM_SETRANGE32, item.minimum, item.maximum);
            SendMessageW(window, PBM_SETPOS, item.value, 0);
        }
        if (item.type == "Win32Checkbox" || item.type == "Win32Radio")
            SendMessageW(window, BM_SETCHECK, item.checked ? BST_CHECKED : BST_UNCHECKED, 0);
        const float scale = form.windowScale > 0 ? form.windowScale : 1;
        const int left = static_cast<int>(std::round(item.left * scale));
        const int top = static_cast<int>(std::round((item.top + titlebarHeight) * scale));
        const int width = static_cast<int>(std::round(item.width * scale));
        const int height = static_cast<int>(std::round(item.height * scale));
        if (!SetWindowPos(window, nullptr, left, top, width, height, SWP_NOZORDER | SWP_NOACTIVATE))
            fail("Cannot position Win32 child control: " + item.name);
        ShowWindow(window, item.visible ? SW_SHOWNA : SW_HIDE);
        EnableWindow(window, !item.disabled);
        return;
    }
    if (item.type != "EuiWebView") return;
#if defined(YC_EUI_HAS_WEBVIEW2)
    static bool registered = false;
    if (!registered) {
        webview2_register_window_units(GetModuleHandleW(nullptr));
        registered = true;
    }
    auto window = static_cast<HWND>(item.nativeWindow);
    if (!window || !IsWindow(window)) {
        const std::wstring text = toWide(item.text);
        window = CreateWindowExW(0, L"YcWebView2Host", text.c_str(),
            WS_CHILD | WS_CLIPSIBLINGS | WS_TABSTOP | (item.visible ? WS_VISIBLE : 0),
            0, 0, 0, 0, static_cast<HWND>(form.nativeWindow),
            reinterpret_cast<HMENU>(static_cast<INT_PTR>(item.nativeId)), GetModuleHandleW(nullptr), nullptr);
        if (!window) fail("Cannot create WebView2 child window for EUI control: " + item.name);
        item.nativeWindow = window;
        item.nativeText = item.text;
    }
    if (item.nativeText != item.text) {
        if (!SetWindowTextW(window, toWide(item.text).c_str())) fail("Cannot update WebView2 control: " + item.name);
        item.nativeText = item.text;
    }
    const float scale = form.windowScale > 0 ? form.windowScale : 1;
    const int left = static_cast<int>(std::round(item.left * scale));
    const int top = static_cast<int>(std::round((item.top + titlebarHeight) * scale));
    const int width = static_cast<int>(std::round(item.width * scale));
    const int height = static_cast<int>(std::round(item.height * scale));
    if (!SetWindowPos(window, nullptr, left, top, width, height, SWP_NOZORDER | SWP_NOACTIVATE)) fail("Cannot position WebView2 child window: " + item.name);
    ShowWindow(window, item.visible ? SW_SHOWNA : SW_HIDE);
    EnableWindow(window, !item.disabled);
#else
    fail("WebView2 browser control was compiled without its support-library implementation");
#endif
}
void composeForm(std::size_t index, eui::Ui& ui, const eui::Screen& screen) {
    auto& form = forms().at(index);
    form.handle = glfwGetCurrentContext();
    form.nativeWindow = glfwGetWin32Window(form.handle);
    int nativeWidth = 0, nativeHeight = 0;
    glfwGetWindowSize(form.handle, &nativeWidth, &nativeHeight);
    form.windowScale = screen.width > 0 ? nativeWidth / screen.width : 1;
    initializeChrome(form);
    form.pending = false;
    if (!form.created) {
        form.created = true;
        for (auto& item : form.controls) {
            if (item.initialize) item.initialize();
            if (item.type == "EuiWebView" || isWin32Control(item)) composeNativeControl(form, item);
        }
        if (form.onCreated) form.onCreated();
    }
    const auto theme = projectTheme(form.dark);
    ui.stack(form.name).size(screen.width, screen.height).content([&] {
        ui.rect(form.name + ".background").fill().color(theme.background).build();
        ui.stack(form.name + ".titlebar").size(screen.width, titlebarHeight).clip().content([&] {
            ui.rect(form.name + ".titlebar.background").fill().color(theme.surface).build();
            ui.text(form.name + ".title").position(12, 0).size(std::max(0.0f, screen.width - 3 * captionButtonWidth - 24), titlebarHeight)
                .text(form.title).fontSize(titleFontSize).verticalAlign(core::VerticalAlign::Center).color(theme.text).build();
            const auto caption = [&](int index, const char* id, const char* label, std::function<void()> action) {
                auto style = components::ButtonStyle(theme, false);
                style.normal = theme.surface;
                style.hover = theme.surfaceHover;
                style.pressed = theme.surfaceActive;
                style.text = theme.text;
                style.shadow.enabled = false;
                style.border.width = 0;
                style.radius = 0;
                style.pressScale = 1;
                components::button(ui, form.name + id).position(screen.width - (3 - index) * captionButtonWidth, 0)
                    .size(captionButtonWidth, titlebarHeight).theme(theme, false).style(style).fontSize(titleFontSize)
                    .text(label).accessibleName(label).onClick([action] { action(); app::requestUpdate(); }).build();
            };
            caption(0, ".minimize", "最小化", [&form] { glfwIconifyWindow(form.handle); });
            const bool maximized = IsZoomed(static_cast<HWND>(form.nativeWindow));
            caption(1, ".maximize", maximized ? "还原" : "最大化", [&form, maximized] {
                if (maximized) glfwRestoreWindow(form.handle);
                else glfwMaximizeWindow(form.handle);
            });
            caption(2, ".close", "关闭", [&form] { glfwSetWindowShouldClose(form.handle, GLFW_TRUE); });
            ui.rect(form.name + ".titlebar.separator").position(0, titlebarHeight - windowBorderWidth)
                .size(screen.width, windowBorderWidth).color(theme.border).build();
        }).build();
        ui.stack(form.name + ".client").position(0, titlebarHeight)
            .size(screen.width, std::max(0.0f, screen.height - titlebarHeight)).clip().content([&] {
                for (auto& item : form.controls) {
                    if (item.type == "EuiScript") continue;
                    if (item.type == "EuiWebView" || isWin32Control(item)) {
                        composeNativeControl(form, item);
                        continue;
                    }
                    if (!item.visible) continue;
                    auto* control = &item;
                    if (item.type == "EuiButton") {
                        components::button(ui, item.name).position(item.left, item.top).size(item.width, item.height)
                            .theme(theme).fontSize(theme.metrics.typography.body).text(item.text)
                            .textColor(project_buttonText(form.dark)).colors(theme.primary, project_buttonHover(form.dark), project_buttonPressed(form.dark))
                            .accessibleName(item.text.empty() ? item.name : item.text).disabled(item.disabled)
                            .onClick([control] { if (control->event) control->event(); app::requestUpdate(); }).build();
                    } else if (item.type == "EuiWebButton") {
                        components::button(ui, item.name).position(item.left, item.top).size(item.width, item.height)
                            .theme(theme).fontSize(theme.metrics.typography.body).text(item.text)
                            .textColor(project_buttonText(form.dark)).colors(theme.primary, project_buttonHover(form.dark), project_buttonPressed(form.dark))
                            .accessibleName(item.text.empty() ? item.name : item.text).disabled(item.disabled)
                            .onClick([control] { if (control->event) control->event(); app::requestUpdate(); }).build();
                    } else if (item.type == "EuiInput") {
                        if (item.disabled) {
                            ui.rect(item.name + ".disabled").position(item.left, item.top).size(item.width, item.height)
                                .color(theme.surfaceHover).border(1, theme.border).radius(theme.metrics.radius.control).build();
                            ui.text(item.name + ".disabledText").position(item.left + theme.metrics.spacing.control, item.top + theme.metrics.spacing.small)
                                .size(std::max(0.0f, item.width - theme.metrics.spacing.large), item.height)
                                .text(item.text).color(theme.text).fontSize(theme.metrics.typography.body).build();
                            continue;
                        }
                        ui.stack(item.name + ".enabled").position(item.left, item.top).size(item.width, item.height)
                            .disabled(item.disabled).content([&] {
                                components::input(ui, item.name).size(item.width, item.height).theme(theme)
                                    .multiline(item.multiline).scrollbar(item.multiline).accessibleName(item.name)
                                    .value(item.text).onChange([control](const std::string& value) {
                                        control->text = value;
                                        if (control->event) control->event();
                                        app::requestUpdate();
                                    }).build();
                            }).build();
                    } else if (item.type == "EuiWebEdit") {
                        if (item.disabled) {
                            ui.rect(item.name + ".disabled").position(item.left, item.top).size(item.width, item.height)
                                .color(theme.surfaceHover).border(1, theme.border).radius(theme.metrics.radius.control).build();
                            ui.text(item.name + ".disabledText").position(item.left + theme.metrics.spacing.control, item.top + theme.metrics.spacing.small)
                                .size(std::max(0.0f, item.width - theme.metrics.spacing.large), item.height)
                                .text(item.text).color(theme.text).fontSize(theme.metrics.typography.body).build();
                            continue;
                        }
                        ui.stack(item.name + ".enabled").position(item.left, item.top).size(item.width, item.height)
                            .content([&] {
                                components::input(ui, item.name).size(item.width, item.height).theme(theme)
                                    .accessibleName(item.name).value(item.text).onChange([control](const std::string& value) {
                                        control->text = value;
                                        if (control->event) control->event();
                                        app::requestUpdate();
                                    }).build();
                            }).build();
                    } else if (item.type == "EuiLabel") {
                        ui.text(item.name).position(item.left, item.top).size(item.width, item.height)
                            .text(item.text).color(theme.text).fontSize(theme.metrics.typography.body).build();
                    } else if (item.type == "EuiImage") {
                        if (item.text.empty()) continue;
                        components::image(ui, item.name, theme).position(item.left, item.top).size(item.width, item.height)
                            .source(eui::platform::resolveResourcePath(item.text)).contain().build();
                    } else if (item.type == "EuiCheckbox") {
                        ui.stack(item.name + ".placement").position(item.left, item.top).size(item.width, item.height).content([&] {
                            components::checkbox(ui, item.name).size(item.width, item.height)
                                .theme(theme).text(item.text).accessibleName(item.text.empty() ? item.name : item.text)
                                .checked(item.checked).disabled(item.disabled)
                                .onChange([control](bool checked) {
                                    control->checked = checked;
                                    if (control->event) control->event();
                                    app::requestUpdate();
                                }).build();
                        }).build();
                    } else if (item.type == "EuiRadio") {
                        ui.stack(item.name + ".placement").position(item.left, item.top).size(item.width, item.height).content([&] {
                            components::radio(ui, item.name).size(item.width, item.height)
                                .theme(theme).text(item.text).accessibleName(item.text.empty() ? item.name : item.text)
                                .group(item.radioGroup).selected(item.checked).disabled(item.disabled)
                                .onChange([control](bool selected) {
                                    if (!selected) return;
                                    for (auto& owner : forms()) for (auto& candidate : owner.controls)
                                        if (candidate.type == "EuiRadio" && candidate.radioGroup == control->radioGroup)
                                            candidate.checked = &candidate == control;
                                    if (control->event) control->event();
                                    app::requestUpdate();
                                }).build();
                        }).build();
                    } else if (item.type == "EuiSlider") {
                        const float range = static_cast<float>(control->maximum) - control->minimum;
                        const float normalized = std::clamp((static_cast<float>(control->value) - control->minimum) / range, 0.0f, 1.0f);
                        ui.stack(item.name + ".placement").position(item.left, item.top).size(item.width, item.height).content([&] {
                            components::slider(ui, item.name).size(item.width, item.height)
                                .theme(theme).accessibleName(item.text.empty() ? item.name : item.text).value(normalized).disabled(item.disabled)
                                .onChange([control](float value) {
                                    const double range = static_cast<double>(control->maximum) - control->minimum;
                                    control->value = static_cast<int>(control->minimum + std::round(value * range));
                                    if (control->event) control->event();
                                    app::requestUpdate();
                                }).build();
                        }).build();
                    } else if (item.type == "EuiProgress") {
                        const float range = static_cast<float>(control->maximum) - control->minimum;
                        const float normalized = std::clamp((static_cast<float>(control->value) - control->minimum) / range, 0.0f, 1.0f);
                        ui.stack(item.name + ".placement").position(item.left, item.top).size(item.width, item.height).content([&] {
                            components::progress(ui, item.name).size(item.width, item.height)
                                .theme(theme).value(normalized).build();
                        }).build();
                    } else if (item.type == "EuiGroup") {
                        ui.stack(item.name).position(item.left, item.top).size(item.width, item.height).content([&] {
                            ui.rect(item.name + ".outline").fill().color(theme.background)
                                .border(1, theme.border).build();
                            if (!item.text.empty()) {
                                const float labelWidth = std::min(std::max(0.0f, item.width - theme.metrics.spacing.large),
                                    core::TextPrimitive::measureTextWidth(item.text, {}, theme.metrics.typography.body, 400) + theme.metrics.spacing.control);
                                ui.rect(item.name + ".labelBackground").position(theme.metrics.spacing.control, 0)
                                    .size(labelWidth, theme.metrics.typography.body + theme.metrics.spacing.small)
                                    .color(theme.background).build();
                                ui.text(item.name + ".label").position(theme.metrics.spacing.large, 0)
                                    .size(std::max(0.0f, labelWidth - theme.metrics.spacing.control), theme.metrics.typography.body + theme.metrics.spacing.small)
                                    .text(item.text).fontSize(theme.metrics.typography.body).color(theme.text).build();
                            }
                        }).build();
                    } else fail("Unregistered EUI component: " + item.type);
                }
        }).build();
        ui.rect(form.name + ".border").fill().color(core::Color{0, 0, 0, 0}).border(windowBorderWidth, theme.border).build();
    }).build();
}
}

extern "C" const char* eui_GetText(const char* name) {
    if (auto* form = yc_eui::form(name)) return form->title.c_str();
    auto& item = yc_eui::control(name);
    if (yc_eui::isWin32Control(item) && item.type != "Win32Image" && item.nativeWindow && IsWindow(static_cast<HWND>(item.nativeWindow))) {
        const int length = GetWindowTextLengthW(static_cast<HWND>(item.nativeWindow));
        std::wstring text(static_cast<std::size_t>(length) + 1, L'\0');
        GetWindowTextW(static_cast<HWND>(item.nativeWindow), text.data(), length + 1);
        item.nativeText = yc_eui::toUtf8(text.c_str());
    }
    return (yc_eui::isWin32Control(item) ? item.nativeText : item.text).c_str();
}
extern "C" void eui_SetText(const char* name, const char* text) {
    if (auto* form = yc_eui::form(name)) {
        form->title = text;
        // GLFW is the explicitly selected backend, not a control HWND.
        if (yc_eui::isOpen(*form)) glfwSetWindowTitle(form->handle, text);
    } else {
        auto& control = yc_eui::control(name);
        const bool changed = control.text != text;
        control.text = text;
        if (yc_eui::isWin32Control(control)) {
            if (control.type == "Win32Image") {
                yc_eui::syncNativeImage(control);
            } else if (control.nativeWindow && IsWindow(static_cast<HWND>(control.nativeWindow)) &&
                !SetWindowTextW(static_cast<HWND>(control.nativeWindow), yc_eui::toWide(control.text).c_str())) {
                yc_eui::fail("Cannot update Win32 control text: " + control.name);
            }
            control.nativeText = control.text;
        }
        if (changed && control.type == "EuiInput" && control.event) control.event();
    }
    app::requestUpdate();
}
extern "C" int eui_GetNumber(const char* name, const char* property) {
    const std::string key(property);
    if (auto* form = yc_eui::form(name)) {
        if (key == "dark") return form->dark;
        if (key == "width" || key == "height") {
            int width = form->width, height = form->height;
            if (yc_eui::isOpen(*form)) {
                glfwGetWindowSize(form->handle, &width, &height);
                width = static_cast<int>(std::round(width / form->windowScale));
                height = static_cast<int>(std::round(height / form->windowScale)) - static_cast<int>(yc_eui::titlebarHeight);
            }
            return key == "width" ? width : height;
        }
        yc_eui::fail("Unsupported EUI window property: " + key);
    }
    const auto& item = yc_eui::control(name);
    if (key == "left") return static_cast<int>(item.left);
    if (key == "top") return static_cast<int>(item.top);
    if (key == "width") return static_cast<int>(item.width);
    if (key == "height") return static_cast<int>(item.height);
    if (key == "visible") return item.visible;
    if (key == "disabled") return item.disabled;
    if (key == "multiline") return item.multiline;
    if (key == "checked" && (item.type == "EuiCheckbox" || item.type == "EuiRadio" || item.type == "Win32Checkbox" || item.type == "Win32Radio")) return item.checked;
    if (key == "value" && (item.type == "EuiSlider" || item.type == "EuiProgress" || item.type == "Win32Slider" || item.type == "Win32Progress")) return item.value;
    if (key == "min" && (item.type == "EuiSlider" || item.type == "EuiProgress" || item.type == "Win32Slider" || item.type == "Win32Progress")) return item.minimum;
    if (key == "max" && (item.type == "EuiSlider" || item.type == "EuiProgress" || item.type == "Win32Slider" || item.type == "Win32Progress")) return item.maximum;
    yc_eui::fail("Unsupported EUI control property: " + key);
}
extern "C" void eui_SetNumber(const char* name, const char* property, int value) {
    const std::string key(property);
    if (auto* form = yc_eui::form(name)) {
        if (key == "dark") form->dark = value != 0;
        else if ((key == "width" || key == "height") && value > 0) {
            form->width = eui_GetNumber(name, "width");
            form->height = eui_GetNumber(name, "height");
            if (key == "width") form->width = value;
            else form->height = value;
            if (yc_eui::isOpen(*form)) glfwSetWindowSize(form->handle, static_cast<int>(std::round(form->width * form->windowScale)), static_cast<int>(std::round(yc_eui::outerHeight(form->height) * form->windowScale)));
        }
        else yc_eui::fail("Unsupported mutable EUI window property: " + key);
    } else {
        auto& item = yc_eui::control(name);
        if (key == "left") item.left = static_cast<float>(value);
        else if (key == "top") item.top = static_cast<float>(value);
        else if (key == "width" && value > 0) item.width = static_cast<float>(value);
        else if (key == "height" && value > 0) item.height = static_cast<float>(value);
        else if (key == "visible") item.visible = value != 0;
        else if (key == "disabled") item.disabled = value != 0;
        else if (key == "multiline" && (item.type == "EuiInput" || item.type == "Win32Edit")) item.multiline = value != 0;
        else if (key == "checked" && (item.type == "EuiCheckbox" || item.type == "EuiRadio" || item.type == "Win32Checkbox" || item.type == "Win32Radio")) {
            item.checked = value != 0;
            if ((item.type == "EuiRadio" || item.type == "Win32Radio") && item.checked)
                for (auto& owner : yc_eui::forms()) for (auto& candidate : owner.controls)
                    if (&candidate != &item && candidate.type == item.type && candidate.radioGroup == item.radioGroup) {
                        candidate.checked = false;
                        if (candidate.nativeWindow) SendMessageW(static_cast<HWND>(candidate.nativeWindow), BM_SETCHECK, BST_UNCHECKED, 0);
                    }
        }
        else if ((key == "value" || key == "min" || key == "max") &&
            (item.type == "EuiSlider" || item.type == "EuiProgress" || item.type == "Win32Slider" || item.type == "Win32Progress")) {
            if (key == "min") item.minimum = value;
            else if (key == "max") item.maximum = value;
            else item.value = value;
            if (item.minimum >= item.maximum) yc_eui::fail("Invalid EUI control range: " + item.name);
            item.value = std::clamp(item.value, item.minimum, item.maximum);
        }
        else yc_eui::fail("Unsupported or invalid EUI property: " + key);
    }
    app::requestUpdate();
}
