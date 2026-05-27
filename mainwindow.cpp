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
#include "./ui_mainwindow.h"
#include "mainwindow.h"
#include "themeutils.h"

#include <QCloseEvent>
#include <QDateTime>
#include <QDebug>
#include <QDir>
#include <QMessageBox>
#include <QScreen>
#include <QStyle>
MainWindow::MainWindow(QWidget *parent)
    : QMainWindow(parent), ui(new Ui::MainWindow)
{
    ui->setupUi(this);

    QScreen *screen = QGuiApplication::primaryScreen();
    if (screen != nullptr)
    {
        qreal dpiScale = screen->devicePixelRatio();
        QRect screenGeometry = screen->availableGeometry();
        int windowWidth = 1024;
        int windowHeight = 768;

        if (dpiScale >= 2)
        {
            windowWidth = static_cast<int>(1024 / 1.5);
            windowHeight = static_cast<int>(768 / 1.5);
        }

        windowWidth = qMin(windowWidth, screenGeometry.width()-100);
        windowHeight = qMin(windowHeight, screenGeometry.height()-100);
        this->resize(windowWidth, windowHeight);

        int x = (screenGeometry.width() - this->frameGeometry().width()) / 2 ;
        int y = (screenGeometry.height() - this->frameGeometry().height()) /2;
        this->move(x, y);

    }
    init();
}

MainWindow::~MainWindow()
{
    QApplication::instance()->removeNativeEventFilter(this);
    m_thread->quit();
    m_thread->wait();
    delete m_settings;
    delete m_aboutDlg;
    delete m_preferenceDlg;
    delete m_processMonitor;
    delete m_cpu;
    delete m_mem;
    delete ui;
}

void MainWindow::recreate()
{
    // step1: 获取主屏幕的缩放比例
    // step2: 根据缩放比例调整窗口大小
    // step3: 确保窗口不会超出屏幕范围
    QScreen* primaryScreen = QApplication::primaryScreen();
    qreal dpiScale = primaryScreen->devicePixelRatio();
    QRect screenGeometry = primaryScreen->availableGeometry();

    int windowWidth = 1024;
    int windowHeight = 768;

    if (dpiScale >= 2)
    {
        windowWidth = static_cast<int>(1024 / 1.5);
        windowHeight = static_cast<int>(768 / 1.5);
    }

    windowWidth = qMin(windowWidth, screenGeometry.width()-100);
    windowHeight = qMin(windowHeight, screenGeometry.height()-100);
    this->resize(windowWidth, windowHeight);
    layout()->invalidate();
    layout()->activate();
    //adjustSize();
    recreateTray();
}

void MainWindow::refresh()
{
    // 获取当前主题下的高亮文本颜色
    QColor highlightColor = QApplication::palette().color(QPalette::Highlight);
    // 如果是深色模式，使用亮蓝色；如果是浅色模式，使用深蓝色
    QString colorStr = (QApplication::palette().color(QPalette::Window).value() < 128) ? "lightblue" : "blue";

    ui->cpuContent->setText(QString("<span style='color:%1'>%2%</span>")
                            .arg(colorStr)
                            .arg(m_cpu->getUsage(), 5, 'f', 1, ' '));

    double memUsage = m_mem->getUsage();
    double memTotal = m_mem->getTotal();
    ui->memContent->setText(
        QString("<span style='color:%1'>(%2G / %3G) %4%</span>")
        .arg(colorStr)
        .arg(memUsage, 0, 'f', 1)
        .arg(memTotal, 0, 'f', 1)
        .arg(memUsage / memTotal * 100, 4, 'f', 1));
}

void MainWindow::on_sliderCtrl_valueChanged(int value)
{
    double factor = speedFactor(value);

    m_processMonitor->changeSpeed(factor);

    if (factor >= 1.0)
    {
        ui->sliderCtrl->setToolTip(QString(tr("%1倍")).arg(factor, 0, 'f', 2));
        ui->sliderLabel->setText(QString(tr("✖️%1倍")).arg(factor, 0, 'f', 2));
    }
    else
    {
        ui->sliderCtrl->setToolTip(QString(tr("%1倍")).arg(factor, 0, 'f'));
        ui->sliderLabel->setText(QString(tr("✖️%1倍")).arg(factor, 0, 'f'));
    }

    ui->sliderInputSpinBox->setValue(factor);
    m_settings->setValue(CONFIG_SLIDERVALUE_KEY, value);
    m_settings->sync();
}

