/**
 * MIT License
 * 
 * Copyright (c) 2026 game1024
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { shortcutLabel } from "../hooks/useShortcut";
import { Box, Typography, IconButton } from "@mui/material";
import { KeyComboTag } from "@blueprintjs/core";
import "@blueprintjs/core/lib/css/blueprint.css";
import { platform } from '@tauri-apps/plugin-os';
import { useSnackbar } from "../contexts/SnackbarContext";
import { resumeShortcuts, suspendShortcuts } from "../hooks/useShortcut";
import ClearIcon from '@mui/icons-material/Clear';

interface ShortcutFieldProps {
    value: string;
    onChange: (shortcut: string) => void;
    disable?: boolean;
    minWidth?: string;
    conflict?: boolean;
    /** When set, an empty value shows this global shortcut faded, with an inherit caption. */
    inheritFrom?: string;
    /** Profile slot saved as "no shortcut", so the global key is not used. */
    muted?: boolean;
    onRestore?: () => void;
}

/**
 * Shortcuts are stored in the form the backend parses (`NUMPAD1`, `NUMPADADD`,
 * …). KeyComboTag prints anything it does not recognise verbatim, so numpad
 * keys are turned back into something a keycap would actually say.
 */
function displayKey(key: string): string {
    if (key === "Command") return "meta";

    const numpad = /^NUMPAD(.+)$/.exec(key);
    if (!numpad) return key;

    // KeyComboTag strips whitespace and splits on "+", so these labels must
    // contain neither — a literal "Num +" would render as two keycaps.
    const rest = numpad[1];
    if (/^\d$/.test(rest)) return `Num${rest}`;
    switch (rest) {
        case "ADD": return "NumPlus";
        case "SUBTRACT": return "Num-";
        case "MULTIPLY": return "Num*";
        case "DIVIDE": return "Num/";
        case "DECIMAL": return "Num.";
        case "ENTER": return "NumEnter";
        default: return key;
    }
}

/** Browsers report mouse buttons as 0 left, 1 middle, 2 right, 3 back, 4 forward. */
function mouseButtonToken(button: number): string | null {
    switch (button) {
        case 0: return "MouseLeft";
        case 1: return "MouseMiddle";
        case 2: return "MouseRight";
        case 3: return "Mouse4";
        case 4: return "Mouse5";
        default: return null;
    }
}

/** Convert a wheel delta to the dominant direction token. */
function wheelToken(deltaX: number, deltaY: number): string | null {
    if (deltaX === 0 && deltaY === 0) return null;
    if (Math.abs(deltaY) >= Math.abs(deltaX)) {
        return deltaY < 0 ? "WheelUp" : "WheelDown";
    }
    return deltaX < 0 ? "WheelLeft" : "WheelRight";
}

