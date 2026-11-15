#pragma once
#include "eui_neo.h"
#include <GLFW/glfw3.h>
#include <functional>
#include <string>
#include <vector>

namespace yc_eui {
struct Control {
    std::string name, type, text, radioGroup, nativeText;
    float left = 0, top = 0, width = 120, height = 36;
    int value = 0;
    int minimum = 0, maximum = 100;
    bool visible = true, disabled = false, multiline = false, checked = false;
    void* nativeWindow = nullptr;
    int nativeId = 0;
    std::function<void()> event;
    std::function<void()> initialize, dispose;
    void* nativeBitmap = nullptr;
};
struct Form {
    std::string name, title;
    int width = 640, height = 480;
    bool dark = false, created = false;
    std::vector<Control> controls;
    std::function<void()> onCreated;
    GLFWwindow* handle = nullptr;
    void* nativeWindow = nullptr;
    bool pending = false;
    float windowScale = 1;
    bool modal = false;
    Form* owner = nullptr;
};
std::vector<Form>& forms();
void composeForm(std::size_t index, eui::Ui& ui, const eui::Screen& screen);
[[noreturn]] void fail(const std::string& message);
bool isOpen(Form& form);
int outerHeight(int clientHeight);
}