void MainWindow::on_sliderInputSpinBox_editingFinished()
{
    double factor = ui->sliderInputSpinBox->value();
    ui->sliderInputSpinBox->clearFocus();
    ui->sliderCtrl->setValue(sliderValue(factor));
}

void MainWindow::on_processNameFilter_textChanged(const QString &text)
{
    m_processMonitor->setFilter(text);
}

void MainWindow::on_sliderLabel_clicked()
{
    if (ui->sliderCtrl->value() != 0)
    {
        m_back = ui->sliderCtrl->value();
        ui->sliderCtrl->setValue(0);
    }
    else
    {
        ui->sliderCtrl->setValue(m_back);
    }
}

void MainWindow::iconActivated(QSystemTrayIcon::ActivationReason reason)
{
    {
        switch (reason)
        {
        case QSystemTrayIcon::Trigger: // 单击
            if (isVisible())
                hide();
            else
            {
                show();
                showNormal();
                activateWindow();
            }
            break;
        case QSystemTrayIcon::DoubleClick: // 双击
            show();
            showNormal();
            activateWindow();
            break;
        default:
            break;
        }
    }
}

void MainWindow::createTray()
{
    // 创建系统托盘图标
    trayIcon = new QSystemTrayIcon(this);
    trayIcon->setIcon(QIcon(":/icons/images/icon.ico"));
    trayIcon->setToolTip("OpenSpeedy");

    // 创建托盘菜单、创建动作
    trayMenu = new QMenu(this);
    showAction = new QAction(tr("显示"), this);
    hideAction = new QAction(tr("隐藏"), this);
    quitAction = new QAction(tr("退出"), this);

    // 连接信号和槽
    connect(showAction, &QAction::triggered, this,
            [&]
    {
        showNormal();
        activateWindow();
    });
    connect(hideAction, &QAction::triggered, this, &MainWindow::hide);
    connect(quitAction, &QAction::triggered, qApp, &QApplication::quit);

    // 添加动作到菜单
    trayMenu->addAction(showAction);
    trayMenu->addAction(hideAction);
    trayMenu->addSeparator();
    trayMenu->addAction(quitAction);

    // 设置托盘图标的菜单
    trayIcon->setContextMenu(trayMenu);

    // 处理托盘图标的点击事件
    connect(trayIcon, &QSystemTrayIcon::activated, this,
            &MainWindow::iconActivated);

    // 显示托盘图标
    trayIcon->show();
}

double MainWindow::speedFactor(int sliderValue)
{
    double factor = 1.0;
    if (sliderValue > 0.0)
    {
        factor = 1.0 + (double)sliderValue / 100;
    }
    else if (sliderValue < 0.0)
    {
        factor = 1.0 + (double)sliderValue / 100000;
    }
    else
    {
        factor = 1.0;
    }

    return factor;
}

int MainWindow::sliderValue(double speedFactor)
{
    int sliderValue = 0;
    if (speedFactor > 1.0)
    {
        sliderValue = (long long)(speedFactor * 100) - 100;
    }
    else if (speedFactor < 1.0)
    {
        sliderValue = (long long)(speedFactor * 100000) - 100000;
    }
    else
    {
        sliderValue = 0;
    }
    qDebug() << sliderValue;

    return sliderValue;
}

void MainWindow::recreateTray()
{
    qDebug() << "重绘托盘";
    delete trayMenu;
    delete trayIcon;
    delete showAction;
    delete hideAction;
    delete quitAction;
    createTray();
    adjustSize();
}

