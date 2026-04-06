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
#ifndef PROCESSMONITOR_H
#define PROCESSMONITOR_H
#include <windows.h>
#include "winutils.h"
#include <QLabel>
#include <QMap>
#include <QObject>
#include <QProcess>
#include <QSettings>
#include <QThread>
#include <QTimer>
#include <QTreeWidget>
#include <tlhelp32.h>

#define CONFIG_TARGETNAMES_KEY "ProcessMonitor/TargetNames"
#define CONFIG_FAVORITENAMES_KEY "ProcessMonitor/FavoriteNames"
#define CONFIG_AUTOSPEED_KEY "ProcessMonitor/AutoSpeed"

class ProcessMonitor : public QObject
{
Q_OBJECT
public:
explicit ProcessMonitor(QSettings*   settings,
                        QTreeWidget* treeWidget,
                        QLabel*      treeStatusLabel,
                        QLabel*      injector32StatusLabel,
                        QLabel*      injector64StatusLabel,

                        QObject*     parent = nullptr);
~ProcessMonitor();

// 设置刷新间隔（毫秒）
void setInterval(int msec);
// 设置过滤
void setFilter(QString processName);

void changeSpeed(double factor);

public slots:
// 定时刷新槽函数
void start();

bool isTarget(DWORD pid) const;
bool isFavorite(const QString& name) const;
void toggleFavorite(const QString& name);

void setAutoSpeedEnabled(bool enabled) { m_autoSpeedEnabled = enabled; }
bool autoSpeedEnabled() const { return m_autoSpeedEnabled; }

signals:
void processFound(DWORD pid, bool isTarget);

private slots:
void onItemChanged(QTreeWidgetItem* item, int column);
void showContextMenu(const QPoint& pos);
void openFolder();
void terminateProcess();

private:
QTreeWidget* m_treeWidget;
QLabel* m_treeStatusLabel;
QLabel* m_injector32StatusLabel;
QLabel* m_injector64StatusLabel;
QString m_filter;
QTimer* m_timer = nullptr;
QString m_dllPath;

QProcess* m_bridge32;
QProcess* m_bridge64;

QSettings* m_settings;

// 图标缓存
QHash<QString, QIcon> m_iconCache;

// 存储进程ID到TreeWidgetItem的映射
QMap<DWORD, QTreeWidgetItem*> m_processItems;

// 存储需要加速的进程
QSet<QString> m_targetNames;

// 存储收藏（精选）的进程
QSet<QString> m_favoriteNames;

// 是否开启自动加速（当焦点在该进程时）
bool m_autoSpeedEnabled;

void init();

void dump();

void update(const QList<ProcessInfo>& processList);

void injectDll(DWORD processId, bool is64Bit);

void unhookDll(DWORD processId, bool is64Bit);

void startBridge32();

void startBridge64();

void healthcheckBridge();

void terminalBridge();

// 获取进程图标
static QIcon getProcessIcon(QString processPath);

static QIcon getDefaultIcon(const QString& processName);

QIcon getProcessIconCached(DWORD proccessId);
};

class SortTreeWidgetItem : public QTreeWidgetItem
{
public:
SortTreeWidgetItem(QTreeWidget* parent = nullptr)
    : QTreeWidgetItem(parent)
{
}

bool operator<(const QTreeWidgetItem& other) const override
{
    int column = treeWidget()->sortColumn();

    QVariant ldata = this->data(column, Qt::UserRole);
    QVariant rdata = other.data(column, Qt::UserRole);
    if (ldata.isValid() && rdata.isValid())
    {
        if (ldata.type() == QVariant::UInt && rdata.type() == QVariant::UInt)
        {
            return ldata.toUInt() < rdata.toUInt();
        }
        else
        {
            return ldata.toString() < rdata.toString();
        }
    }
    else
    {
        QString ltext = this->text(column);
        QString rtext = other.text(column);
        return ltext < rtext;
    }
}

bool operator>(const QTreeWidgetItem& other) const
{
    int column = treeWidget()->sortColumn();

    QVariant ldata = this->data(column, Qt::UserRole);
    QVariant rdata = other.data(column, Qt::UserRole);
    if (ldata.isValid() && rdata.isValid())
    {
        if (ldata.type() == QVariant::UInt && rdata.type() == QVariant::UInt)
        {
            return ldata.toUInt() > rdata.toUInt();
        }
        else
        {
            return ldata.toString() > rdata.toString();
        }
    }
    else
    {
        QString ltext = this->text(column);
        QString rtext = other.text(column);
        return ltext > rtext;
    }
}
};

#endif // PROCESSMONITOR_H
