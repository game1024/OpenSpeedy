#include "./ui_mainwindow.h"
#include "mainwindow.h"
#include <QCloseEvent>
#include <QDebug>
#include <QScreen>
#include <QStyle>
MainWindow::MainWindow(QWidget *parent)
    : QMainWindow(parent), ui(new Ui::MainWindow)
{
    ui->setupUi(this);
    m_processMonitor =
        new ProcessMonitor(ui->processMonitorWidget, ui->processMonitorLabel,
                           ui->injector32Status, ui->injector64Status, nullptr);
    m_thread = new QThread(this);

    connect(m_thread, &QThread::started, m_processMonitor,
            &ProcessMonitor::start);
    connect(m_thread, &QThread::finished, m_processMonitor,
            &QObject::deleteLater);
    connect(m_thread, &QThread::finished, m_thread, &QThread::deleteLater);
    connect(QGuiApplication::primaryScreen(),
            &QScreen::logicalDotsPerInchChanged, this,
            &MainWindow::recreateTray);
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
}

MainWindow::~MainWindow()
{
    m_thread->quit();
    m_thread->wait();
    delete m_processMonitor;
    delete m_cpu;
    delete m_mem;
    delete ui;
}

void MainWindow::refresh()
{
    ui->cpuContent->setText(QString("<span style='color:blue'>%1%</span>")
                                .arg(m_cpu->getUsage(), 5, 'f', 1, ' '));

    double memUsage = m_mem->getUsage();
    double memTotal = m_mem->getTotal();
    ui->memContent->setText(
        QString("<span style='color:blue'>(%1G / %2G) %3%</span>")
            .arg(memUsage, 0, 'f', 1)
            .arg(memTotal, 0, 'f', 1)
            .arg(memUsage / memTotal * 100, 4, 'f', 1));
}

void MainWindow::on_sliderCtrl_valueChanged(int value)
{
    double speedFactor = 0.0;

    if (value >= 1 && value < 5)
    {
        speedFactor = value * 0.25 + 1;
    }
    else if (value >= 5 && value < 7)
    {
        speedFactor = value * 0.5;
    }
    else if (value >= 7 && value < 9)
    {
        speedFactor = 3 * (value - 7) + 4;
    }
    else if (value >= 9)
    {
        speedFactor = 5 * (value - 9) + 10;
    }
    else if (value < 0)
    {
        speedFactor = (double)(30 + value) / 30;
    }
    else
    {
        speedFactor = 1;
    }

    m_processMonitor->changeSpeed(speedFactor);
    ui->sliderCtrl->setToolTip(QString("%1倍").arg(speedFactor, 4, 'f', 2));
    ui->sliderLabel->setText(QString("x%1倍").arg(speedFactor, 4, 'f', 2));
}

void MainWindow::on_processNameFilter_textChanged(const QString &text)
{
    m_processMonitor->setFilter(text);
}

void MainWindow::iconActivated(QSystemTrayIcon::ActivationReason reason)
{
    {
        switch (reason)
        {
            case QSystemTrayIcon::Trigger:  // 单击
                if (isVisible())
                    hide();
                else
                {
                    show();
                    showNormal();
                    activateWindow();
                }
                break;
            case QSystemTrayIcon::DoubleClick:  // 双击
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

    // 创建托盘菜单
    trayMenu = new QMenu(this);

    // 创建动作
    showAction = new QAction("显示", this);
    hideAction = new QAction("隐藏", this);
    quitAction = new QAction("退出", this);

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

void MainWindow::recreateTray()
{
    qDebug() << "重绘托盘";
    resize(960, 640);
    delete trayMenu;
    delete trayIcon;
    delete showAction;
    delete hideAction;
    delete quitAction;
    createTray();
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