void MainWindow::init()
{
    m_back = 0;
    m_settings =
        new QSettings(QCoreApplication::applicationDirPath() + "/config.ini",
                      QSettings::IniFormat);

    m_aboutDlg = new AboutDialog(this);
    m_preferenceDlg =
        new PreferenceDialog((HWND)winId(), m_settings, ui->increaseSpeedLabel,
                             ui->decreaseSpeedLabel, ui->resetSpeedLabel, this);

    // 安装本地事件过滤器以处理全局快捷键
    QApplication::instance()->installNativeEventFilter(this);

    m_processMonitor = new ProcessMonitor(
        m_settings, ui->processMonitorWidget, ui->processMonitorLabel,
        ui->injector32Status, ui->injector64Status, nullptr);
    m_thread = new QThread(this);

    connect(m_thread, &QThread::started, m_processMonitor,
            &ProcessMonitor::start);
    connect(m_thread, &QThread::finished, m_processMonitor,
            &QObject::deleteLater);
    connect(m_thread, &QThread::finished, m_thread, &QThread::deleteLater);
    connect(QGuiApplication::primaryScreen(),
            &QScreen::logicalDotsPerInchChanged, this, &MainWindow::recreate);
    m_thread->start();
    m_processMonitor->start();

    createTray();
    QApplication::setQuitOnLastWindowClosed(false);

    ui->osContent->setText(winutils::getWindowsVersion());
    m_cpu = new CpuUtils();
    m_cpu->init();
    m_mem = new MemUtils();
    m_mem->init();
    m_timer = new QTimer();

    refresh();
    connect(m_timer, &QTimer::timeout, this, &MainWindow::refresh);
    m_timer->start(1000);

    /* 读取slider值 */
    int value = qBound(ui->sliderCtrl->minimum(),
                       m_settings->value(CONFIG_SLIDERVALUE_KEY, 0).toInt(),
                       ui->sliderCtrl->maximum());

    ui->sliderCtrl->setValue(value);

    if (winutils::isAutoStartEnabled(QApplication::applicationName()))
    {
        ui->autoStartCheckBox->setCheckState(Qt::Checked);
    }
    else
    {
        ui->autoStartCheckBox->setCheckState(Qt::Unchecked);
    }

    /* 首选项菜单 */
    connect(ui->menuPreference, &QMenu::aboutToShow,
            [this]
    {
        ui->menuPreference->hide();
        QTimer::singleShot(50,
                           [this]()
        {
            m_preferenceDlg->show();
            m_preferenceDlg->activateWindow();
            m_preferenceDlg->raise();
        });
    });

    /* 关于菜单 */
    connect(ui->menuAbout, &QMenu::aboutToShow,
            [this]
    {
        ui->menuAbout->hide();
        QTimer::singleShot(50,
                           [this]()
        {
            m_aboutDlg->show();
            m_aboutDlg->activateWindow();
            m_aboutDlg->raise();
        });
    });

    m_languageGroup = new QActionGroup(this);
    m_languageGroup->setExclusive(true);
    m_languageGroup->setEnabled(true);
    m_languageGroup->addAction(ui->actionCN);
    m_languageGroup->addAction(ui->actionTW);
    m_languageGroup->addAction(ui->actionEN);
    QString language =
        m_settings->value(CONFIG_LANGUAGE, QLocale().system().name())
        .toString();
    if (language == "zh_CN")
    {
        ui->actionCN->setChecked(true);
    }
    else if (language == "zh_TW")
    {
        ui->actionTW->setChecked(true);
    }
    else if (language == "en_US")
    {
        ui->actionEN->setChecked(true);
    }

    connect(ui->actionCN, &QAction::triggered,
            [this]
    {
        m_settings->setValue(CONFIG_LANGUAGE, "zh_CN");
        QMessageBox msgBox(this);
        msgBox.setWindowFlags(Qt::Dialog | Qt::WindowTitleHint |
                              Qt::CustomizeWindowHint);
        msgBox.setIcon(QMessageBox::Information);
        msgBox.setWindowTitle(tr("提示"));
        msgBox.setText(tr("直到重启应用后，界面的语言才会生效"));
        msgBox.exec();
    });

    connect(ui->actionTW, &QAction::triggered,
            [this]
    {
        m_settings->setValue(CONFIG_LANGUAGE, "zh_TW");
        QMessageBox msgBox(this);
        msgBox.setWindowFlags(Qt::Dialog | Qt::WindowTitleHint |
                              Qt::CustomizeWindowHint);
        msgBox.setIcon(QMessageBox::Information);
        msgBox.setWindowTitle(tr("提示"));
        msgBox.setText(tr("直到重启应用后，界面的语言才会生效"));
        msgBox.exec();
    });

    connect(ui->actionEN, &QAction::triggered,
            [this]
    {
        m_settings->setValue(CONFIG_LANGUAGE, "en_US");
        QMessageBox msgBox(this);
        msgBox.setWindowFlags(Qt::Dialog | Qt::WindowTitleHint |
                              Qt::CustomizeWindowHint);
        msgBox.setIcon(QMessageBox::Information);
        msgBox.setWindowTitle(tr("提示"));
        msgBox.setText(tr("直到重启应用后，界面的语言才会生效"));
        msgBox.exec();
    });

    m_themeGroup = new QActionGroup(this);
    m_themeGroup->setExclusive(true);
    m_themeGroup->setEnabled(true);
    m_themeGroup->addAction(ui->actionLightTheme);
    m_themeGroup->addAction(ui->actionDarkTheme);
    
    int theme = m_settings->value(CONFIG_THEME, ThemeUtils::Light).toInt();
    if (theme == ThemeUtils::Light)
    {
        ui->actionLightTheme->setChecked(true);
    }
    else
    {
        ui->actionDarkTheme->setChecked(true);
    }

    connect(ui->actionLightTheme, &QAction::triggered,
            [this]
    {
        m_settings->setValue(CONFIG_THEME, ThemeUtils::Light);
        ThemeUtils::applyTheme(ThemeUtils::Light);
        refresh(); // 刷新界面以更新颜色
    });

    connect(ui->actionDarkTheme, &QAction::triggered,
            [this]
    {
        m_settings->setValue(CONFIG_THEME, ThemeUtils::Dark);
        ThemeUtils::applyTheme(ThemeUtils::Dark);
        refresh(); // 刷新界面以更新颜色
    });
}

