#ifndef FOCUSMONITOR_H
#define FOCUSMONITOR_H

#include <QObject>
#include <QTimer>
#include <windows.h>

/**
 * @brief 焦点监控类，用于检测当前前台窗口所属的进程 PID
 */
class FocusMonitor : public QObject
{
    Q_OBJECT
public:
    explicit FocusMonitor(QObject *parent = nullptr);
    ~FocusMonitor();

    // 启动监控，默认 500ms 检查一次
    void start(int interval = 500);
    // 停止监控
    void stop();

signals:
    // 当全屏/前台进程发生变化时触发
    void foregroundProcessChanged(DWORD pid);

private slots:
    void checkFocus();

private:
    QTimer *m_timer;
    DWORD m_lastPid;
};

#endif // FOCUSMONITOR_H
