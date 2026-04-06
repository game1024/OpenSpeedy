/*
 * OpenSpeedy - Open Source Game Speed Controller
 * Copyright (C) 2025 Game1024
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
#include "themeutils.h"
#include <QStyleFactory>
#include <QPalette>
#include <QColor>
#include <QSettings>
#include <QApplication>
#include <QStyle>

void ThemeUtils::applyTheme(Theme theme)
{
    if (theme == System) {
        if (isSystemDarkMode()) {
            setDarkTheme();
        } else {
            setLightTheme();
        }
    } else if (theme == Dark) {
        setDarkTheme();
    } else if (theme == Modern) {
        setModernTheme();
    } else {
        setLightTheme();
    }
}

void ThemeUtils::setDarkTheme()
{
    QApplication* app = static_cast<QApplication*>(QApplication::instance());
    if (!app) return;

    // 深色模式必须使用 Fusion 风格，因为 WindowsVista 风格强制使用浅色控件
    app->setStyle(QStyleFactory::create("Fusion"));

    QPalette darkPalette;
    QColor darkColor = QColor(45, 45, 45);
    QColor disabledColor = QColor(127, 127, 127);

    darkPalette.setColor(QPalette::Window, darkColor);
    darkPalette.setColor(QPalette::WindowText, Qt::white);
    darkPalette.setColor(QPalette::Base, QColor(18, 18, 18));
    darkPalette.setColor(QPalette::AlternateBase, darkColor);
    darkPalette.setColor(QPalette::ToolTipBase, Qt::white);
    darkPalette.setColor(QPalette::ToolTipText, Qt::white);
    darkPalette.setColor(QPalette::Text, Qt::white);
    darkPalette.setColor(QPalette::Disabled, QPalette::Text, disabledColor);
    darkPalette.setColor(QPalette::Button, darkColor);
    darkPalette.setColor(QPalette::ButtonText, Qt::white);
    darkPalette.setColor(QPalette::Disabled, QPalette::ButtonText, disabledColor);
    darkPalette.setColor(QPalette::BrightText, Qt::red);
    darkPalette.setColor(QPalette::Link, QColor(42, 130, 218));

    darkPalette.setColor(QPalette::Highlight, QColor(42, 130, 218));
    darkPalette.setColor(QPalette::HighlightedText, Qt::black);
    darkPalette.setColor(QPalette::Disabled, QPalette::HighlightedText, disabledColor);

    app->setPalette(darkPalette);
    app->setStyleSheet("QToolTip { color: #ffffff; background-color: #2a82da; border: 1px solid white; }");
}

void ThemeUtils::setModernTheme()
{
    QApplication* app = static_cast<QApplication*>(QApplication::instance());
    if (!app) return;

    // Use Fusion as the base for custom themes
    app->setStyle(QStyleFactory::create("Fusion"));

    QPalette modernPalette;
    QColor baseColor = QColor(18, 18, 18);
    QColor surfaceColor = QColor(26, 26, 26);
    QColor accentColor = QColor(0, 191, 255); // Deep Sky Blue / Cyan
    QColor textColor = QColor(230, 230, 230);
    QColor mutedTextColor = QColor(150, 150, 150);
    
    modernPalette.setColor(QPalette::Window, baseColor);
    modernPalette.setColor(QPalette::WindowText, textColor);
    modernPalette.setColor(QPalette::Base, QColor(10, 10, 10));
    modernPalette.setColor(QPalette::AlternateBase, surfaceColor);
    modernPalette.setColor(QPalette::Text, Qt::white);
    modernPalette.setColor(QPalette::Button, surfaceColor);
    modernPalette.setColor(QPalette::ButtonText, Qt::white);
    modernPalette.setColor(QPalette::Highlight, accentColor);
    modernPalette.setColor(QPalette::HighlightedText, Qt::black);
    modernPalette.setColor(QPalette::PlaceholderText, mutedTextColor);

    app->setPalette(modernPalette);

    QString qss = 
        "QMainWindow { background-color: #121212; color: #E0E0E0; }"
        "QGroupBox { font-size: 13px; font-weight: bold; border: 1px solid #333333; border-radius: 12px; margin-top: 18px; padding-top: 15px; background-color: #1A1A1A; }"
        "QGroupBox::title { subcontrol-origin: margin; subcontrol-position: top left; left: 15px; padding: 0 8px; color: #00BFFF; }"
        "QPushButton { background-color: #2D2D2D; color: #FFFFFF; border: 1px solid #3D3D3D; border-radius: 8px; padding: 6px 16px; font-weight: 500; font-size: 12px; }"
        "QPushButton:hover { background-color: #3D3D3D; border: 1px solid #00BFFF; }"
        "QPushButton:pressed { background-color: #1A1A1A; }"
        "QPushButton#sliderLabel { background: qlineargradient(x1:0, y1:0, x2:1, y2:1, stop:0 #00BFFF, stop:1 #007ACC); border: none; border-radius: 20px; font-size: 18px; font-weight: bold; color: white; min-width: 90px; min-height: 40px; box-shadow: 0 4px 15px rgba(0, 191, 255, 0.3); }"
        "QPushButton#sliderLabel:hover { background: qlineargradient(x1:0, y1:0, x2:1, y2:1, stop:0 #33CCFF, stop:1 #3399FF); }"
        "QSlider::groove:horizontal { border: none; height: 6px; background: #262626; margin: 2px 0; border-radius: 3px; }"
        "QSlider::handle:horizontal { background: #00BFFF; border: 3px solid #1A1A1A; width: 18px; height: 18px; margin: -7px 0; border-radius: 10px; }"
        "QSlider::sub-page:horizontal { background-color: #00BFFF; border-radius: 3px; }"
        "QLineEdit { background-color: #0F0F0F; color: white; border: 1px solid #333333; border-radius: 18px; padding: 6px 18px; font-size: 12px; }"
        "QLineEdit:focus { border: 1px solid #00BFFF; background-color: #151515; }"
        "QTreeWidget { background-color: #161616; border: 1px solid #2A2A2A; border-radius: 10px; color: #DCDCDC; alternate-background-color: #1A1A1A; outline: 0; }"
        "QTreeWidget::item { height: 38px; border-bottom: 1px solid #222; padding-left: 5px; }"
        "QTreeWidget::item:hover { background-color: #222222; }"
        "QTreeWidget::item:selected { background-color: rgba(0, 191, 255, 0.1); color: #00BFFF; font-weight: bold; }"
        "QHeaderView::section { background-color: #1F1F1F; color: #777; padding: 8px; border: none; border-bottom: 1px solid #2A2A2A; font-weight: bold; text-transform: uppercase; font-size: 10px; }"
        "QScrollBar:vertical { border: none; background: #121212; width: 12px; margin: 0px; }"
        "QScrollBar::handle:vertical { background: #333; min-height: 25px; border-radius: 6px; margin: 2px; }"
        "QScrollBar::handle:vertical:hover { background: #00BFFF; }"
        "QCheckBox { spacing: 8px; color: #B0B0B0; }"
        "QCheckBox::indicator { width: 18px; height: 18px; border-radius: 5px; border: 2px solid #333; background-color: #0F0F0F; }"
        "QCheckBox::indicator:checked { background-color: #00BFFF; border: 2px solid #00BFFF; }"
        "QMenuBar { background-color: #121212; color: #A0A0A0; border-bottom: 1px solid #222; font-weight: 500; }"
        "QMenuBar::item { spacing: 3px; padding: 6px 12px; background: transparent; }"
        "QMenuBar::item:selected { background: #1F1F1F; color: white; border-radius: 4px; }"
        "QMenu { background-color: #1F1F1F; color: #E0E0E0; border: 1px solid #2A2A2A; border-radius: 6px; padding: 6px; }"
        "QMenu::item { padding: 6px 24px 6px 24px; border-radius: 4px; margin: 2px 0; }"
        "QMenu::item:selected { background-color: #00BFFF; color: black; }"
        "QMenu::separator { height: 1px; background: #333; margin: 6px 10px; }"
        "QLabel#processMonitorLabel { color: #777; font-size: 11px; margin-top: 4px; }";

    app->setStyleSheet(qss);
}

void ThemeUtils::setLightTheme()
{
    QApplication* app = static_cast<QApplication*>(QApplication::instance());
    if (!app) return;

    // 浅色模式优先使用 WindowsVista (原生) 风格
    QStyle* style = QStyleFactory::create("Fusion");
    if (!style) {
        style = QStyleFactory::create("Windows");
    }
    app->setStyle(style);
    
    // 恢复默认调色板
    app->setPalette(style->standardPalette());
    
    // 清除全局样式表
    app->setStyleSheet("");
}

bool ThemeUtils::isSystemDarkMode()
{
#ifdef Q_OS_WIN
    QSettings settings("HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", QSettings::NativeFormat);
    return settings.value("AppsUseLightTheme", 1).toInt() == 0;
#else
    return false; 
#endif
}