void MainWindow::closeEvent(QCloseEvent *event)
{
    // 如果托盘图标可见，则隐藏窗口而不是关闭
    if (trayIcon->isVisible())
    {
        hide();

        // 阻止事件继续传播，防止应用关闭
        event->ignore();
    }
    else
    {
        // 如果没有托盘图标，则正常关闭
        event->accept();
    }
}

bool MainWindow::nativeEventFilter(const QByteArray &eventType,
                                   void *message,
                                   long *result)
{
    Q_UNUSED(result)

    if (eventType == "windows_generic_MSG" ||
        eventType == "windows_dispatcher_MSG")
    {
        MSG *msg = static_cast<MSG *>(message);

        if (msg->message == WM_HOTKEY)
        {
            int hotkeyId = msg->wParam;

            switch (hotkeyId)
            {
            case HOTKEY_INCREASE_SPEED:
            {
                int currentValue = ui->sliderCtrl->value();
                if (currentValue < ui->sliderCtrl->maximum())
                {
                    ui->sliderCtrl->setValue(
                        currentValue + m_preferenceDlg->getIncreaseStep());
                    qDebug() << "全局快捷键: 增加速度到"
                             << speedFactor(currentValue +
                                   m_preferenceDlg->getIncreaseStep());
                }
            }
            break;

            case HOTKEY_DECREASE_SPEED:
            {
                int currentValue = ui->sliderCtrl->value();
                if (currentValue > ui->sliderCtrl->minimum())
                {
                    ui->sliderCtrl->setValue(
                        currentValue - m_preferenceDlg->getDecreaseStep());
                    qDebug() << "全局快捷键: 降低速度到"
                             << speedFactor(currentValue -
                                   m_preferenceDlg->getDecreaseStep());
                }
            }
            break;

            case HOTKEY_RESET_SPEED:
ui->sliderCtrl->setValue(0);
                qDebug() << "全局快捷键: 重置速度";
                break;
            case HOTKEY_SHIFT1:
ui->sliderCtrl->setValue(
                    sliderValue(m_preferenceDlg->getShift1()));
                break;
            case HOTKEY_SHIFT2:
ui->sliderCtrl->setValue(
                    sliderValue(m_preferenceDlg->getShift2()));
                break;
            case HOTKEY_SHIFT3:
ui->sliderCtrl->setValue(
                    sliderValue(m_preferenceDlg->getShift3()));
                break;
            case HOTKEY_SHIFT4:
ui->sliderCtrl->setValue(
                    sliderValue(m_preferenceDlg->getShift4()));
                break;
            case HOTKEY_SHIFT5:
ui->sliderCtrl->setValue(
                    sliderValue(m_preferenceDlg->getShift5()));
                break;
            }

            return true; // 事件已处理
        }
    }

    return false; // 让其他过滤器处理
}

void MainWindow::on_autoStartCheckBox_stateChanged(int state)
{
    QString execFilePath =
        QDir::toNativeSeparators(QApplication::applicationFilePath());
    if (state == Qt::Checked)
    {

        qDebug() << QApplication::applicationName()
                 << QApplication::applicationFilePath();
        winutils::setAutoStart(true, QApplication::applicationName(),
                               execFilePath);
    }
    else
    {
        winutils::setAutoStart(false, QApplication::applicationName(),
                               execFilePath);
    }
}
