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
#ifndef MAINWINDOW_H
#define MAINWINDOW_H
#include "aboutdialog.h"
#include "config.h"
#include "cpuutils.h"
#include "memutils.h"
#include "preferencedialog.h"
#include "processmonitor.h"
#include "focusmonitor.h"
#include "winutils.h"
#include <QAbstractNativeEventFilter>
#include <QActionGroup>
#include <QMainWindow>
#include <QSettings>
#include <QSystemTrayIcon>
#include <QtWinExtras/QWinTaskbarButton>
#include <QtWinExtras/QWinTaskbarProgress>
#define CONFIG_SLIDERVALUE_KEY "MainWindow/SliderValue"

QT_BEGIN_NAMESPACE
namespace Ui
{
class MainWindow;
}
QT_END_NAMESPACE

class MainWindow
  : public QMainWindow
  , public QAbstractNativeEventFilter
{
    Q_OBJECT

  public:
    MainWindow(QWidget* parent = nullptr);
    ~MainWindow();

  private slots:
    void recreate();

    void refresh();

    void on_sliderCtrl_valueChanged(int value);

    void on_sliderInputSpinBox_editingFinished();

    void on_processNameFilter_textChanged(const QString& text);

    void iconActivated(QSystemTrayIcon::ActivationReason reason);

    void recreateTray();

    void on_sliderLabel_clicked();

    void on_autoStartCheckBox_stateChanged(int arg1);
    void on_alwaysOnTopAction_triggered(bool checked);
    void applySearchFilter();
    void on_autoSpeedAction_triggered(bool checked);
    void onForegroundProcessChanged(DWORD pid);
    void refreshProfilesMenu();
    void switchProfile(const QString& name);
    void addNewProfile();

  private:
    Ui::MainWindow* ui;
    AboutDialog* m_aboutDlg;
    PreferenceDialog* m_preferenceDlg;

    QThread* m_thread;
    ProcessMonitor* m_processMonitor;
    QTimer* m_timer;

    QSystemTrayIcon* trayIcon;
    QMenu* trayMenu;
    QAction* showAction;
    QAction* hideAction;
    QAction* quitAction;

    CpuUtils* m_cpu;
    MemUtils* m_mem;

    QSettings* m_settings;

    int m_back;

    QActionGroup* m_languageGroup;
    QActionGroup* m_themeGroup;

    void init();

    void createTray();

    double speedFactor(int sliderValue);

    int sliderValue(double speedFactor);

    void setMiniMode(bool enable);

  private slots:
    void updateRamping();

  protected:
    void closeEvent(QCloseEvent* event) override;
    void showEvent(QShowEvent* event) override;

    bool nativeEventFilter(const QByteArray& eventType,
                           void* message,
                           long* result) override;

    double m_targetFactor;
    double m_currentFactor;
    QTimer* m_rampingTimer;
    QTimer* m_searchDebounceTimer;
    OverlayWidget* m_overlay;
    QMenu* m_profilesMenu;
    QWinTaskbarButton* m_taskbarButton;
    QWinTaskbarProgress* m_taskbarProgress;
    bool m_isMiniMode;
    bool m_alwaysOnTop;
    bool m_autoSpeedEnabled;
    FocusMonitor* m_focusMonitor;
};
#endif // MAINWINDOW_H
