#pragma once
#include "components/theme.h"
namespace yc_eui {
inline constexpr float titlebarHeight = 36.0000000000f;
inline constexpr float captionButtonWidth = 72.0000000000f;
inline constexpr float titleFontSize = 14.0000000000f;
inline constexpr float windowBorderWidth = 1.0000000000f;
inline auto projectTheme(bool dark) {
    auto tokens = dark ? components::theme::dark() : components::theme::light();
    tokens.background = dark ? core::Color{0.1000000000f,0.1000000000f,0.1200000000f,1.0000000000f} : core::Color{0.9500000000f,0.9500000000f,0.9700000000f,1.0000000000f};
    tokens.primary = dark ? core::Color{0.2196078431f,0.4431372549f,0.8784313725f,1.0000000000f} : core::Color{0.2196078431f,0.4431372549f,0.8784313725f,1.0000000000f};
    tokens.surface = dark ? core::Color{0.1500000000f,0.1500000000f,0.1800000000f,1.0000000000f} : core::Color{1.0000000000f,1.0000000000f,1.0000000000f,1.0000000000f};
    tokens.surfaceHover = dark ? core::Color{0.2500000000f,0.2500000000f,0.2800000000f,1.0000000000f} : core::Color{0.9000000000f,0.9000000000f,0.9000000000f,1.0000000000f};
    tokens.surfaceActive = dark ? core::Color{0.3500000000f,0.3500000000f,0.3800000000f,1.0000000000f} : core::Color{0.8000000000f,0.8000000000f,0.8000000000f,1.0000000000f};
    tokens.text = dark ? core::Color{1.0000000000f,1.0000000000f,1.0000000000f,1.0000000000f} : core::Color{0.0000000000f,0.0000000000f,0.0000000000f,1.0000000000f};
    tokens.border = dark ? core::Color{0.5500000000f,0.5500000000f,0.5500000000f,1.0000000000f} : core::Color{0.5500000000f,0.5500000000f,0.5500000000f,1.0000000000f};
    tokens.metrics.typography.body = 16.0f;
    tokens.metrics.typography.input = 16.0f;
    tokens.metrics.radius.overlay = 16.0f;
    tokens.metrics.radius.small = 6.0f;
    return tokens;
}
inline core::Color project_buttonText(bool dark) { return dark ? core::Color{1.0000000000f,1.0000000000f,1.0000000000f,1.0000000000f} : core::Color{1.0000000000f,1.0000000000f,1.0000000000f,1.0000000000f}; }
inline core::Color project_buttonHover(bool dark) { return dark ? core::Color{0.1800000000f,0.3500000000f,0.7000000000f,1.0000000000f} : core::Color{0.1800000000f,0.3500000000f,0.7000000000f,1.0000000000f}; }
inline core::Color project_buttonPressed(bool dark) { return dark ? core::Color{0.1400000000f,0.3000000000f,0.6500000000f,1.0000000000f} : core::Color{0.1400000000f,0.3000000000f,0.6500000000f,1.0000000000f}; }
}
