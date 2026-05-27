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
#include "qsinglekeysequenceedit.h"
#include <QDebug>

QSingleKeySequenceEdit::QSingleKeySequenceEdit(QWidget* parent)
  : QKeySequenceEdit(parent)
{
    setStyleSheet(":focus {"
                  "    border: 2px solid #3498db;"
                  "    background-color: #ebf3fd;"
                  "    font-weight: bold;"
                  "    outline: none;"
                  "}");

    connect(this,
            &QKeySequenceEdit::keySequenceChanged,
            this,
            &QSingleKeySequenceEdit::update);
}

UINT
QSingleKeySequenceEdit::getVK()
{
    return toVK(m_key, m_modifier);
}

UINT
QSingleKeySequenceEdit::getModifier()
{
    return toModifier(m_modifier);
}

QtCombinedKey
QSingleKeySequenceEdit::getQtCombinedKey()
{
    return QtCombinedKey{ m_key, m_modifier };
}

QString
QSingleKeySequenceEdit::getKeyText()
{
    return keySequence().toString(QKeySequence::NativeText);
}

void
QSingleKeySequenceEdit::keyPressEvent(QKeyEvent* event)
{
    int key = event->key();
    Qt::KeyboardModifiers modifiers = event->modifiers();

    // 忽略单独的修饰键
    if (isModifierKey(key))
    {
        return;
    }

    // Backspace 或 Delete 清除快捷键
    if (key == Qt::Key_Backspace || key == Qt::Key_Delete)
    {
        m_key = 0;
        m_modifier = Qt::NoModifier;
        clear();
        emit editingFinished();
        clearFocus();
        return;
    }

    m_key = key;
    m_modifier = modifiers;

    // 创建单个按键序列
    QKeySequence singleKey(key | modifiers);
    setKeySequence(singleKey);

    // 🔚 结束编辑
    emit editingFinished();
    clearFocus();
}

void
QSingleKeySequenceEdit::update()
{
    QKeySequence sequence = keySequence();

    if (sequence.isEmpty())
    {
        m_key = 0;
        m_modifier = Qt::NoModifier;
    }
    else
    {
        int combinedKey = sequence[0];
        m_modifier =
          Qt::KeyboardModifiers(combinedKey & Qt::KeyboardModifierMask);
        m_key = combinedKey & ~Qt::KeyboardModifierMask;
    }
}

bool
QSingleKeySequenceEdit::isModifierKey(int key) const
{
    return (key == Qt::Key_Control || key == Qt::Key_Alt ||
            key == Qt::Key_Shift || key == Qt::Key_Meta);
}

