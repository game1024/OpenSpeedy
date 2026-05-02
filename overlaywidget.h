#ifndef OVERLAYWIDGET_H
#define OVERLAYWIDGET_H

#include <QWidget>
#include <QLabel>
#include <QTimer>

/**
 * @brief 悬浮窗类，在游戏或桌面角落显示当前倍速
 */
class OverlayWidget : public QWidget
{
    Q_OBJECT
public:
    explicit OverlayWidget(QWidget *parent = nullptr);
    ~OverlayWidget();

    void setSpeedText(const QString &text);
    void showTemporarily(int ms = 3000);

protected:
    void paintEvent(QPaintEvent *event) override;

private:
    QLabel *m_label;
    QTimer *m_hideTimer;
};

#endif // OVERLAYWIDGET_H
