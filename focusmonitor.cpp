#include "focusmonitor.h"

FocusMonitor::FocusMonitor(QObject *parent)
    : QObject(parent), m_lastPid(0)
{
    m_timer = new QTimer(this);
    connect(m_timer, &QTimer::timeout, this, &FocusMonitor::checkFocus);
}

FocusMonitor::~FocusMonitor()
{
}

void FocusMonitor::start(int interval)
{
    m_timer->start(interval);
}

void FocusMonitor::stop()
{
    if (m_timer->isActive())
        m_timer->stop();
}

void FocusMonitor::checkFocus()
{
    // 获取当前前台活跃窗口句柄
    HWND hwnd = GetForegroundWindow();
    if (hwnd == NULL) return;

    DWORD pid = 0;
    // 获取该窗口所属的进程 ID
    GetWindowThreadProcessId(hwnd, &pid);

    if (pid != 0 && pid != m_lastPid)
    {
        m_lastPid = pid;
        emit foregroundProcessChanged(pid);
    }
}
