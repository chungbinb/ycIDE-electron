#include "demo.h"
#include "eui/platform.h"

#include <cstdlib>
#include <stdexcept>

namespace demo {

State& state() {
    static State value = [] {
        State initial;
        if (const char* theme = std::getenv("YCIDE_EUI_POC_THEME")) {
            const std::string choice(theme);
            if (choice != "light" && choice != "dark") {
                throw std::invalid_argument("YCIDE_EUI_POC_THEME must be light or dark");
            }
            initial.dark = choice == "dark";
        }
        return initial;
    }();
    return value;
}

namespace {

auto tokens() {
    return state().dark ? components::theme::dark() : components::theme::light();
}

void text(eui::Ui& ui, const std::string& id, const std::string& value,
          float x, float y, float width, float height, float fontSize) {
    ui.text(id).position(x, y).size(width, height)
        .text(value).color(tokens().text).fontSize(fontSize).build();
}

void applyProperties() {
    auto& value = state();
    ++value.submissions;
    value.status = "属性已应用（" + std::to_string(value.submissions) + " 次）：你好，" +
        (value.name.empty() ? std::string("未命名用户") : value.name) + "！";
}

void composeChild(eui::Ui& ui, const eui::Screen& screen, bool modal) {
    const auto theme = tokens();
    const auto& metrics = theme.metrics;
    const float inset = metrics.spacing.panel;
    ui.stack("child.root").size(screen.width, screen.height).content([&] {
        ui.rect("child.background").fill().color(theme.background).build();
        text(ui, "child.title", modal ? "独立模态窗口" : "第二个顶层窗口",
             inset, inset, screen.width - inset * 2, 40, metrics.typography.heading);
        text(ui, "child.name", "共享属性：你好，" + state().name,
             inset, 88, screen.width - inset * 2, 40, metrics.typography.body);
        text(ui, "child.help", modal ? "关闭本窗口后，才可操作父窗口。"
                                     : "可独立移动、缩放，并与主窗口同时存在。",
             inset, 144, screen.width - inset * 2, 40, metrics.typography.body);
        components::button(ui, "child.apply").position(inset, 212).size(240, metrics.control.control)
            .theme(theme).fontSize(metrics.typography.body).text("更新主窗口状态")
            .onClick([] {
                state().status = "已收到独立窗口事件。";
                app::requestUpdate();
            }).build();
        text(ui, "child.closeHint", "使用系统标题栏的关闭按钮返回。",
             inset, 280, screen.width - inset * 2, 40, metrics.typography.body);
    }).build();
}

void openChild(bool modal) {
    app::openWindow(app::DslWindowConfig{}
        .title(modal ? "ycIDE EUI P0 - 模态窗口" : "ycIDE EUI P0 - 独立窗口")
        .pageId(modal ? "poc.modal" : "poc.secondary")
        .windowSize(540, 360).modal(modal).background(tokens().background),
        [modal](eui::Ui& ui, const eui::Screen& screen) {
            composeChild(ui, screen, modal);
        });
}

} // namespace
} // namespace demo