UINT
QSingleKeySequenceEdit::toVK(int qtKey, Qt::KeyboardModifiers qtMod)
{
    // 🔤 字母键 A-Z
    if (qtKey >= Qt::Key_A && qtKey <= Qt::Key_Z)
    {
        return qtKey; // Qt 和 Windows 的 A-Z 键码相同
    }

    // 🔢 小键盘 0-9
    if (qtMod & Qt::KeypadModifier)
    {
        switch (qtKey)
        {
                // 数字键盘
            case Qt::Key_0:
                return VK_NUMPAD0;
            case Qt::Key_1:
                return VK_NUMPAD1;
            case Qt::Key_2:
                return VK_NUMPAD2;
            case Qt::Key_3:
                return VK_NUMPAD3;
            case Qt::Key_4:
                return VK_NUMPAD4;
            case Qt::Key_5:
                return VK_NUMPAD5;
            case Qt::Key_6:
                return VK_NUMPAD6;
            case Qt::Key_7:
                return VK_NUMPAD7;
            case Qt::Key_8:
                return VK_NUMPAD8;
            case Qt::Key_9:
                return VK_NUMPAD9;
        }
    }

    // 🔢 数字键 0-9
    if (qtKey >= Qt::Key_0 && qtKey <= Qt::Key_9)
    {
        return qtKey; // Qt 和 Windows 的 0-9 键码相同
    }

    // 🎯 功能键映射
    switch (qtKey)
    {
        // F1-F12
        case Qt::Key_F1:
            return VK_F1;
        case Qt::Key_F2:
            return VK_F2;
        case Qt::Key_F3:
            return VK_F3;
        case Qt::Key_F4:
            return VK_F4;
        case Qt::Key_F5:
            return VK_F5;
        case Qt::Key_F6:
            return VK_F6;
        case Qt::Key_F7:
            return VK_F7;
        case Qt::Key_F8:
            return VK_F8;
        case Qt::Key_F9:
            return VK_F9;
        case Qt::Key_F10:
            return VK_F10;
        case Qt::Key_F11:
            return VK_F11;
        case Qt::Key_F12:
            return VK_F12;

        // 方向键
        case Qt::Key_Left:
            return VK_LEFT;
        case Qt::Key_Right:
            return VK_RIGHT;
        case Qt::Key_Up:
            return VK_UP;
        case Qt::Key_Down:
            return VK_DOWN;

        // 特殊键
        case Qt::Key_Enter:
        case Qt::Key_Return:
            return VK_RETURN;
        case Qt::Key_Escape:
            return VK_ESCAPE;
        case Qt::Key_Tab:
            return VK_TAB;
        case Qt::Key_Backspace:
            return VK_BACK;
        case Qt::Key_Delete:
            return VK_DELETE;
        case Qt::Key_Insert:
            return VK_INSERT;
        case Qt::Key_Home:
            return VK_HOME;
        case Qt::Key_End:
            return VK_END;
        case Qt::Key_PageUp:
            return VK_PRIOR;
        case Qt::Key_PageDown:
            return VK_NEXT;
        case Qt::Key_Space:
            return VK_SPACE;

        // 符号键
        case Qt::Key_Semicolon:
            return VK_OEM_1; // ;
        case Qt::Key_Equal:
            return VK_OEM_PLUS; // =
        case Qt::Key_Comma:
            return VK_OEM_COMMA; // ,
        case Qt::Key_Minus:
            return VK_OEM_MINUS; // -
        case Qt::Key_Period:
            return VK_OEM_PERIOD; // .
        case Qt::Key_Slash:
            return VK_OEM_2; // /
        case Qt::Key_QuoteLeft:
            return VK_OEM_3; // `
        case Qt::Key_BracketLeft:
            return VK_OEM_4; // [
        case Qt::Key_Backslash:
            return VK_OEM_5; //
        case Qt::Key_BracketRight:
            return VK_OEM_6; // ]
        case Qt::Key_Apostrophe:
            return VK_OEM_7; // '

        // 其他常用键
        case Qt::Key_CapsLock:
            return VK_CAPITAL;
        case Qt::Key_NumLock:
            return VK_NUMLOCK;
        case Qt::Key_ScrollLock:
            return VK_SCROLL;
        case Qt::Key_Pause:
            return VK_PAUSE;
        case Qt::Key_Print:
            return VK_PRINT;

        default:
            qDebug() << "Unknown Qt key:" << qtKey;
            return 0; // 未知按键
    }
}

UINT
QSingleKeySequenceEdit::toModifier(Qt::KeyboardModifiers qtMod)
{
    UINT winMod = 0;

    if (qtMod & Qt::ControlModifier)
    {
        winMod |= MOD_CONTROL;
    }
    if (qtMod & Qt::AltModifier)
    {
        winMod |= MOD_ALT;
    }
    if (qtMod & Qt::ShiftModifier)
    {
        winMod |= MOD_SHIFT;
    }
    if (qtMod & Qt::MetaModifier)
    {
        winMod |= MOD_WIN; // Windows 键
    }

    return winMod;
}

QString
QSingleKeySequenceEdit::wrapText(QString keyText)
{
    if (keyText.isEmpty())
    {
        return QStringLiteral("无");
    }
    return keyText.replace("Up", "⬆️")
      .replace("Down", "⬇️")
      .replace("Left", "⬅️")
      .replace("Right", "➡️");
}

QtCombinedKey
QSingleKeySequenceEdit::toQtCombinedKey(const QString& keyText)
{
    QKeySequence sequence = QKeySequence(keyText);

    if (!sequence.isEmpty())
    {
        int combinedKey = sequence[0];
        Qt::KeyboardModifiers modifier =
          Qt::KeyboardModifiers(combinedKey & Qt::KeyboardModifierMask);
        int key = combinedKey & ~Qt::KeyboardModifierMask;
        return QtCombinedKey{ key, modifier };
    }
    else
    {
        return QtCombinedKey{ 0, Qt::NoModifier };
    }
}
