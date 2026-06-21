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
import { Box, Typography, IconButton } from "@mui/material";
import { KeyComboTag } from "@blueprintjs/core";
import "@blueprintjs/core/lib/css/blueprint.css";
import { platform } from '@tauri-apps/plugin-os';
import { useSnackbar } from "../contexts/SnackbarContext";
import ClearIcon from '@mui/icons-material/Clear';

interface ShortcutFieldProps {
    value: string;
    onChange: (shortcut: string) => void;
    disable?: boolean;
    minWidth?: string;
}

export default function ShortcutField({ value, onChange, disable = false, minWidth = '10rem' }: ShortcutFieldProps) {
    const { t } = useTranslation();
    const [isRecording, setIsRecording] = useState(false);
    const [currentCombo, setCurrentCombo] = useState('');
    const [isHovered, setIsHovered] = useState(false);
    const { notify } = useSnackbar();
    const inputRef = useRef<HTMLDivElement>(null);
    const osRef = useRef<string>("");

    // Load platform once
    useEffect(() => { osRef.current = platform(); }, []);

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
        setIsRecording(true);
        setCurrentCombo('');
    };

    // 当进入录制模式时自动聚焦
    useEffect(() => {
        if (isRecording && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isRecording]);

    // 处理录制取消
    const handleCancelRecording = () => {
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

        setIsRecording(false);
        setCurrentCombo('');
    };

    // 处理清空快捷键
    const handleClear = (event: React.MouseEvent) => {
        event.stopPropagation();
        onChange('');
    };

    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                border: 1,
                borderColor: "divider",
                borderRadius: 1,
                padding: '0.5rem 0.75rem',
                minWidth,
                backgroundColor: disable ? 'action.disabledBackground' : (isRecording ? 'action.selected' : 'background.paper'),
                cursor: disable ? 'not-allowed' : 'pointer',
                opacity: disable ? 0.7 : 1,
            }}
            onClick={handleStartRecording}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}>
            {isRecording ? (
                <Box
                    ref={inputRef}
                    sx={{ width: '100%', display: 'flex', alignItems: 'center', outline: 'none' }}
                    onKeyDown={handleShortcutKeyDown}
                    onKeyUp={handleShortcutKeyUp}
                    onBlur={handleCancelRecording}
                    tabIndex={0}>
                    {currentCombo ? (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            {currentCombo.split('+').map((key, index, array) => (
                                <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <KeyComboTag combo={key === 'Command' ? 'meta' : key} />
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
                value ? (
                    <Box sx={{ width: '100%', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        {value.split('+').map((key, index, array) => (
                            <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <KeyComboTag combo={key === 'Command' ? 'meta' : key} />
                                {index < array.length - 1 && (
                                    <Typography sx={{ fontSize: '0.875rem', color: 'text.secondary' }}>+</Typography>
                                )}
                            </Box>
                        ))}
                    </Box>
                ) : (
                    <Box sx={{ width: '100%', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <KeyComboTag combo={t("shortcut.notSet")} />
                            </Box>
                    </Box>
                )
            )}
            {!isRecording && value && isHovered && (
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