namespace app {

const DslAppConfig& dslAppConfig() {
    static const DslAppConfig config = DslAppConfig{}
        .title("ycIDE - EUI 自绘窗口示例 [P0 实验]")
        .pageId("ycide.eui.poc").appId("ycide.eui.poc")
        .windowSize(1040, 780).minWindowSize(940, 760)
        .background(demo::tokens().background)
        .iconPath("").showDebugStatsInTitle(false).showDebugOverlay(false);
    return config;
}

void compose(eui::Ui& ui, const eui::Screen& screen) {
    const auto theme = demo::tokens();
    const auto& metrics = theme.metrics;
    const float inset = metrics.spacing.panel;
    const float gap = metrics.spacing.section;
    const float bodyWidth = screen.width - inset * 2;
    const float leftWidth = bodyWidth * 0.59f;
    const float rightX = inset + leftWidth + gap;
    const float rightWidth = bodyWidth - leftWidth - gap;
    const float fieldWidth = leftWidth - inset * 2;
    const float buttonWidth = (fieldWidth - gap) * 0.5f;

    ui.stack("root").size(screen.width, screen.height).content([&] {
        ui.rect("background").fill().color(theme.background).build();
        demo::text(ui, "heading", "跨平台自绘窗口 · 独立验证示例",
                   inset, inset, bodyWidth - 180, 44, metrics.typography.heading);
        demo::text(ui, "subtitle", "EUI-NEO v0.6.3  /  GLFW + OpenGL  /  尚未接入 IDE",
                   inset, 76, bodyWidth, 32, metrics.typography.body);
        components::button(ui, "theme").position(screen.width - inset - 160, inset)
            .size(160, metrics.control.control).theme(theme, false)
            .fontSize(metrics.typography.body)
            .text(demo::state().dark ? "切换浅色主题" : "切换深色主题")
            .onClick([] { demo::state().dark = !demo::state().dark; }).build();

        ui.rect("form.background").position(inset, 132).size(leftWidth, 490)
            .color(theme.surface).radius(metrics.radius.card).build();
        demo::text(ui, "form.title", "属性与事件", inset * 2, 152,
                   fieldWidth, 36, metrics.typography.subtitle);
        demo::text(ui, "name.label", "名称（单行编辑框）", inset * 2, 202,
                   fieldWidth, 28, metrics.typography.body);
        components::input(ui, "name").position(inset * 2, 240)
            .size(fieldWidth, metrics.control.control).theme(theme)
            .accessibleName("名称").placeholder("请输入中文或英文名称")
            .value(demo::state().name)
            .onChange([](const std::string& value) { demo::state().name = value; })
            .onEnter(demo::applyProperties).build();
        demo::text(ui, "notes.label", "说明（多行编辑框）", inset * 2, 306,
                   fieldWidth, 28, metrics.typography.body);
        components::input(ui, "notes").position(inset * 2, 344)
            .size(fieldWidth, 156).theme(theme).multiline().scrollbar()
            .accessibleName("说明").placeholder("输入多行说明")
            .value(demo::state().notes)
            .onChange([](const std::string& value) { demo::state().notes = value; }).build();
        components::button(ui, "apply").position(inset * 2, 536)
            .size(buttonWidth, metrics.control.control).theme(theme)
            .fontSize(metrics.typography.body).text("应用属性")
            .onClick(demo::applyProperties).build();
        components::button(ui, "reset").position(inset * 2 + buttonWidth + gap, 536)
            .size(buttonWidth, metrics.control.control).theme(theme, false)
            .fontSize(metrics.typography.body).text("重置（需确认）")
            .onClick([] { demo::state().confirmReset = true; }).build();

        ui.rect("preview.background").position(rightX, 132).size(rightWidth, 490)
            .color(theme.surface).radius(metrics.radius.card).build();
        demo::text(ui, "preview.title", "预览与窗口生命周期", rightX + inset, 152,
                   rightWidth - inset * 2, 36, metrics.typography.subtitle);
        components::image(ui, "preview.image", theme)
            .position(rightX + inset, 208).size(rightWidth - inset * 2, 156)
            .source(eui::platform::resolveResourcePath("assets/layout-preview.svg"))
            .contain().build();
        demo::text(ui, "preview.caption", "同一绘制引擎，不依赖原生按钮外观",
                   rightX + inset, 384, rightWidth - inset * 2, 30, metrics.typography.label);
        components::button(ui, "secondary").position(rightX + inset, 446)
            .size(rightWidth - inset * 2, metrics.control.control).theme(theme, false)
            .fontSize(metrics.typography.body).text("打开独立窗口")
            .onClick([] { demo::openChild(false); }).build();
        components::button(ui, "modal").position(rightX + inset, 514)
            .size(rightWidth - inset * 2, metrics.control.control).theme(theme, false)
            .fontSize(metrics.typography.body).text("打开模态子窗口")
            .onClick([] { demo::openChild(true); }).build();

        demo::text(ui, "status", demo::state().status, inset, 642,
                   bodyWidth, 38, metrics.typography.body);
        demo::text(ui, "keyboard.help", "Tab / Shift+Tab 切换焦点；Enter 应用单行输入。支持 Ctrl+C / V / Z。",
                   inset, 692, bodyWidth, 28, metrics.typography.label);
        demo::text(ui, "experimental.warning", "实验限制：系统读屏桥接未实现；macOS / Linux、IME 与多 DPI 尚待实测。",
                   inset, 728, bodyWidth, 28, metrics.typography.label);
    }).build();

    components::dialog(ui, "reset.confirm").open(demo::state().confirmReset)
        .screen(screen.width, screen.height).size(480, 260).theme(theme)
        .title("重置输入内容？").message("确认后恢复初始属性；取消将保留当前输入。")
        .primaryText("确认重置").secondaryText("取消")
        .onOpenChange([](bool open) { demo::state().confirmReset = open; })
        .onPrimary([] {
            const bool dark = demo::state().dark;
            demo::state() = demo::State{};
            demo::state().dark = dark;
            demo::state().status = "已确认重置，当前主题保留。";
        })
        .onSecondary([] { demo::state().confirmReset = false; }).build();
}

} // namespace app