export default function ShortcutField({ value, onChange, disable = false, minWidth = '10rem', conflict = false, inheritFrom, muted = false, onRestore }: ShortcutFieldProps) {
    const { t } = useTranslation();
    const [isRecording, setIsRecording] = useState(false);
    const [currentCombo, setCurrentCombo] = useState('');
    const [isHovered, setIsHovered] = useState(false);
    const { notify } = useSnackbar();
    const inputRef = useRef<HTMLDivElement>(null);
    const osRef = useRef<string>("");
    const onChangeRef = useRef(onChange);
    const padCaptured = useRef(false);
    onChangeRef.current = onChange;
    const suspendedRef = useRef(false);

    function suspendForRecording() {
        if (suspendedRef.current) return;
        suspendedRef.current = true;
        void suspendShortcuts();
    }

    function resumeAfterRecording() {
        if (!suspendedRef.current) return;
        suspendedRef.current = false;
        void resumeShortcuts();
    }

    // Load platform once. If the field unmounts mid-recording, put the hotkeys back.
    useEffect(() => {
        osRef.current = platform();
        return () => { resumeAfterRecording(); };
    }, []);

    // 处理快捷键输入
    const handleShortcutKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (!isRecording) return;

        event.preventDefault();
        event.stopPropagation();

        // 构建当前按键组合用于实时显示
        const keys: string[] = [];

        if (event.ctrlKey) keys.push('Ctrl');
        if (event.shiftKey) keys.push('Shift');
        if (event.altKey) keys.push('Alt');

        // Windows 不支持 Meta 键（Win 键）作为全局快捷键
        const os = osRef.current;
        if (event.metaKey) {
            switch (os) {
                case 'windows':
                    notify('不支持使用 Win 键作为快捷键', 'warning');
                    return;
                case 'macos':
                    keys.push('Command');
                    break;
                case 'linux':
                    notify('不支持使用 Meta 键作为快捷键', 'warning');
                    break;
            }
        }

        // 过滤掉单独的修饰键
        const isModifierKey = ['Control', 'Shift', 'Alt', 'Meta'].includes(event.key);

        if (!isModifierKey) {
            // 使用 event.code 来获取物理按键，避免 Shift 等修饰键影响
            let mainKey = event.key;

            // 处理数字键（避免 Shift+1 变成 !）
            if (event.code.startsWith('Digit')) {
                mainKey = event.code.replace('Digit', '');
            }
            // 处理字母键
            else if (event.code.startsWith('Key')) {
                mainKey = event.code.replace('Key', '');
            }
            // 处理小键盘：必须用 event.code，NumLock 关闭时 event.key 会变成
            // End/ArrowDown 之类，只有 code 始终指向物理按键
            else if (event.code.startsWith('Numpad')) {
                // global-hotkey 把 NumpadEqual 映射成了 VK_E（字母 E 的虚拟键码），
                // 放行的话会把 E 键注册成快捷键
                if (event.code === 'NumpadEqual') {
                    notify(t("shortcut.keyNotSupported"), 'warning');
                    return;
                }
                // Numpad1 → NUMPAD1，与 global-hotkey 的键名一一对应
                mainKey = event.code.toUpperCase();
            }
            // 处理特殊键
            else if (event.code.startsWith('Arrow')) {
                mainKey = event.code; // ArrowUp, ArrowDown 等
            }
            else if (event.code === 'Minus') {
                mainKey = '-';
            }
            else if (event.code === 'Equal') {
                mainKey = '=';
            }
            else if (event.code === 'Backquote') {
                mainKey = '`';
            }
            else if (event.code === 'BracketLeft') {
                mainKey = '[';
            }
            else if (event.code === 'BracketRight') {
                mainKey = ']';
            }
            else if (event.code === 'Backslash') {
                mainKey = '\\';
            }
            else if (event.code === 'Semicolon') {
                mainKey = ';';
            }
            else if (event.code === 'Quote') {
                mainKey = '\'';
            }
            else if (event.code === 'Comma') {
                mainKey = ',';
            }
            else if (event.code === 'Period') {
                mainKey = '.';
            }
            else if (event.code === 'Slash') {
                mainKey = '/';
            }
            else if (event.code === 'Space') {
                mainKey = 'Space';
            }
            // 其他按键保持原样（如 Enter, Escape等）
            else {
                mainKey = event.key.length === 1 ? event.key.toUpperCase() : event.key;
            }
            keys.push(mainKey);
        }

        // 实时显示当前组合
        const combo = keys.join('+');
        setCurrentCombo(combo);

        // 只有在按下非修饰键时才保存
        if (!isModifierKey) {
            onChange(combo);
            resumeAfterRecording();
            setIsRecording(false);
            setCurrentCombo('');
        }
    };

    // 处理按键松开
    const handleShortcutKeyUp = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (!isRecording) return;

        event.preventDefault();
        event.stopPropagation();

        // 实时更新当前按下的修饰键组合
        const keys: string[] = [];
        if (event.ctrlKey) keys.push('Ctrl');
        if (event.shiftKey) keys.push('Shift');
        if (event.altKey) keys.push('Alt');

        const os = osRef.current;
        if (event.metaKey) {
            switch (os) {
                case 'windows':
                    notify('不支持使用 Win 键作为快捷键', 'warning');
                    return;
                case 'macos':
                    keys.push('Command');
                    break;
                case 'linux':
                    notify('不支持使用 Meta 键作为快捷键', 'warning');
                    break;
            }
        }

        setCurrentCombo(keys.join('+'));
    };

    // 处理录制开始
    const handleStartRecording = () => {
        if (disable) return;
        padCaptured.current = false;
        suspendForRecording();
        setIsRecording(true);
        setCurrentCombo('');
    };

    // Use mousedown rather than click to start: a mouse chord is also saved on
    // mousedown, and the click that follows would start a second recording.
    const handleContainerMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
        if (isRecording || disable || event.button !== 0) return;
        // Clear / restore-inherit controls are real buttons; let them handle it.
        if (event.target instanceof Element && event.target.closest('button')) return;
        handleStartRecording();
    };

    const handleShortcutMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
        if (!isRecording) return;

        event.preventDefault();
        event.stopPropagation();

        const mainKey = mouseButtonToken(event.button);
        if (!mainKey) {
            notify(t("shortcut.keyNotSupported"), 'warning');
            return;
        }

        const keys: string[] = [];
        if (event.ctrlKey) keys.push('Ctrl');
        if (event.shiftKey) keys.push('Shift');
        if (event.altKey) keys.push('Alt');

        // Same platform policy as keyboard recording.
        const os = osRef.current;
        if (event.metaKey) {
            switch (os) {
                case 'windows':
                    notify('不支持使用 Win 键作为快捷键', 'warning');
                    return;
                case 'macos':
                    keys.push('Command');
                    break;
                case 'linux':
                    notify('不支持使用 Meta 键作为快捷键', 'warning');
                    return;
            }
        }

        keys.push(mainKey);
        onChange(keys.join('+'));
        resumeAfterRecording();
        setIsRecording(false);
        setCurrentCombo('');
    };

    // 当进入录制模式时自动聚焦
    useEffect(() => {
        if (isRecording && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isRecording]);

    // React attaches wheel listeners as passive, so use a native listener to
    // both capture the direction and stop the settings page from scrolling.
    useEffect(() => {
        if (!isRecording) return;
        const node = inputRef.current;
        if (!node) return;

        const handleWheel = (event: WheelEvent) => {
            const mainKey = wheelToken(event.deltaX, event.deltaY);
            if (!mainKey) return;
            event.preventDefault();
            event.stopPropagation();

            const keys: string[] = [];
            if (event.ctrlKey) keys.push('Ctrl');
            if (event.shiftKey) keys.push('Shift');
            if (event.altKey) keys.push('Alt');

            const os = osRef.current;
            if (event.metaKey) {
                switch (os) {
                    case 'windows':
                        notify('不支持使用 Win 键作为快捷键', 'warning');
                        return;
                    case 'macos':
                        keys.push('Command');
                        break;
                    case 'linux':
                        notify('不支持使用 Meta 键作为快捷键', 'warning');
                        return;
                }
            }

            keys.push(mainKey);
            onChangeRef.current(keys.join('+'));
            resumeAfterRecording();
            setIsRecording(false);
            setCurrentCombo('');
        };

        node.addEventListener('wheel', handleWheel, { passive: false });
        return () => node.removeEventListener('wheel', handleWheel);
    }, [isRecording]);

    // Keyboard capture only sees keys. Held pad buttons are a preview; the
    // shortcut is written when a button is released.
    useEffect(() => {
        if (!isRecording) return;
        let heldStop: UnlistenFn | undefined;
        let captureStop: UnlistenFn | undefined;
        let dead = false;
        listen<{ tokens: string[] }>("gamepad-held", (event) => {
            const tokens = event.payload.tokens.filter(Boolean);
            if (tokens.length === 0) return;
            setCurrentCombo(tokens.join("+"));
        }).then((stop) => {
            if (dead) stop();
            else heldStop = stop;
        });
        listen<{ binding: string }>("gamepad-capture", (event) => {
            if (!event.payload.binding) return;
            padCaptured.current = true;
            onChangeRef.current(event.payload.binding);
            resumeAfterRecording();
            setIsRecording(false);
            setCurrentCombo("");
        }).then((stop) => {
            if (dead) stop();
            else captureStop = stop;
        });
        return () => {
            dead = true;
            heldStop?.();
            captureStop?.();
        };
    }, [isRecording]);

    // 处理录制取消
    const handleCancelRecording = () => {
        if (padCaptured.current) {
            padCaptured.current = false;
            resumeAfterRecording();
            setIsRecording(false);
            setCurrentCombo('');
            return;
        }
        // 如果有已按下的组合键，保存它
        if (currentCombo) {
            // 检查是否只有修饰键（不包含实际功能键）
            const modifierKeys = ['Ctrl', 'Shift', 'Alt', 'Meta'];
            const keys = currentCombo.split('+');
            const hasNonModifierKey = keys.some(key => !modifierKeys.includes(key));

            // 只有包含非修饰键时才保存
            if (hasNonModifierKey) {
                onChange(currentCombo);
            }
        }

        resumeAfterRecording();
        setIsRecording(false);
        setCurrentCombo('');
    };

    // 处理清空快捷键
    const handleClear = (event: React.MouseEvent) => {
        event.stopPropagation();
        onChange('');
    };

    const mouseLabels: Record<string, string> = {
        MouseLeft: t("shortcut.mouseLeft"),
        MouseMiddle: t("shortcut.mouseMiddle"),
        MouseRight: t("shortcut.mouseRight"),
        Mouse4: t("shortcut.mouse4"),
        Mouse5: t("shortcut.mouse5"),
        WheelUp: t("shortcut.wheelUp"),
        WheelDown: t("shortcut.wheelDown"),
        WheelLeft: t("shortcut.wheelLeft"),
        WheelRight: t("shortcut.wheelRight"),
    };
    const keyLabel = (key: string) => mouseLabels[key] ?? displayKey(key);

    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                border: 1,
                borderColor: conflict ? "error.main" : "divider",
                // Inheriting from the global config: dashed border instead of
                // an extra "inherited" caption.
                borderStyle: inheritFrom !== undefined ? "dashed" : "solid",
                borderRadius: 1,
                padding: '0.5rem 0.75rem',
                minWidth,
                backgroundColor: disable ? 'action.disabledBackground' : (isRecording ? 'action.selected' : 'background.paper'),
                cursor: disable ? 'not-allowed' : 'pointer',
                opacity: disable ? 0.7 : 1,
            }}
            onMouseDown={handleContainerMouseDown}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}>
            {isRecording ? (
                <Box
                    ref={inputRef}
                    sx={{ width: '100%', display: 'flex', alignItems: 'center', outline: 'none' }}
                    onKeyDown={handleShortcutKeyDown}
                    onKeyUp={handleShortcutKeyUp}
                    onMouseDown={handleShortcutMouseDown}
                    onContextMenu={(event) => event.preventDefault()}
                    onBlur={handleCancelRecording}
                    tabIndex={0}>
                    {currentCombo ? (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            {currentCombo.split('+').map((key, index, array) => (
                                <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <KeyComboTag combo={keyLabel(key)} />
                                    {index < array.length - 1 && (
                                        <Typography sx={{ fontSize: '0.875rem', color: 'text.secondary' }}>+</Typography>
                                    )}
                                </Box>
                            ))}
                        </Box>
                    ) : (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <KeyComboTag combo="按下快捷键" />
                        </Box>
                    )}
                </Box>
            ) : (
                (value || inheritFrom !== undefined || muted) ? (
                    <Box sx={{ width: '100%', display: 'flex', alignItems: 'center', gap: 0.5, opacity: value || muted ? 1 : 0.45 }}>
                        {conflict && (
                            <Typography variant="caption" sx={{ color: "error.main", fontWeight: 600, mr: 0.5 }}>
                                ⚠
                            </Typography>
                        )}
                        {muted ? (
                            <KeyComboTag combo={t("shortcut.notSet")} />
                        ) : (value || inheritFrom) ? (
                            shortcutLabel(value || inheritFrom || "").split('+').map((key, index, array) => (
                                <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <KeyComboTag combo={keyLabel(key)} />
                                    {index < array.length - 1 && (
                                        <Typography sx={{ fontSize: '0.875rem', color: 'text.secondary' }}>+</Typography>
                                    )}
                                </Box>
                            ))
                        ) : (
                            <KeyComboTag combo={t("shortcut.notSet")} />
                        )}
                        {muted && onRestore && (
                            <Typography
                                component="button"
                                variant="caption"
                                color="text.disabled"
                                onClick={event => { event.stopPropagation(); onRestore(); }}
                                sx={{ border: 0, bgcolor: "transparent", cursor: "pointer", p: 0 }}
                            >
                                {t("shortcut.restoreInherit")}
                            </Typography>
                        )}
                    </Box>
                ) : (
                    <Box sx={{ width: '100%', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <KeyComboTag combo={t("shortcut.notSet")} />
                            </Box>
                    </Box>
                )
            )}
            {!isRecording && isHovered && (value || (inheritFrom && inheritFrom.length > 0)) && (
                <IconButton
                    size="small"
                    onClick={handleClear}
                    sx={{
                        display: disable ? 'none' : 'flex',
                        padding: '0.25rem',
                        '&:hover': {
                            backgroundColor: 'action.hover',
                        }
                    }}
                >
                    <ClearIcon sx={{ fontSize: '1rem', color: 'text.secondary' }} />
                </IconButton>
            )}
        </Box>
    );
}