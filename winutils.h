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
#ifndef WINUTILS_H
#define WINUTILS_H
#include <windows.h>
#include "taskscheduler.h"
#include <QSet>
#include <QString>
#include <string>
#include <tlhelp32.h>
struct ProcessInfo
{
    DWORD pid;
    DWORD parentPid;
    QString name;
    DWORD threadCount;
    bool is64Bit;
    DWORD priorityClass;
    SIZE_T memoryUsage;
};

class winutils
{
  public:
    winutils();

  public:
    // DLL 注入
    static bool injectDll(DWORD processId, const QString& dllPath);

    // 远程 DLL 注入
    static bool injectDllViaCRTA(DWORD processId, const QString& dllPath);
    static bool injectDllViaCRTW(DWORD processId, const QString& dllPath);

    // APC DLL 注入
    static bool injectDllViaAPCA(DWORD processId, const QString& dllPath);
    static bool injectDllViaAPCW(DWORD processId, const QString& dllPath);

    // Windows Hooks 注入
    static bool injectDllViaWHKA(DWORD processId, const QString& dllPath);
    static bool injectDllViaWHKW(DWORD processId, const QString& dllPath);

    // DLL 卸载
    static bool unhookDll(DWORD processId, const QString& dllPath);

    // 检查DLL是否已挂载
    static bool checkDllExist(DWORD processId, const QString& dllPath);

    static bool checkProcessProtection(DWORD processId);

    static void setAutoStart(bool enable,
                             const QString& appName,
                             const QString& execPath);

    static bool isAutoStartEnabled(const QString& appName);

    static BOOL getWindowsVersion(DWORD* majorVersion,
                                  DWORD* minorVersion,
                                  DWORD* buildNumber);

    static QString getWindowsVersion();

    // 获取进程快照
    static QList<ProcessInfo> getProcessList();

    // 获取进程路径
    static QString getProcessPath(DWORD processId);

    // 终止进程
    static bool terminateProcess(DWORD processId);

    // 打开进程所在文件夹
    static void openProcessFolder(DWORD processId);

    // 获取进程中的主线程
    static DWORD getProcessMainThread(DWORD processId);

    static QString getProcessNameById(DWORD processId);

    static bool enableAllPrivilege();
};

#endif // WINUTILS_H
