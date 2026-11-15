#include "demo.h"

#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace {

std::vector<app::DslWindowConfig> windowRequests;
std::vector<app::DslWindowCompose> childComposers;
int updateRequests = 0;

void require(bool condition, const char* message) {
    if (!condition) {
        throw std::runtime_error(message);
    }
}

void compose(eui::Ui& ui) {
    ui.begin("poc.test");
    app::compose(ui, {1040, 780});
    ui.end();
}

void click(eui::Ui& ui, const std::string& id) {
    auto* element = ui.find(id);
    require(element && static_cast<bool>(element->onClick), "Missing clickable control");
    const auto callback = element->onClick;
    callback();
    compose(ui);
}

} // namespace

// Headless tests inspect window requests; only the real executable creates OS windows.
namespace app {
void openWindow(const DslWindowConfig& config, DslWindowCompose callback) {
    windowRequests.push_back(config);
    childComposers.push_back(std::move(callback));
}
void requestUpdate() {
    ++updateRequests;
}
} // namespace app

int main() {
    try {
        eui::Ui ui;
        demo::state() = demo::State{};
        compose(ui);

        auto* input = ui.find("name.hit");
        require(input && input->onTextInput && input->onKeyEvent,
                "The name input must accept text and keyboard events");
        core::KeyEvent selectAll;
        selectAll.key = core::InputKey::A;
        selectAll.modifiers.control = true;
        selectAll.modifiers.super = true;
        input->onKeyEvent(selectAll);
        core::TextInputEvent committed;
        committed.text = "跨平台测试";
        input->onTextInput(committed);
        compose(ui);
        require(demo::state().name == "跨平台测试",
                "Committed UTF-8 input must update the controlled property");
        click(ui, "apply.bg");
        require(ui.find("status")->text.find("跨平台测试") != std::string::npos,
                "Apply must read the current name and update the status label");
        require(demo::state().submissions == 1, "Apply must fire once");

        click(ui, "theme.bg");
        const auto darkBackground = ui.find("background")->color;
        require(demo::state().dark, "Theme button must switch to dark");
        click(ui, "reset.bg");
        require(demo::state().confirmReset, "Reset must require confirmation");
        click(ui, "reset.confirm.secondary.bg");
        require(demo::state().name == "跨平台测试", "Cancel must preserve input");
        click(ui, "reset.bg");
        click(ui, "reset.confirm.primary.bg");
        require(demo::state().name == "ycIDE" && demo::state().submissions == 0,
                "Confirmed reset must restore the form");
        require(demo::state().dark && ui.find("background")->color.r == darkBackground.r,
                "Reset must preserve the chosen theme");

        click(ui, "secondary.bg");
        click(ui, "modal.bg");
        require(windowRequests.size() == 2 && !windowRequests[0].modalValue &&
                windowRequests[1].modalValue, "Child window requests must preserve modality");
        eui::Ui child;
        child.begin("child.test");
        childComposers[0](child, {540, 360});
        child.end();
        const auto childClick = child.find("child.apply.bg")->onClick;
        childClick();
        compose(ui);
        require(updateRequests == 1 && ui.find("status")->text == "已收到独立窗口事件。",
                "A child event must invalidate the parent and update its label");

        bool namedInput = false;
        for (const auto& node : ui.accessibilityTree()) {
            if (node.role == core::AccessibleRole::TextInput && node.name == "名称") {
                namedInput = true;
            }
        }
        require(namedInput, "The name input must expose a named semantic node");
        std::cout << "PASS: UTF-8 input, apply, theme, reset, child events, window requests, semantics\n";
        return EXIT_SUCCESS;
    } catch (const std::exception& error) {
        std::cerr << "FAIL: " << error.what() << '\n';
        return EXIT_FAILURE;
    }
}
