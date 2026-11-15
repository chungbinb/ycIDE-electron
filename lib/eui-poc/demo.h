#pragma once

#include "eui_neo.h"
#include <string>

namespace demo {

struct State {
    bool dark = false;
    bool confirmReset = false;
    int submissions = 0;
    std::string name = "ycIDE";
    std::string notes = "这是一份独立的 EUI 自绘窗口示例。\n试试中文输入、复制粘贴和 Tab 导航。";
    std::string status = "等待操作：修改输入，再点击“应用属性”。";
};

State& state();

} // namespace demo
