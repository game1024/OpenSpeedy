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
#ifndef CONFIG_H
#define CONFIG_H

#define OPENSPEEDY_VERSION "v1.8.1"

#define BRIDGE32_EXE "bridge32.exe"
#define BRIDGE64_EXE "bridge64.exe"

#define SPEEDPATCH32_DLL "speedpatch32.dll"
#define SPEEDPATCH64_DLL "speedpatch64.dll"

#define CONFIG_LANGUAGE "General/Language"
#define CONFIG_THEME "General/Theme"

#define CONFIG_PROFILES_KEY "Profiles/List"
#define CONFIG_CURRENT_PROFILE_KEY "Profiles/Current"

// 热键ID
enum HotkeyIds
{
    HOTKEY_INCREASE_SPEED = 1001,
    HOTKEY_DECREASE_SPEED = 1002,
    HOTKEY_RESET_SPEED = 1003,
    HOTKEY_SHIFT1 = 1011,
    HOTKEY_SHIFT2 = 1012,
    HOTKEY_SHIFT3 = 1013,
    HOTKEY_SHIFT4 = 1014,
    HOTKEY_SHIFT5 = 1015
};

#endif // CONFIG_H
